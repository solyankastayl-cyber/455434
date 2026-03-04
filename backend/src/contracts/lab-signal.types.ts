/**
 * P1.2 — LAB SIGNAL CONTRACT
 * ==========================
 * 
 * Единый контракт для всех Labs при передаче в Meta-Brain.
 * Используется для attribution и explainability.
 * 
 * RULES:
 * - Каждый Lab ОБЯЗАН вернуть LabSignal
 * - Никаких кастомных форматов
 * - Никаких boolean-only сигналов
 * - Никаких side-effects
 */

// ═══════════════════════════════════════════════════════════════
// P1.2 — LAB SIGNAL (CANONICAL)
// ═══════════════════════════════════════════════════════════════

export type LabDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type LabStrength = 'WEAK' | 'MEDIUM' | 'STRONG';

export interface LabEvidence {
  metric: string;
  value: number;
  interpretation: string;
}

export interface LabSignal {
  labId: string;                    // e.g., 'whale', 'volume', 'momentum'
  direction: LabDirection;          // Market bias
  confidence: number;               // 0.0 - 1.0
  strength: LabStrength;            // Signal strength
  context: string[];                // Short tags: ['ACCUMULATION', 'HIGH_ACTIVITY']
  evidence: LabEvidence[];          // Numeric evidence only
  timestamp: number;                // Unix ms
}

// ═══════════════════════════════════════════════════════════════
// P1.3 — META-BRAIN ATTRIBUTION
// ═══════════════════════════════════════════════════════════════

export interface LabAttribution {
  source: string;                   // Lab ID
  impact: number;                   // -1.0 to +1.0 (negative = opposing)
  confidence: number;               // Lab's confidence in its signal
  reason: string;                   // One-line explanation
}

export interface VerdictAttribution {
  supporting: LabSignal[];          // Labs that support the decision
  opposing: LabSignal[];            // Labs that oppose the decision
  neutral: LabSignal[];             // Labs with neutral signal
  ignored: Array<{                  // Labs that were ignored and why
    labId: string;
    reason: string;
  }>;
  summary: {
    totalLabs: number;
    supportingCount: number;
    opposingCount: number;
    neutralCount: number;
    dominantDirection: LabDirection;
    confidenceAdjustment: number;   // How much Labs affected final confidence
  };
}

// ═══════════════════════════════════════════════════════════════
// P1.4 — EXPLAINABILITY BLOCKS
// ═══════════════════════════════════════════════════════════════

export interface ExplainBlock {
  title: string;                    // e.g., "WHY BUY", "WHY NOT BUY"
  summary: string;                  // One sentence summary
  bullets: string[];                // Detail points
  tone: 'positive' | 'negative' | 'neutral' | 'warning';
}

export interface VerdictExplainability {
  decision: ExplainBlock;           // Main decision explanation
  macroContext: ExplainBlock;       // Macro regime impact
  labsImpact: ExplainBlock;         // Labs contribution
  risks: ExplainBlock;              // Risk factors
  confidence: ExplainBlock;         // Why this confidence level
}

// ═══════════════════════════════════════════════════════════════
// CONVERSION HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert any LabResult to LabSignal
 */
export function toLabSignal(
  labId: string,
  state: string,
  confidence: number,
  signals: Record<string, any>,
  explain: { summary: string; details: string[] }
): LabSignal {
  // Determine direction from state
  const direction = determineDirection(state, signals);
  
  // Determine strength from confidence
  const strength = determineStrength(confidence);
  
  // Extract context tags
  const context = extractContextTags(state, signals);
  
  // Extract numeric evidence
  const evidence = extractEvidence(signals);
  
  return {
    labId,
    direction,
    confidence,
    strength,
    context,
    evidence,
    timestamp: Date.now(),
  };
}

/**
 * Determine direction from lab state
 */
function determineDirection(state: string, signals: any): LabDirection {
  // Bullish states
  const bullishStates = [
    'ACCUMULATION', 'TRENDING_UP', 'BUY_DOMINANT', 'STRONG_SUPPORT',
    'ACCELERATING', 'BROAD_PARTICIPATION', 'STRONG_CONFIRMATION',
  ];
  
  // Bearish states
  const bearishStates = [
    'DISTRIBUTION', 'TRENDING_DOWN', 'SELL_DOMINANT', 'STRONG_RESISTANCE',
    'DECELERATING', 'DISTRIBUTION_RISK', 'PANIC', 'CASCADE_RISK',
    'LONGS_AT_RISK', 'STOP_HUNT_RISK', 'ACTIVE_MANIPULATION',
  ];
  
  if (bullishStates.includes(state)) return 'BULLISH';
  if (bearishStates.includes(state)) return 'BEARISH';
  
  // Check signals for direction hints
  if (signals.dominantDirection === 'up' || signals.netFlow > 0) return 'BULLISH';
  if (signals.dominantDirection === 'down' || signals.netFlow < 0) return 'BEARISH';
  
  return 'NEUTRAL';
}

