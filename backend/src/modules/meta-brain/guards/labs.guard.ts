/**
 * LABS RESULT GUARD
 * =================
 * 
 * Labs are STRICTLY READ-ONLY.
 * They provide insights but CANNOT:
 * - Make decisions
 * - Change confidence
 * - Influence verdict
 * 
 * Labs output is ONLY for explainability.
 */

export interface RawLabsResult {
  insights?: Array<{
    labId: string;
    state: string;
    confidence: number;
    direction?: string;
  }>;
  attribution?: {
    supporting: any[];
    opposing: any[];
    neutral: any[];
  };
  influence?: number;  // MUST be 0
}

export interface GuardedLabsResult {
  /** Labs ALWAYS have 0 influence */
  influence: 0;
  
  /** Sanitized insights for explainability */
  insights: Array<{
    labId: string;
    state: string;
    confidence: number;
    direction: string;
  }>;
  
  /** Attribution data (for UI only) */
  attribution: {
    supporting: number;
    opposing: number;
    neutral: number;
  };
  
  /** Raw data preserved */
  raw: RawLabsResult;
}

// ═══════════════════════════════════════════════════════════════
// GUARD FUNCTION
// ═══════════════════════════════════════════════════════════════

export function guardLabs(raw: RawLabsResult | null | undefined): GuardedLabsResult {
  // No labs = empty read-only result
  if (!raw) {
    return {
      influence: 0,  // 🔒 ALWAYS 0
      insights: [],
      attribution: { supporting: 0, opposing: 0, neutral: 0 },
      raw: {},
    };
  }
  
  // CRITICAL: Labs ALWAYS have 0 influence
  // Even if raw.influence is set, we ignore it
  
  // Sanitize insights
  const insights = (raw.insights || []).map(ins => ({
    labId: ins.labId || 'unknown',
    state: ins.state || 'UNKNOWN',
    confidence: Math.min(Math.max(ins.confidence || 0, 0), 1),
    direction: ins.direction || 'NEUTRAL',
  }));
  
  // Count attribution
  const attribution = {
    supporting: raw.attribution?.supporting?.length || 0,
    opposing: raw.attribution?.opposing?.length || 0,
    neutral: raw.attribution?.neutral?.length || 0,
  };
  
  return {
    influence: 0,  // 🔒 ALWAYS 0
    insights,
    attribution,
    raw,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if Labs have conflict
 */
export function hasLabsConflict(guarded: GuardedLabsResult): boolean {
  return guarded.attribution.supporting > 0 && guarded.attribution.opposing > 0;
}

/**
 * Get dominant direction from labs (for explainability only)
 */
export function getLabsDominantDirection(guarded: GuardedLabsResult): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (guarded.attribution.supporting > guarded.attribution.opposing) return 'BULLISH';
  if (guarded.attribution.opposing > guarded.attribution.supporting) return 'BEARISH';
  return 'NEUTRAL';
}

console.log('[Meta-Brain] Labs guard loaded');
