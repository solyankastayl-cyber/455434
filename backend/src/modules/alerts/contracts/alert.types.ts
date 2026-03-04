/**
 * ALERTS MODULE — Types
 * =====================
 * 
 * Alert types for FOMO AI product notifications
 */

// ═══════════════════════════════════════════════════════════════
// ALERT TYPES
// ═══════════════════════════════════════════════════════════════

export type AlertType = 
  | 'DECISION'           // BUY/SELL signal
  | 'RISK_WARNING'       // Whale risk, stress, contradiction
  | 'SYSTEM_DEGRADATION' // ML rollback, provider down, data mode change
  | 'RECOVERY';          // System back to normal

export type AlertChannel = 'TELEGRAM' | 'DISCORD' | 'WEBHOOK';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

// ═══════════════════════════════════════════════════════════════
// ALERT PAYLOADS
// ═══════════════════════════════════════════════════════════════

export interface DecisionAlertPayload {
  symbol: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  drivers: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  dataMode: 'LIVE' | 'MIXED';
  snapshotId?: string;
}

export interface RiskWarningPayload {
  symbol: string;
  riskType: 'WHALE_RISK' | 'MARKET_STRESS' | 'CONTRADICTION' | 'LIQUIDATION_RISK';
  severity: AlertSeverity;
  details: string;
  currentValue?: number | string;
}

export interface SystemDegradationPayload {
  event: 'ML_ROLLBACK' | 'PROVIDER_DOWN' | 'DATA_MODE_CHANGED' | 'CRITICAL_DRIFT';
  affectedSymbols?: string[];
  details: string;
  impact: string;
}

export interface RecoveryPayload {
  event: string;
  details: string;
}

// ═══════════════════════════════════════════════════════════════
// ALERT RECORD
// ═══════════════════════════════════════════════════════════════

export interface Alert {
  alertId: string;
  type: AlertType;
  severity: AlertSeverity;
  channel: AlertChannel;
  
  // Payload (one of)
  payload: DecisionAlertPayload | RiskWarningPayload | SystemDegradationPayload | RecoveryPayload;
  
  // Metadata
  createdAt: number;
  sentAt?: number;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  error?: string;
  
  // Deduplication
  dedupeKey: string;
}

// ═══════════════════════════════════════════════════════════════
// ALERT SETTINGS
// ═══════════════════════════════════════════════════════════════

export interface AlertSettings {
  // Global enable
  enabled: boolean;
  
  // Channels
  telegram: {
    enabled: boolean;
    botToken?: string;
    chatId?: string;
  };
  
  discord: {
    enabled: boolean;
    webhookUrl?: string;
  };
  
  // Thresholds
  decisionConfidenceThreshold: number; // Default: 0.65
  
  // Cooldowns (ms)
  cooldownPerAssetMs: number;    // Default: 30 min
  cooldownPerEventMs: number;    // Default: 10 min
  
  // Channel filters
  channels: {
    decisions: boolean;
    riskWarnings: boolean;
    systemAlerts: boolean;
  };
  
  // Symbols to monitor (empty = all)
  watchlist: string[];
  
  updatedAt: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  
  telegram: {
    enabled: false,
    botToken: undefined,
    chatId: undefined,
  },
  
  discord: {
    enabled: false,
    webhookUrl: undefined,
  },
  
  decisionConfidenceThreshold: 0.65,
  cooldownPerAssetMs: 30 * 60 * 1000,   // 30 min
  cooldownPerEventMs: 10 * 60 * 1000,   // 10 min
  
  channels: {
    decisions: true,
    riskWarnings: true,
    systemAlerts: true,
  },
  
  watchlist: [],
  
  updatedAt: Date.now(),
};
