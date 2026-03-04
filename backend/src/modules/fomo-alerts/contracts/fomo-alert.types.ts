/**
 * FOMO AI Alert Types
 * ===================
 * 
 * Alert events specific to FOMO AI decision system
 * Integrates with existing telegram router infrastructure
 */

// ═══════════════════════════════════════════════════════════════
// FOMO AI EVENT TYPES
// ═══════════════════════════════════════════════════════════════

export type FomoAlertEvent =
  // USER events → @t_fomo_bot
  | 'DECISION_CHANGED'     // BUY→AVOID, SELL→AVOID, AVOID→BUY/SELL
  | 'HIGH_CONFIDENCE'      // confidence >= threshold && BUY/SELL
  | 'RISK_INCREASED'       // risk escalation while user monitoring
  | 'MACRO_REGIME_CHANGE'  // Macro sentiment regime change (USER event)
  
  // ADMIN events → @a_fomo_bot
  | 'ML_PROMOTED'          // Model promotion
  | 'ML_ROLLBACK'          // Auto-rollback triggered
  | 'ML_SHADOW_CRITICAL'   // Shadow model critical health
  | 'PROVIDER_DOWN'        // Exchange/provider disconnected
  | 'WS_DISCONNECT'        // WebSocket failure
  | 'DATA_COMPLETENESS'    // Data completeness below SLA
  | 'TRUST_WARNING'        // Divergence spike or accuracy drop
  | 'MACRO_EXTREME';       // Extreme macro conditions (ADMIN event)

export type FomoAlertScope = 'USER' | 'ADMIN';

// ═══════════════════════════════════════════════════════════════
// EVENT PAYLOADS
// ═══════════════════════════════════════════════════════════════

export interface DecisionChangedPayload {
  symbol: string;
  previousAction: 'BUY' | 'SELL' | 'AVOID';
  newAction: 'BUY' | 'SELL' | 'AVOID';
  previousConfidence: number;
  newConfidence: number;
  reasons: string[];
  timestamp: number;
}

export interface HighConfidencePayload {
  symbol: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  drivers: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  dataMode: 'LIVE' | 'MIXED';
  snapshotId?: string;
}

export interface RiskIncreasedPayload {
  symbol: string;
  previousRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  newRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  action: 'BUY' | 'SELL' | 'AVOID';
  confidence: number;
  riskFactors: string[];
}

export interface MlPromotedPayload {
  modelId: string;
  accuracy: number;
  ece: number;
  previousModelId?: string;
}

export interface MlRollbackPayload {
  rolledBackModelId: string;
  restoredModelId: string;
  reason: string;
  critStreak: number;
}

export interface MlShadowCriticalPayload {
  modelId: string;
  stage: 'ACTIVE' | 'CANDIDATE';
  health: 'CRITICAL';
  critStreak: number;
  lastECE: number;
}

export interface ProviderDownPayload {
  provider: string;
  lastStatus: string;
  downSince?: number;
  affectedSymbols?: string[];
}

export interface WsDisconnectPayload {
  service: string;
  error?: string;
  reconnectAttempts?: number;
}

export interface DataCompletenessPayload {
  completeness: number;
  threshold: number;
  missingProviders?: string[];
}

export interface TrustWarningPayload {
  symbol: string;
  type: 'DIVERGENCE_SPIKE' | 'ACCURACY_DROP' | 'UNUSUAL_PATTERN';
  value: number;
  threshold?: number;
  details?: string;
}

// Macro alerts payloads
export interface MacroRegimeChangePayload {
  previousLabel: string;  // e.g., 'FEAR'
  newLabel: string;       // e.g., 'EXTREME_FEAR'
  previousValue: number;
  newValue: number;
  direction: 'WORSENING' | 'IMPROVING' | 'STABLE';
  flags: string[];
  confidenceMultiplier: number;
  timestamp: number;
}

export interface MacroExtremePayload {
  fearGreedValue: number;
  fearGreedLabel: string;
  btcDominance: number;
  stableDominance: number;
  flags: string[];
  impact: {
    confidenceMultiplier: number;
    blockedStrong: boolean;
    reason: string;
  };
  timestamp: number;
}

// Union type for all payloads
export type FomoAlertPayload =
  | DecisionChangedPayload
  | HighConfidencePayload
  | RiskIncreasedPayload
  | MlPromotedPayload
  | MlRollbackPayload
  | MlShadowCriticalPayload
  | ProviderDownPayload
  | WsDisconnectPayload
  | DataCompletenessPayload
  | TrustWarningPayload
  | MacroRegimeChangePayload
  | MacroExtremePayload;

