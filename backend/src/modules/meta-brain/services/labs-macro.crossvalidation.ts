/**
 * LABS ↔ MACRO CROSS-VALIDATION
 * =============================
 * 
 * P1.9: Labs signals that conflict with HIGH_RISK Macro regime
 * are IGNORED, with explicit logging.
 * 
 * Rule: Labs can ONLY reinforce signals when:
 * - Macro != HIGH_RISK and Macro != EXTREME
 * - Direction matches (Labs bullish + Macro allows bullish)
 * 
 * If conflict → Lab signal is IGNORED with reason: MACRO_CONFLICT
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type MacroRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type LabDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type MacroBias = 'BTC_ONLY' | 'ALTS' | 'DEFENSIVE' | 'NEUTRAL';

export interface LabSignal {
  labId: string;
  direction: LabDirection;
  strength: number;  // 0..1
  confidence: number;
}

export interface MacroContext {
  regime: string;
  riskLevel: MacroRiskLevel;
  bias: MacroBias;
  blockedActions: ('BUY' | 'SELL')[];
  flags: string[];
}

export interface CrossValidationResult {
  labId: string;
  originalDirection: LabDirection;
  originalStrength: number;
  
  /** Was the signal kept or ignored? */
  status: 'KEPT' | 'IGNORED' | 'REDUCED';
  
  /** Final direction after cross-validation */
  finalDirection: LabDirection;
  
  /** Final strength after cross-validation */
  finalStrength: number;
  
  /** Reason for status */
  reason: string;
  
  /** Conflict details */
  conflict?: {
    type: 'RISK_LEVEL' | 'DIRECTION' | 'BIAS';
    macroState: string;
    labState: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-VALIDATION RULES
// ═══════════════════════════════════════════════════════════════

/**
 * Validate a Lab signal against current Macro context.
 * 
 * Rules:
 * 1. HIGH/EXTREME risk → bullish Labs are IGNORED
 * 2. DEFENSIVE bias → bullish Labs are REDUCED
 * 3. Direction conflict with blocked actions → IGNORED
 */
export function crossValidateLabSignal(
  lab: LabSignal,
  macro: MacroContext
): CrossValidationResult {
  const result: CrossValidationResult = {
    labId: lab.labId,
    originalDirection: lab.direction,
    originalStrength: lab.strength,
    status: 'KEPT',
    finalDirection: lab.direction,
    finalStrength: lab.strength,
    reason: 'No conflict detected',
  };
  
  // Rule 1: HIGH/EXTREME risk blocks bullish Labs
  if (
    (macro.riskLevel === 'HIGH' || macro.riskLevel === 'EXTREME') &&
    lab.direction === 'BULLISH'
  ) {
    result.status = 'IGNORED';
    result.finalDirection = 'NEUTRAL';
    result.finalStrength = 0;
    result.reason = 'MACRO_CONFLICT: Bullish Lab ignored in HIGH/EXTREME risk';
    result.conflict = {
      type: 'RISK_LEVEL',
      macroState: `${macro.riskLevel} risk`,
      labState: 'BULLISH signal',
    };
    
    console.log(
      `[Labs-Macro] IGNORED: ${lab.labId} (${lab.direction}) conflicts with ${macro.riskLevel} risk`
    );
    
    return result;
  }
  
  // Rule 2: DEFENSIVE bias reduces bullish Labs
  if (macro.bias === 'DEFENSIVE' && lab.direction === 'BULLISH') {
    result.status = 'REDUCED';
    result.finalStrength = lab.strength * 0.5;  // 50% reduction
    result.reason = 'MACRO_DEFENSIVE: Bullish Lab strength reduced in defensive environment';
    result.conflict = {
      type: 'BIAS',
      macroState: 'DEFENSIVE bias',
      labState: 'BULLISH signal',
    };
    
    console.log(
      `[Labs-Macro] REDUCED: ${lab.labId} (${lab.direction}) strength ${lab.strength} → ${result.finalStrength}`
    );
    
    return result;
  }
  
  // Rule 3: Direction vs blocked actions
  if (lab.direction === 'BULLISH' && macro.blockedActions.includes('BUY')) {
    result.status = 'IGNORED';
    result.finalDirection = 'NEUTRAL';
    result.finalStrength = 0;
    result.reason = 'MACRO_BLOCK: BUY actions blocked by macro';
    result.conflict = {
      type: 'DIRECTION',
      macroState: 'BUY blocked',
      labState: 'BULLISH signal',
    };
    
    console.log(
      `[Labs-Macro] IGNORED: ${lab.labId} (BULLISH) blocked by macro BUY restriction`
    );
    
    return result;
  }
  
  if (lab.direction === 'BEARISH' && macro.blockedActions.includes('SELL')) {
    result.status = 'IGNORED';
    result.finalDirection = 'NEUTRAL';
    result.finalStrength = 0;
    result.reason = 'MACRO_BLOCK: SELL actions blocked by macro';
    result.conflict = {
      type: 'DIRECTION',
      macroState: 'SELL blocked',
      labState: 'BEARISH signal',
    };
    
    console.log(
      `[Labs-Macro] IGNORED: ${lab.labId} (BEARISH) blocked by macro SELL restriction`
    );
    
    return result;
  }
  
  // Rule 4: EXTREME regimes suppress all aggressive Labs
  if (
    macro.riskLevel === 'EXTREME' &&
    lab.direction !== 'NEUTRAL' &&
    lab.strength > 0.5
  ) {
    result.status = 'REDUCED';
    result.finalStrength = Math.min(lab.strength, 0.5);
    result.reason = 'MACRO_EXTREME: Strong Lab signals capped in extreme conditions';
    result.conflict = {
      type: 'RISK_LEVEL',
      macroState: 'EXTREME risk',
      labState: `${lab.direction} strength ${lab.strength}`,
    };
    
    console.log(
      `[Labs-Macro] REDUCED: ${lab.labId} strength capped to 0.5 in EXTREME risk`
    );
    
    return result;
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// BATCH VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface BatchValidationResult {
  totalLabs: number;
  kept: number;
  ignored: number;
  reduced: number;
  results: CrossValidationResult[];
  conflicts: Array<{ labId: string; reason: string }>;
}

export function crossValidateAllLabs(
  labs: LabSignal[],
  macro: MacroContext
): BatchValidationResult {
  const results = labs.map(lab => crossValidateLabSignal(lab, macro));
  
  const kept = results.filter(r => r.status === 'KEPT').length;
  const ignored = results.filter(r => r.status === 'IGNORED').length;
  const reduced = results.filter(r => r.status === 'REDUCED').length;
  
  const conflicts = results
    .filter(r => r.status !== 'KEPT')
    .map(r => ({ labId: r.labId, reason: r.reason }));
  
  if (ignored > 0) {
    console.log(
      `[Labs-Macro] Cross-validation: ${kept}/${labs.length} kept, ${ignored} ignored, ${reduced} reduced`
    );
  }
  
  return {
    totalLabs: labs.length,
    kept,
    ignored,
    reduced,
    results,
    conflicts,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if Labs consensus is allowed given Macro state
 */
export function isLabsConsensusAllowed(
  labsDirection: LabDirection,
  macro: MacroContext
): boolean {
  // Neutral is always allowed
  if (labsDirection === 'NEUTRAL') return true;
  
  // In HIGH/EXTREME risk, bullish consensus not allowed
  if (
    labsDirection === 'BULLISH' &&
    (macro.riskLevel === 'HIGH' || macro.riskLevel === 'EXTREME')
  ) {
    return false;
  }
  
  // Check blocked actions
  if (labsDirection === 'BULLISH' && macro.blockedActions.includes('BUY')) {
    return false;
  }
  if (labsDirection === 'BEARISH' && macro.blockedActions.includes('SELL')) {
    return false;
  }
  
  return true;
}

/**
 * Get effective Labs influence after Macro validation
 */
export function getEffectiveLabsInfluence(
  labsStrength: number,
  macro: MacroContext
): number {
  // Labs are READ-ONLY in P1.2, but this calculates theoretical influence
  
  if (macro.riskLevel === 'EXTREME') {
    return 0; // No influence in extreme conditions
  }
  
  if (macro.riskLevel === 'HIGH') {
    return labsStrength * 0.3; // 70% reduction
  }
  
  if (macro.bias === 'DEFENSIVE') {
    return labsStrength * 0.5; // 50% reduction
  }
  
  return labsStrength * 0.7; // Default 30% cap (Labs don't drive decisions)
}

console.log('[Labs-Macro] Cross-validation module loaded');
