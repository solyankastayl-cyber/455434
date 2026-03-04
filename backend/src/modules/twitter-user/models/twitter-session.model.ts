import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType, SessionStatus } from './_types.js';

/**
 * UserTwitterSession - Session Versioning Model (Phase 1.2)
 * 
 * ИНВАРИАНТЫ:
 * - Никогда не перезаписываем сессию (immutable approach)
 * - version всегда инкрементируется
 * - Только 1 активная сессия на account (isActive: true)
 * - Старые сессии сохраняются для истории
 */
export interface IUserTwitterSession extends Document {
  ownerType: OwnerType;
  ownerUserId?: string;
  accountId: mongoose.Types.ObjectId;
  
  // Session Versioning (Phase 1.2)
  /** Версия сессии (инкрементируется при каждом обновлении) */
  version: number;
  /** Только 1 активная сессия на аккаунт */
  isActive: boolean;
  /** Когда была деактивирована (superseded новой версией) */
  supersededAt?: Date;
  
  status: SessionStatus;
  riskScore: number;
  lifetimeDaysEstimate: number;
  lastOkAt?: Date;
  lastSyncAt?: Date;
  lastWarmAt?: Date;
  staleReason?: string;
  
  // Phase 1.3: Runtime telemetry for selection
  /** Средняя latency последних запросов (ms) */
  avgLatencyMs?: number;
  /** Когда последний раз был abort */
  lastAbortAt?: Date;
  /** Success rate (0-100) */
  successRate?: number;
  
  // Encrypted cookies (AES-256-GCM)
  cookiesEnc: string;
  cookiesIv: string;
  cookiesTag: string;
  // Metadata
  userAgent?: string;
  ip?: string;
  consentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserTwitterSessionSchema = new Schema<IUserTwitterSession>(
  {
    ownerType: {
      type: String,
      required: true,
      enum: ['USER', 'SYSTEM'],
    },
    ownerUserId: String,
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'UserTwitterAccount',
      required: true,
      index: true,
    },
    
    // Session Versioning (Phase 1.2)
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    supersededAt: Date,
    
    status: {
      type: String,
      required: true,
      enum: ['OK', 'STALE', 'INVALID', 'ERROR'],
    },
    riskScore: {
      type: Number,
      required: true,
      default: 0,
      // Ensure riskScore is always a valid number
      set: (v: any) => {
        const num = Number(v);
        return Number.isFinite(num) ? Math.max(0, Math.min(num, 100)) : 0;
      },
    },
    lifetimeDaysEstimate: {
      type: Number,
      required: true,
      default: 14,
    },
    lastOkAt: Date,
    lastSyncAt: Date,
    lastWarmAt: Date,
    staleReason: String,
    
    // Phase 1.3: Runtime telemetry
    avgLatencyMs: Number,
    lastAbortAt: Date,
    successRate: Number,
    
    // Encrypted fields
    cookiesEnc: {
      type: String,
      required: true,
    },
    cookiesIv: {
      type: String,
      required: true,
    },
    cookiesTag: {
      type: String,
      required: true,
    },
    // Metadata
    userAgent: String,
    ip: String,
    consentAt: Date,
  },
  { timestamps: true }
);

// Indexes
UserTwitterSessionSchema.index({ ownerType: 1, ownerUserId: 1 });
// Уникальность: только 1 активная сессия на аккаунт (Phase 1.2)
UserTwitterSessionSchema.index(
  { accountId: 1, isActive: 1 },
  { 
    unique: true,
    partialFilterExpression: { isActive: true }
  }
);
UserTwitterSessionSchema.index({ status: 1, updatedAt: -1 });
// Index для быстрого поиска активной сессии
UserTwitterSessionSchema.index({ ownerUserId: 1, accountId: 1, isActive: 1 });

export const UserTwitterSessionModel = mongoose.model<IUserTwitterSession>(
  'UserTwitterSession',
  UserTwitterSessionSchema,
  'user_twitter_sessions'
);