// ═══════════════════════════════════════════════════════════════
// ALERT CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface FomoAlertConfig {
  // Global
  enabled: boolean;
  
  // User alerts
  user: {
    enabled: boolean;
    botToken?: string;
    chatId?: string;  // Global user channel (until per-user impl)
    
    // Event toggles
    decisionChanged: boolean;
    highConfidence: boolean;
    riskIncreased: boolean;
    macroRegimeChange: boolean;  // NEW: Macro regime change alerts
    
    // Thresholds
    confidenceThreshold: number;  // For HIGH_CONFIDENCE
    
    // Symbols filter
    symbols: string[];  // Empty = all
    
    // Cooldown (ms)
    cooldownMs: number;
  };
  
  // Admin alerts
  admin: {
    enabled: boolean;
    botToken?: string;
    chatId?: string;
    
    // Event toggles
    mlPromoted: boolean;
    mlRollback: boolean;
    mlShadowCritical: boolean;
    providerDown: boolean;
    wsDisconnect: boolean;
    dataCompleteness: boolean;
    trustWarning: boolean;
    macroExtreme: boolean;  // NEW: Extreme macro conditions
    
    // Severity filter
    minSeverity: 'INFO' | 'WARNING' | 'CRITICAL';
    
    // Cooldown (ms)
    cooldownMs: number;
  };
  
  // Global rules
  global: {
    // Safety guards
    requireLiveData: boolean;       // No alerts if dataMode != LIVE
    requireMlReady: boolean;        // No BUY/SELL if ML not ready
    noUserAlertsOnAvoid: boolean;   // No user alerts for AVOID
    
    // Limits
    maxAlertsPerHour: number;
    dedupeWindowMs: number;
  };
  
  updatedAt: number;
}

export const DEFAULT_FOMO_ALERT_CONFIG: FomoAlertConfig = {
  enabled: true,
  
  user: {
    enabled: true,
    botToken: undefined,
    chatId: undefined,
    
    decisionChanged: true,
    highConfidence: true,
    riskIncreased: true,
    macroRegimeChange: true,  // NEW
    
    confidenceThreshold: 0.65,
    symbols: [],
    cooldownMs: 15 * 60 * 1000,  // 15 min
  },
  
  admin: {
    enabled: true,
    botToken: undefined,
    chatId: undefined,
    
    mlPromoted: true,
    mlRollback: true,
    mlShadowCritical: true,
    providerDown: true,
    wsDisconnect: true,
    dataCompleteness: true,
    trustWarning: true,
    macroExtreme: true,  // NEW
    
    minSeverity: 'WARNING',
    cooldownMs: 10 * 60 * 1000,  // 10 min
  },
  
  global: {
    requireLiveData: true,
    requireMlReady: false,  // Can alert even without ML
    noUserAlertsOnAvoid: true,
    
    maxAlertsPerHour: 50,
    dedupeWindowMs: 10 * 60 * 1000,  // 10 min
  },
  
  updatedAt: Date.now(),
};

// ═══════════════════════════════════════════════════════════════
// ALERT LOG ENTRY
// ═══════════════════════════════════════════════════════════════

export interface FomoAlertLog {
  alertId: string;
  event: FomoAlertEvent;
  scope: FomoAlertScope;
  
  payload: FomoAlertPayload;
  message: string;
  
  // Delivery
  status: 'SENT' | 'SKIPPED' | 'MUTED' | 'DEDUPED' | 'FAILED' | 'GUARD_BLOCKED';
  skipReason?: string;
  
  // Tracking
  createdAt: number;
  sentAt?: number;
  
  // Effectiveness tracking
  outcome?: {
    confirmed?: boolean;
    evaluatedAt?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT → SCOPE MAPPING
// ═══════════════════════════════════════════════════════════════

export const EVENT_SCOPE_MAP: Record<FomoAlertEvent, FomoAlertScope> = {
  'DECISION_CHANGED': 'USER',
  'HIGH_CONFIDENCE': 'USER',
  'RISK_INCREASED': 'USER',
  'MACRO_REGIME_CHANGE': 'USER',  // NEW
  
  'ML_PROMOTED': 'ADMIN',
  'ML_ROLLBACK': 'ADMIN',
  'ML_SHADOW_CRITICAL': 'ADMIN',
  'PROVIDER_DOWN': 'ADMIN',
  'WS_DISCONNECT': 'ADMIN',
  'DATA_COMPLETENESS': 'ADMIN',
  'TRUST_WARNING': 'ADMIN',
  'MACRO_EXTREME': 'ADMIN',  // NEW
};

// ═══════════════════════════════════════════════════════════════
// DEDUPE TTL BY EVENT (ms)
// ═══════════════════════════════════════════════════════════════

export const FOMO_DEDUPE_TTL: Record<FomoAlertEvent, number> = {
  'DECISION_CHANGED': 15 * 60 * 1000,     // 15 min
  'HIGH_CONFIDENCE': 30 * 60 * 1000,      // 30 min
  'RISK_INCREASED': 30 * 60 * 1000,       // 30 min
  'MACRO_REGIME_CHANGE': 60 * 60 * 1000,  // 1 hour (regime changes are rare)
  
  'ML_PROMOTED': 60 * 60 * 1000,          // 1 hour
  'ML_ROLLBACK': 60 * 60 * 1000,          // 1 hour
  'ML_SHADOW_CRITICAL': 30 * 60 * 1000,   // 30 min
  'PROVIDER_DOWN': 10 * 60 * 1000,        // 10 min
  'WS_DISCONNECT': 10 * 60 * 1000,        // 10 min
  'DATA_COMPLETENESS': 30 * 60 * 1000,    // 30 min
  'TRUST_WARNING': 30 * 60 * 1000,        // 30 min
  'MACRO_EXTREME': 2 * 60 * 60 * 1000,    // 2 hours (avoid spam during extreme conditions)
};