/**
 * Determine strength from confidence
 */
function determineStrength(confidence: number): LabStrength {
  if (confidence >= 0.75) return 'STRONG';
  if (confidence >= 0.50) return 'MEDIUM';
  return 'WEAK';
}

/**
 * Extract context tags from state and signals
 */
function extractContextTags(state: string, signals: any): string[] {
  const tags: string[] = [state];
  
  // Add signal-based tags
  if (signals.volumeTrend === 'increasing') tags.push('VOLUME_UP');
  if (signals.volumeTrend === 'decreasing') tags.push('VOLUME_DOWN');
  if (signals.anomalies?.length > 0) tags.push('ANOMALY');
  if (signals.whaleActivity === 'high') tags.push('WHALE_ACTIVE');
  if (signals.liquidationVolume > 0) tags.push('LIQUIDATIONS');
  if (signals.divergence === 'bullish') tags.push('BULLISH_DIV');
  if (signals.divergence === 'bearish') tags.push('BEARISH_DIV');
  if (signals.cascadeProbability > 0.5) tags.push('CASCADE_RISK');
  
  return tags.slice(0, 5); // Max 5 tags
}

/**
 * Extract numeric evidence from signals
 */
function extractEvidence(signals: any): LabEvidence[] {
  const evidence: LabEvidence[] = [];
  
  // Map common signal fields to evidence
  const mappings: Array<[string, string]> = [
    ['relativeVolume', 'Relative Volume'],
    ['buySellImbalance', 'Buy/Sell Imbalance'],
    ['netFlow', 'Net Flow'],
    ['rsi', 'RSI'],
    ['stressIndex', 'Stress Index'],
    ['fundingRate', 'Funding Rate'],
    ['largeTradeFlow', 'Large Trade Flow'],
    ['cascadeProbability', 'Cascade Probability'],
    ['stabilityScore', 'Stability Score'],
    ['conflictScore', 'Conflict Score'],
    ['volRatio', 'Volatility Ratio'],
    ['depthRatio', 'Depth Ratio'],
  ];
  
  for (const [key, label] of mappings) {
    if (typeof signals[key] === 'number') {
      evidence.push({
        metric: key,
        value: signals[key],
        interpretation: interpretMetric(key, signals[key]),
      });
    }
  }
  
  return evidence.slice(0, 5); // Max 5 evidence items
}

/**
 * Interpret metric value
 */
function interpretMetric(metric: string, value: number): string {
  switch (metric) {
    case 'relativeVolume':
      if (value > 2) return 'Very high volume';
      if (value > 1.5) return 'Above average volume';
      if (value < 0.5) return 'Low volume';
      return 'Normal volume';
    
    case 'rsi':
      if (value > 70) return 'Overbought';
      if (value < 30) return 'Oversold';
      return 'Neutral';
    
    case 'stressIndex':
      if (value > 0.7) return 'High stress';
      if (value > 0.4) return 'Moderate stress';
      return 'Low stress';
    
    case 'cascadeProbability':
      if (value > 0.7) return 'High cascade risk';
      if (value > 0.4) return 'Moderate cascade risk';
      return 'Low cascade risk';
    
    default:
      if (value > 0.5) return 'Elevated';
      if (value < -0.5) return 'Depressed';
      return 'Normal';
  }
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const LAB_WEIGHTS: Record<string, number> = {
  // High impact labs
  whale: 0.15,
  volume: 0.12,
  momentum: 0.10,
  liquidation: 0.10,
  
  // Medium impact labs
  flow: 0.08,
  regime: 0.08,
  marketStress: 0.08,
  accumulation: 0.08,
  
  // Lower impact labs
  volatility: 0.05,
  liquidity: 0.05,
  manipulation: 0.05,
  corridor: 0.03,
  supportResistance: 0.03,
};

console.log('[P1.2] LabSignal contract loaded');
