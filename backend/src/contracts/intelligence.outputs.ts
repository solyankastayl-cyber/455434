/**
 * INTELLIGENCE OUTPUTS CONTRACT — P1.D
 * =====================================
 * 
 * Stub interfaces for P2 Connections integration.
 * These define what data CAN exit the intelligence layer.
 * 
 * @reserved v1.0 — DO NOT IMPLEMENT until P2
 */

// ═══════════════════════════════════════════════════════════════
// OUTPUT CONSUMERS (P2 will add more)
// ═══════════════════════════════════════════════════════════════

export type OutputConsumer = 
  | 'FOMO_AI'       // Main user-facing verdict
  | 'ALERTS'        // Alert system
  | 'ADMIN'         // Admin dashboard
  | 'ANALYTICS'     // Internal analytics
  | 'CONNECTIONS';  // Reserved for P2

// ═══════════════════════════════════════════════════════════════
// DECISION OUTPUT (Main verdict)
// ═══════════════════════════════════════════════════════════════

export interface DecisionOutput {
  /** Symbol analyzed */
  symbol: string;
  
  /** Timestamp of decision */
  timestamp: number;
  
  /** Final action */
  action: 'BUY' | 'SELL' | 'AVOID';
  
  /** Confidence (0..1) */
  confidence: number;
  
  /** Strength */
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  /** Direction */
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  
  /** Was decision downgraded by guards? */
  downgraded: boolean;
  
  /** Macro context that influenced decision */
  macroContext: {
    regime: string;
    riskLevel: string;
    confidenceMultiplier: number;
    blockedActions: string[];
  };
  
  /** Invariant check result */
  invariants: {
    passed: boolean;
    violations: string[];
  };
  
  /** Human-readable explanation */
  explain: {
    summary: string;
    reasons: string[];
    macroImpact: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// ALERT OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface AlertOutput {
  /** Alert ID */
  id: string;
  
  /** Alert type */
  type: string;
  
  /** Severity */
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  
  /** Title */
  title: string;
  
  /** Message */
  message: string;
  
  /** Related symbol (if any) */
  symbol?: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Expiry timestamp */
  expiresAt: number;
  
  /** Auto-dismiss? */
  autoDismiss: boolean;
  
  /** Actions available */
  actions?: string[];
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface AnalyticsOutput {
  /** Session ID */
  sessionId: string;
  
  /** Event type */
  event: 'DECISION' | 'DOWNGRADE' | 'BLOCK' | 'VIOLATION';
  
  /** Symbol */
  symbol: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Input quality scores */
  inputQuality: {
    exchange: number;
    macro: number;
    onchain: number;
    sentiment: number;
  };
  
  /** Decision metrics */
  metrics: {
    confidenceBefore: number;
    confidenceAfter: number;
    strengthBefore: string;
    strengthAfter: string;
    macroMultiplier: number;
    mlModifier: number;
  };
  
  /** Processing time (ms) */
  latencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// CONNECTIONS OUTPUT (RESERVED FOR P2)
// ═══════════════════════════════════════════════════════════════

/**
 * @reserved P2 — Connections integration
 * DO NOT implement until Connections merge
 */
export interface ConnectionsOutput {
  // Placeholder — will be defined in P2
  _reserved: true;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT BUNDLE
// ═══════════════════════════════════════════════════════════════

export interface IntelligenceOutputBundle {
  timestamp: number;
  symbol: string;
  
  /** Main decision (always present) */
  decision: DecisionOutput;
  
  /** Alerts triggered (if any) */
  alerts: AlertOutput[];
  
  /** Analytics event */
  analytics: AnalyticsOutput;
  
  /** Reserved for P2 */
  connections?: ConnectionsOutput;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateDecisionOutput(output: Partial<DecisionOutput>): boolean {
  if (!output.symbol) return false;
  if (!output.action) return false;
  if (output.confidence === undefined) return false;
  if (!output.macroContext) return false;
  if (!output.macroContext.regime) return false;
  return true;
}

export function validateAlertOutput(output: Partial<AlertOutput>): boolean {
  if (!output.id) return false;
  if (!output.type) return false;
  if (!output.severity) return false;
  if (!output.message) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT FORMATTING
// ═══════════════════════════════════════════════════════════════

export function formatDecisionForFomoAI(decision: DecisionOutput): {
  action: string;
  confidence: string;
  strength: string;
  summary: string;
} {
  return {
    action: decision.action,
    confidence: `${Math.round(decision.confidence * 100)}%`,
    strength: decision.strength,
    summary: decision.explain.summary,
  };
}

export function formatAlertForTelegram(alert: AlertOutput): string {
  const emoji = {
    INFO: 'ℹ️',
    WARNING: '⚠️',
    CRITICAL: '🔴',
    EMERGENCY: '🚨',
  }[alert.severity];
  
  return `${emoji} ${alert.title}\n${alert.message}`;
}

console.log('[P1.D] Intelligence outputs contract loaded (STUB)');
