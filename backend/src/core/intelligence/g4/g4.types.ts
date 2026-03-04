/**
 * G4 Threat Radar Types
 * 
 * Types for real-time threat monitoring and alerting
 */

export type TriggerType =
  | 'VOLUME_SPIKE'
  | 'NEW_BRIDGE'
  | 'RISK_ESCALATION'
  | 'SANCTIONED_INTERACTION'
  | 'MIXER_USAGE'
  | 'LARGE_TRANSFER';

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type NotificationChannel = 'telegram' | 'webhook' | 'email';

/**
 * Watchlist entry
 */
export interface Watchlist {
  id: string;
  subject: string; // address
  network: string;
  triggers: TriggerType[];
  channels: NotificationChannel[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
}

/**
 * Alert event
 */
export interface AlertEvent {
  id: string;
  watchlistId: string;
  triggerType: TriggerType;
  severity: AlertSeverity;
  network: string;
  subject: string; // address
  title: string;
  message: string;
  metrics: Record<string, any>;
  timestamp: Date;
  notified: boolean;
}

/**
 * Trigger rule configuration
 */
export interface TriggerRule {
  type: TriggerType;
  enabled: boolean;
  params: Record<string, any>;
}
