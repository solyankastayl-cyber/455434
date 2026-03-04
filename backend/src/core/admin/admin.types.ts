/**
 * Admin Types
 * 
 * Type definitions for admin authentication and authorization.
 */

export type AdminRole = 'ADMIN' | 'MODERATOR';

export interface AdminTokenPayload {
  sub: string;        // admin user id
  role: AdminRole;
  iat: number;
  exp: number;
}

export interface AdminLoginRequest {
  username: string;
  password: string;
}

export interface AdminLoginResponse {
  ok: true;
  token: string;
  role: AdminRole;
  username: string;
  issuedAtTs: number;
  expiresAtTs: number;
}

export interface AdminStatusResponse {
  ok: true;
  data: {
    role: AdminRole;
    username: string;
    issuedAtTs: number;
    expiresAtTs: number;
  };
}

export interface AdminUserDoc {
  _id?: any;
  username: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  createdAtTs: number;
  updatedAtTs: number;
  lastLoginTs?: number;
}
