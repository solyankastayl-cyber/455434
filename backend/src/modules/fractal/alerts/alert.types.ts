/**
 * BLOCK 67 — Alert Types (Production Grade)
 * 
 * BTC-only, institutional alert system.
 * Rate limited: 3 INFO/HIGH per 24h rolling.
 * CRITICAL always passes.
 */

export type AlertLevel = 'INFO' | 'HIGH' | 'CRITICAL';

export type AlertType =
  | 'REGIME_SHIFT'     // Volatility regime changed
  | 'CRISIS_ENTER'     // Entered CRISIS regime
  | 'CRISIS_EXIT'      // Exited CRISIS regime
  | 'HEALTH_DROP'      // Health degraded (HEALTHY→WATCH→ALERT→CRITICAL)
  | 'TAIL_SPIKE';      // Tail risk exceeded threshold

export type AlertBlockedBy = 'NONE' | 'DEDUP' | 'QUOTA' | 'COOLDOWN' | 'BATCH_SUPPRESSED';

export interface AlertEvent {
  symbol: 'BTC';
  type: AlertType;
  level: AlertLevel;
  message: string;
  fingerprint: string;
  meta: Record<string, any>;
  blockedBy: AlertBlockedBy;
  triggeredAt: Date;
}

export interface AlertLogEntry {
  _id?: string;
  symbol: 'BTC';
  type: AlertType;
  level: AlertLevel;
  message: string;
  fingerprint: string;
  meta: Record<string, any>;
  blockedBy: AlertBlockedBy;
  triggeredAt: Date;
  createdAt?: Date;
}

export interface AlertQuota {
  windowHours: number;
  max: number;
  used: number;
  remaining: number;
}

export interface AlertStats {
  last24h: Record<AlertLevel, number>;
  last7d: Record<AlertLevel, number>;
}

export interface AlertRunResult {
  sentCount: number;
  blockedCount: number;
  quotaUsed: number;
  events: AlertEvent[];
}
