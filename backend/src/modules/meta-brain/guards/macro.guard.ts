/**
 * MACRO CONTEXT GUARD
 * ===================
 * 
 * Sanitizes and validates macro context before it reaches Meta-Brain.
 * Ensures macro can ONLY penalize, never amplify.
 */

export interface RawMacroContext {
  regime?: string;
  riskLevel?: string;
  confidenceMultiplier?: number;
  flags?: string[];
  fearGreed?: number;
  btcDom?: number;
  stableDom?: number;
}

export interface GuardedMacroContext {
  regime: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  confidenceMultiplier: number;  // Always <= 1
  flags: string[];
  blockedStrong: boolean;
  blockedAction: boolean;
  raw: RawMacroContext;
}

// ═══════════════════════════════════════════════════════════════
// GUARD FUNCTION
// ═══════════════════════════════════════════════════════════════

export function guardMacroContext(raw: RawMacroContext | null | undefined): GuardedMacroContext {
  // No macro context = neutral, no penalty
  if (!raw) {
    return {
      regime: 'NEUTRAL',
      riskLevel: 'LOW',
      confidenceMultiplier: 1.0,
      flags: [],
      blockedStrong: false,
      blockedAction: false,
      raw: {},
    };
  }
  
  // Validate regime
  const validRegimes = [
    'BTC_FLIGHT_TO_SAFETY',
    'PANIC_SELL_OFF',
    'BTC_LEADS_ALT_FOLLOW',
    'BTC_MAX_PRESSURE',
    'ALT_ROTATION',
    'FULL_RISK_OFF',
    'ALT_SEASON',
    'CAPITAL_EXIT',
    'NEUTRAL',
  ];
  const regime = validRegimes.includes(raw.regime || '') ? raw.regime! : 'NEUTRAL';
  
  // Validate risk level
  const validRisks = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
  const riskLevel = validRisks.includes(raw.riskLevel || '') 
    ? raw.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
    : 'MEDIUM';
  
  // CRITICAL: Macro can ONLY penalize (multiplier <= 1)
  const confidenceMultiplier = Math.min(raw.confidenceMultiplier ?? 1, 1);
  
  // Validate flags (remove any unknown flags)
  const validFlags = [
    'MACRO_PANIC',
    'MACRO_RISK_OFF',
    'MACRO_RISK_ON',
    'MACRO_EUPHORIA',
    'EXTREME_FEAR',
    'EXTREME_GREED',
    'BTC_DOM_UP',
    'BTC_DOM_DOWN',
    'STABLE_INFLOW',
    'STABLE_OUTFLOW',
    'RISK_REVERSAL',
    'STRONG_BLOCK',
  ];
  const flags = (raw.flags || []).filter(f => validFlags.includes(f));
  
  // Determine blocks
  const blockedStrong = 
    flags.includes('MACRO_PANIC') ||
    flags.includes('EXTREME_FEAR') ||
    flags.includes('STRONG_BLOCK') ||
    riskLevel === 'EXTREME' ||
    regime === 'PANIC_SELL_OFF' ||
    regime === 'CAPITAL_EXIT' ||
    regime === 'FULL_RISK_OFF';
  
  const blockedAction = regime === 'FULL_RISK_OFF';
  
  return {
    regime,
    riskLevel,
    confidenceMultiplier,
    flags,
    blockedStrong,
    blockedAction,
    raw,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

export function getMaxConfidenceByRisk(riskLevel: string): number {
  const caps: Record<string, number> = {
    'LOW': 0.85,
    'MEDIUM': 0.70,
    'HIGH': 0.55,
    'EXTREME': 0.45,
  };
  return caps[riskLevel] || 1.0;
}

export function getRiskLevelByRegime(regime: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
  const riskMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'> = {
    'ALT_SEASON': 'LOW',
    'BTC_LEADS_ALT_FOLLOW': 'LOW',
    'BTC_FLIGHT_TO_SAFETY': 'MEDIUM',
    'ALT_ROTATION': 'MEDIUM',
    'FULL_RISK_OFF': 'HIGH',
    'BTC_MAX_PRESSURE': 'HIGH',
    'PANIC_SELL_OFF': 'EXTREME',
    'CAPITAL_EXIT': 'EXTREME',
  };
  return riskMap[regime] || 'MEDIUM';
}

console.log('[Meta-Brain] Macro guard loaded');
