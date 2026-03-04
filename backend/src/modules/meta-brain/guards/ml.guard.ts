/**
 * ML RESULT GUARD
 * ===============
 * 
 * Sanitizes ML calibration results.
 * ML can ONLY lower confidence, NEVER:
 * - Change direction
 * - Increase confidence
 * - Bypass macro blocks
 */

export interface RawMLResult {
  applied?: boolean;
  modelId?: string;
  confidenceModifier?: number;
  suggestion?: 'BUY' | 'SELL' | 'AVOID';
  drift?: { state: string; score: number };
  mode?: string;
}

export interface GuardedMLResult {
  applied: boolean;
  modelId: string | null;
  confidenceModifier: number;  // Always <= 1
  suggestion: 'BUY' | 'SELL' | 'AVOID' | null;
  driftState: string;
  driftScore: number;
  mode: 'OFF' | 'SHADOW' | 'ACTIVE_SAFE';
  raw: RawMLResult;
}

// ═══════════════════════════════════════════════════════════════
// GUARD FUNCTION
// ═══════════════════════════════════════════════════════════════

export function guardMLResult(raw: RawMLResult | null | undefined): GuardedMLResult {
  // No ML result = no influence
  if (!raw) {
    return {
      applied: false,
      modelId: null,
      confidenceModifier: 1.0,
      suggestion: null,
      driftState: 'HEALTHY',
      driftScore: 0,
      mode: 'OFF',
      raw: {},
    };
  }
  
  // CRITICAL: ML can ONLY lower confidence (modifier <= 1)
  const confidenceModifier = Math.min(raw.confidenceModifier ?? 1, 1);
  
  // Validate suggestion
  const validSuggestions = ['BUY', 'SELL', 'AVOID'];
  const suggestion = validSuggestions.includes(raw.suggestion || '')
    ? raw.suggestion as 'BUY' | 'SELL' | 'AVOID'
    : null;
  
  // Validate mode
  const validModes = ['OFF', 'SHADOW', 'ACTIVE_SAFE'];
  const mode = validModes.includes(raw.mode || '')
    ? raw.mode as 'OFF' | 'SHADOW' | 'ACTIVE_SAFE'
    : 'OFF';
  
  return {
    applied: raw.applied ?? false,
    modelId: raw.modelId || null,
    confidenceModifier,
    suggestion,
    driftState: raw.drift?.state || 'HEALTHY',
    driftScore: raw.drift?.score || 0,
    mode,
    raw,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if ML tries to change direction
 */
export function mlTriesToChangeDirection(
  baseAction: 'BUY' | 'SELL' | 'AVOID',
  mlSuggestion: 'BUY' | 'SELL' | 'AVOID' | null
): boolean {
  if (mlSuggestion === null) return false;
  return mlSuggestion !== baseAction;
}

/**
 * Check if ML tries to increase confidence
 */
export function mlTriesToIncreaseConfidence(modifier: number): boolean {
  return modifier > 1;
}

/**
 * Get effective ML modifier (capped at 1)
 */
export function getEffectiveMLModifier(raw: RawMLResult | null): number {
  return Math.min(raw?.confidenceModifier ?? 1, 1);
}

console.log('[Meta-Brain] ML guard loaded');
