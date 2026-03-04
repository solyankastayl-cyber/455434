/**
 * UserApiKey Model - API ключи для extension и внешних интеграций
 * 
 * Безопасность:
 * - key хранится зашифрованным (AES-256-GCM)
 * - keyHash для быстрого поиска
 * - scoped permissions
 */

import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface IUserApiKey extends Document {
  /** Владелец ключа */
  ownerUserId: string;
  
  /** SHA256 hash ключа для быстрого поиска */
  keyHash: string;
  
  /** Зашифрованный ключ (для возможности копирования) */
  keyEnc?: string;
  keyIv?: string;
  keyTag?: string;
  
  /** Префикс для идентификации (usr_xxx...) */
  keyPrefix: string;
  
  /** Название ключа */
  name: string;
  
  /** Разрешённые scopes */
  scopes: ApiKeyScope[];
  
  /** Когда использовался последний раз */
  lastUsedAt?: Date;
  
  /** Когда отозван */
  revokedAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

export type ApiKeyScope = 
  | 'twitter:cookies:write'   // Extension webhook
  | 'twitter:read'            // Read own data
  | 'twitter:tasks:write';    // Create tasks

const UserApiKeySchema = new Schema<IUserApiKey>(
  {
    ownerUserId: {
      type: String,
      required: true,
      index: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
    },
    keyEnc: String,
    keyIv: String,
    keyTag: String,
    keyPrefix: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      default: 'API Key',
    },
    scopes: [{
      type: String,
      enum: ['twitter:cookies:write', 'twitter:read', 'twitter:tasks:write'],
    }],
    lastUsedAt: Date,
    revokedAt: Date,
  },
  {
    timestamps: true,
    collection: 'user_api_keys',
  }
);

// Index for fast lookup by hash
UserApiKeySchema.index({ keyHash: 1, revokedAt: 1 });

export const UserApiKeyModel = mongoose.model<IUserApiKey>(
  'UserApiKey',
  UserApiKeySchema
);

// Get encryption key from env or generate a stable one
function getEncryptionKey(): Buffer {
  const keyHex = process.env.API_KEY_ENC_KEY || process.env.COOKIE_ENC_KEY;
  if (keyHex) {
    return Buffer.from(keyHex, 'hex');
  }
  // Fallback: derive from a constant (not ideal, but works)
  return crypto.createHash('sha256').update('api-key-encryption-fallback').digest();
}

/**
 * Encrypt API key for storage
 */
function encryptApiKey(plainKey: string): { enc: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const enc = Buffer.concat([
    cipher.update(plainKey, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  
  return {
    enc: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt API key from storage
 */
export function decryptApiKey(enc: string, iv: string, tag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  
  const dec = Buffer.concat([
    decipher.update(Buffer.from(enc, 'base64')),
    decipher.final()
  ]);
  
  return dec.toString('utf8');
}

/**
 * Generate API key
 * Returns: { plainKey, keyHash, keyPrefix, encrypted }
 */
export function generateApiKey(): { 
  plainKey: string; 
  keyHash: string; 
  keyPrefix: string;
  encrypted: { enc: string; iv: string; tag: string };
} {
  // Generate 32 random bytes
  const randomBytes = crypto.randomBytes(32);
  const randomPart = randomBytes.toString('base64url');
  
  // Create key with prefix
  const plainKey = `usr_${randomPart}`;
  
  // Hash for fast lookup
  const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');
  
  // Prefix for display (first 8 chars after usr_)
  const keyPrefix = `usr_${randomPart.slice(0, 8)}...`;
  
  // Encrypt for storage
  const encrypted = encryptApiKey(plainKey);
  
  return { plainKey, keyHash, keyPrefix, encrypted };
}

/**
 * Hash API key for lookup
 */
export function hashApiKey(plainKey: string): string {
  return crypto.createHash('sha256').update(plainKey).digest('hex');
}
