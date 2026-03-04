/**
 * SPX STRATEGY ENGINE v1.0 — Production Locked
 * 
 * Any change must be asset-agnostic and backward compatible.
 * 
 * Provides actionable trading recommendations based on SPX Fractal analysis.
 * 
 * NOT a copy of BTC logic.
 * Uses SPX-specific inputs:
 * - forecastReturn
 * - probUp
 * - entropy
 * - tailRisk
 * - volRegime
 * - phase
 * 
 * Returns human-readable recommendations:
 * - What to do? (action)
 * - How confident? (confidence)
 * - How much? (size)
 * - Why? (reasons)
 * - What risks? (riskNotes)
 * 
 * @module spx/strategy
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SpxStrategyPreset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type SpxVolRegime = 'NORMAL' | 'ELEVATED' | 'CRISIS';
export type SpxStrategyAction = 'BUY' | 'HOLD' | 'REDUCE';
export type SpxConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SpxStrategyInput {
  forecastReturn: number;   // e.g., 0.01 = +1%
  probUp: number;           // e.g., 0.64 = 64%
  entropy: number;          // e.g., 0.8 (0-1, lower is better)
  tailRisk: number;         // e.g., -0.05 = -5% worst case
  volRegime: SpxVolRegime;  // NORMAL | ELEVATED | CRISIS
  phase: string;            // ACCUMULATION | MARKUP | DISTRIBUTION | MARKDOWN | NEUTRAL
  preset: SpxStrategyPreset;
  horizon: string;          // e.g., '30d'
}

export interface SpxStrategyResult {
  asset: 'SPX';
  horizon: string;
  preset: SpxStrategyPreset;
  action: SpxStrategyAction;
  confidence: SpxConfidenceLevel;
  size: number;             // 0-1, position size multiplier
  reasons: string[];        // Why this recommendation
  riskNotes: string[];      // What risks to consider
  meta: {
    forecastReturn: number;
    probUp: number;
    entropy: number;
    volRegime: SpxVolRegime;
    phase: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// PRESET MULTIPLIERS
// ═══════════════════════════════════════════════════════════════

const PRESET_MULTIPLIERS: Record<SpxStrategyPreset, number> = {
  CONSERVATIVE: 0.5,
  BALANCED: 1.0,
  AGGRESSIVE: 1.5,
};

// ═══════════════════════════════════════════════════════════════
// STRATEGY RESOLVER
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve SPX Strategy recommendation based on input signals.
 * 
 * Decision Logic v1 (simple, transparent):
 * 
 * BUY:
 *   - forecastReturn > 0 AND probUp > 60% AND entropy < 0.9
 * 
 * REDUCE:
 *   - forecastReturn < 0
 * 
 * HOLD:
 *   - volRegime === 'CRISIS'
 *   - Default if no clear signal
 * 
 * Size:
 *   - Base = forecastReturn * 5 (capped at 1)
 *   - Multiplied by preset
 *   - Zero in CRISIS
 */
