/**
 * Twitter Parser Module — Storage Types
 * 
 * Shared type definitions for storage layer.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY
 */

// === Owner Types ===

export type OwnerType = 'USER' | 'SYSTEM';

export interface OwnerScope {
  ownerType: OwnerType;
  ownerUserId?: string; // required when ownerType='USER'
}

// === Session Types ===

export type SessionStatus = 'OK' | 'STALE' | 'EXPIRED' | 'INVALID' | 'ERROR';

export type StaleReason = 'EXPIRED' | 'LOGOUT' | 'SECURITY_CHECK' | 'RATE_LIMITED' | 'UNKNOWN';

// === Task Types ===

export type TaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'COOLDOWN';

export type TaskType = 'SEARCH' | 'ACCOUNT_TWEETS' | 'ACCOUNT_FOLLOWERS' | 'ACCOUNT_SUMMARY';

export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH';

// === Target Types ===

export type TargetType = 'KEYWORD' | 'ACCOUNT';

// === Quality Types ===

export type QualityStatus = 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';

// === Slot Types ===

export type SlotType = 'PROXY' | 'DIRECT';
