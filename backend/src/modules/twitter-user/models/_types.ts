// Type definitions for Twitter User module

export type OwnerType = 'USER' | 'SYSTEM';

export type SessionStatus = 'OK' | 'STALE' | 'EXPIRED' | 'INVALID' | 'ERROR';

export type StaleReason = 'EXPIRED' | 'LOGOUT' | 'SECURITY_CHECK' | 'RATE_LIMITED' | 'UNKNOWN';

export type SlotType = 'PROXY' | 'DIRECT';

export type TwitterTaskType =
  | 'SEARCH_KEYWORD'
  | 'ACCOUNT_TWEETS'
  | 'ACCOUNT_SUMMARY'
  | 'ACCOUNT_FOLLOWERS';

export type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'COOLDOWN';

export interface OwnerScope {
  ownerType: OwnerType;
  ownerUserId?: string; // required when ownerType='USER'
}