export function resolveSpxStrategy(input: SpxStrategyInput): SpxStrategyResult {
  const {
    forecastReturn,
    probUp,
    entropy,
    tailRisk,
    volRegime,
    phase,
    preset,
    horizon,
  } = input;

  let action: SpxStrategyAction = 'HOLD';
  let confidence: SpxConfidenceLevel = 'LOW';

  // ─────────────────────────────────────────────────────────────
  // DECISION LOGIC v1
  // ─────────────────────────────────────────────────────────────

  // Crisis mode overrides everything
  if (volRegime === 'CRISIS') {
    action = 'HOLD';
    confidence = 'LOW';
  }
  // Strong buy signal
  else if (forecastReturn > 0 && probUp >= 0.6 && entropy < 0.9) {
    action = 'BUY';
    
    // Confidence levels based on signal strength
    if (forecastReturn > 0.03 && probUp > 0.7 && entropy < 0.6) {
      confidence = 'HIGH';
    } else if (forecastReturn > 0.015 && probUp > 0.55) {
      confidence = 'MEDIUM';
    } else {
      confidence = 'LOW';
    }
  }
  // Negative forecast suggests reduce exposure
  else if (forecastReturn < -0.01) {
    action = 'REDUCE';
    confidence = Math.abs(forecastReturn) > 0.03 ? 'MEDIUM' : 'LOW';
  }
  // Near-zero forecast or uncertain conditions
  else {
    action = 'HOLD';
    confidence = 'LOW';
  }

  // ─────────────────────────────────────────────────────────────
  // SIZE CALCULATION
  // ─────────────────────────────────────────────────────────────

  let size: number;

  // HOLD = no position change, size = 0
  if (action === 'HOLD') {
    size = 0;
  }
  // CRISIS = forced exit, size = 0
  else if (volRegime === 'CRISIS') {
    size = 0;
  }
  // REDUCE = shrink position based on negative forecast severity
  else if (action === 'REDUCE') {
    // Base reduction size
    const baseSize = Math.max(0, 0.5 + forecastReturn * 2);
    // Apply preset multiplier (AGGRESSIVE reduces more, CONSERVATIVE less)
    const presetMultiplier = PRESET_MULTIPLIERS[preset];
    size = baseSize * presetMultiplier;
    // Cap at 1.0
    size = Math.min(size, 1);
  }
  // BUY = calculate position based on signal strength
  else {
    // Base size proportional to forecast
    const baseSize = Math.max(0, forecastReturn * 5);
    
    // Apply preset multiplier
    const presetMultiplier = PRESET_MULTIPLIERS[preset];
    size = baseSize * presetMultiplier;
    
    // Cap at 1.0
    size = Math.min(size, 1);
    
    // Reduce if entropy is high
    if (entropy > 0.75) {
      size *= 0.8;
    }
    
    // Reduce if elevated volatility
    if (volRegime === 'ELEVATED') {
      size *= 0.85;
    }
  }

  // Round to 2 decimal places
  size = Number(size.toFixed(2));

  // ─────────────────────────────────────────────────────────────
  // BUILD REASONS & RISK NOTES
  // ─────────────────────────────────────────────────────────────

  const reasons = buildReasons(input, action);
  const riskNotes = buildRiskNotes(input);

  return {
    asset: 'SPX',
    horizon,
    preset,
    action,
    confidence,
    size,
    reasons,
    riskNotes,
    meta: {
      forecastReturn,
      probUp,
      entropy,
      volRegime,
      phase,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// REASON BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildReasons(input: SpxStrategyInput, action: SpxStrategyAction): string[] {
  const reasons: string[] = [];
  const { forecastReturn, probUp, entropy, volRegime, phase } = input;
  
  const forecastPct = (forecastReturn * 100).toFixed(1);
  const probUpPct = (probUp * 100).toFixed(0);

  if (action === 'BUY') {
    if (forecastReturn > 0) {
      reasons.push(`Forecast positive (+${forecastPct}%)`);
    }
    if (probUp > 0.6) {
      reasons.push(`ProbUp ${probUpPct}%`);
    }
    if (volRegime === 'NORMAL') {
      reasons.push('Volatility normal');
    }
    if (phase === 'MARKUP' || phase === 'ACCUMULATION') {
      reasons.push(`Favorable phase: ${phase}`);
    }
  } else if (action === 'REDUCE') {
    if (forecastReturn < 0) {
      reasons.push(`Forecast negative (${forecastPct}%)`);
    }
    if (probUp < 0.5) {
      reasons.push(`ProbUp low (${probUpPct}%)`);
    }
    if (phase === 'MARKDOWN' || phase === 'DISTRIBUTION') {
      reasons.push(`Risk phase: ${phase}`);
    }
  } else {
    // HOLD
    if (volRegime === 'CRISIS') {
      reasons.push('CRISIS mode active');
    }
    if (entropy > 0.7) {
      reasons.push('High uncertainty');
    }
    if (Math.abs(forecastReturn) < 0.01) {
      reasons.push('No clear directional signal');
    }
  }

  // Ensure at least one reason
  if (reasons.length === 0) {
    reasons.push('Default position');
  }

  return reasons;
}

function buildRiskNotes(input: SpxStrategyInput): string[] {
  const notes: string[] = [];
  const { entropy, tailRisk, volRegime, probUp } = input;

  if (entropy > 0.75) {
    notes.push(`High uncertainty (entropy ${entropy.toFixed(2)})`);
  }

  if (tailRisk < -0.05) {
    notes.push(`Elevated tail risk (${(tailRisk * 100).toFixed(1)}%)`);
  }

  if (volRegime === 'ELEVATED') {
    notes.push('Elevated volatility environment');
  }

  if (volRegime === 'CRISIS') {
    notes.push('CRISIS: Position sizing disabled');
  }

  if (probUp < 0.6 && probUp > 0.4) {
    notes.push('Directional uncertainty (probUp ~50%)');
  }

  return notes;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  resolveSpxStrategy,
};
