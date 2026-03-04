/**
 * Admin Auth Service
 * 
 * Authentication logic for admin panel:
 * - Password hashing (PBKDF2)
 * - JWT generation/verification
 * - Admin seed on first run
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AdminUserModel } from './admin.models.js';
import type { AdminRole, AdminTokenPayload } from './admin.types.js';

// ============================================
// CONFIG
// ============================================

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'dev_admin_secret_change_me_in_prod';
const JWT_TTL_SEC = Number(process.env.ADMIN_JWT_TTL_SEC || 60 * 60 * 12); // 12 hours

const SEED_USERNAME = process.env.ADMIN_SEED_USERNAME || 'admin';
const SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'admin12345';
const SEED_ROLE: AdminRole = (process.env.ADMIN_SEED_ROLE as AdminRole) || 'ADMIN';

// ============================================
// PASSWORD HASHING (PBKDF2)
// ============================================

function pbkdf2Hash(password: string): string {
  const salt = crypto.randomBytes(16);
  const iterations = 120_000;
  const keylen = 32;
  const digest = 'sha256';
  const derived = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest);
  return `pbkdf2$${iterations}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function pbkdf2Verify(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];
  
  const salt = Buffer.from(saltHex, 'hex');
  const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  
  try {
    return crypto.timingSafeEqual(Buffer.from(hashHex, 'hex'), derived);
  } catch {
    return false;
  }
}

// ============================================
// ADMIN SEED
// ============================================

/**
 * Create initial admin user if none exists
 */
export async function ensureAdminSeed(): Promise<void> {
  const count = await AdminUserModel.countDocuments({});
  if (count > 0) {
    console.log('[Admin] Admin users exist, skipping seed');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  
  await AdminUserModel.create({
    username: SEED_USERNAME,
    passwordHash: pbkdf2Hash(SEED_PASSWORD),
    role: SEED_ROLE,
    isActive: true,
    createdAtTs: now,
    updatedAtTs: now,
  });

  console.log(`[Admin] Created seed admin: ${SEED_USERNAME} (role: ${SEED_ROLE})`);
}

// ============================================
// LOGIN
// ============================================

export interface LoginResult {
  token: string;
  role: AdminRole;
  username: string;
  userId: string;
  iat: number;
  exp: number;
}

export async function loginAdmin(
  username: string,
  password: string
): Promise<LoginResult | null> {
  const user = await AdminUserModel.findOne({ 
    username, 
    isActive: true 
  }).lean();
  
  if (!user) {
    console.log(`[Admin] Login failed: user not found - ${username}`);
    return null;
  }

  const passwordOk = pbkdf2Verify(password, user.passwordHash);
  if (!passwordOk) {
    console.log(`[Admin] Login failed: invalid password - ${username}`);
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  
  const payload: AdminTokenPayload = {
    sub: String(user._id),
    role: user.role as AdminRole,
    iat: now,
    exp: now + JWT_TTL_SEC,
  };

  const token = jwt.sign(payload, JWT_SECRET);

  // Update last login
  await AdminUserModel.updateOne(
    { _id: user._id },
    { $set: { lastLoginTs: now, updatedAtTs: now } }
  );

  console.log(`[Admin] Login successful: ${username}`);

  return {
    token,
    role: user.role as AdminRole,
    username: user.username,
    userId: String(user._id),
    iat: payload.iat,
    exp: payload.exp,
  };
}

// ============================================
// TOKEN VERIFICATION
// ============================================

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
    
    if (!decoded?.sub || !decoded?.role) {
      return null;
    }
    
    return decoded;
  } catch (err) {
    return null;
  }
}

// ============================================
// USER MANAGEMENT
// ============================================

export async function createAdminUser(
  username: string,
  password: string,
  role: AdminRole
): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    await AdminUserModel.create({
      username,
      passwordHash: pbkdf2Hash(password),
      role,
      isActive: true,
      createdAtTs: now,
      updatedAtTs: now,
    });
    
    return true;
  } catch (err) {
    console.error('[Admin] Failed to create user:', err);
    return false;
  }
}

export async function changePassword(
  username: string,
  newPassword: string
): Promise<boolean> {
  const result = await AdminUserModel.updateOne(
    { username },
    { 
      $set: { 
        passwordHash: pbkdf2Hash(newPassword),
        updatedAtTs: Math.floor(Date.now() / 1000),
      } 
    }
  );
  
  return result.modifiedCount > 0;
}

export async function listAdminUsers(): Promise<any[]> {
  const users = await AdminUserModel.find({}, {
    passwordHash: 0,
  }).lean();
  
  return users.map(u => ({
    id: String(u._id),
    username: u.username,
    role: u.role,
    isActive: u.isActive,
    lastLoginTs: u.lastLoginTs,
    createdAtTs: u.createdAtTs,
  }));
}

export default {
  ensureAdminSeed,
  loginAdmin,
  verifyAdminToken,
  createAdminUser,
  changePassword,
  listAdminUsers,
};
