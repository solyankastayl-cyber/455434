/**
 * Phase D: Hypothesis Scoring
 * 
 * RULES:
 * 1. Score must be bounded [0,1]
 * 2. Score must be deterministic
 * 3. Score must be explainable
 * 4. Partial scoring must work for beam search (monotonic)
 */

import { clamp } from '../utils/clamp.js';
import { Hypothesis, PatternCandidate, HypothesisDirection } from './hypothesis_types.js';

export type ScoreContext = {
  // Future: market regime, vol gate, etc
};

export type ScoreResult = {
  score: number;
  direction: HypothesisDirection;
  reasons: string[];
};

/**
 * Normalize direction string to standard format
 */
function normalizeDirection(dir: string | undefined): 'BULL' | 'BEAR' | 'NEUTRAL' | 'BOTH' {
  if (!dir) return 'BOTH';
  const d = dir.toUpperCase();
  if (d === 'BULL' || d === 'BULLISH' || d === 'LONG') return 'BULL';
  if (d === 'BEAR' || d === 'BEARISH' || d === 'SHORT') return 'BEAR';
  if (d === 'NEUTRAL' || d === 'SIDEWAYS' || d === 'RANGE') return 'NEUTRAL';
  return 'BOTH';
}

/**
 * Infer hypothesis direction from component directions
 * 
 * Rule: 70%+ in one direction = that direction
 */
export function inferHypothesisDirection(components: PatternCandidate[]): HypothesisDirection {
  if (components.length === 0) return 'NEUTRAL';
  
  let bull = 0, bear = 0, neutral = 0;
  
  for (const c of components) {
    const dir = normalizeDirection(c.direction);
    if (dir === 'BULL') bull++;
    else if (dir === 'BEAR') bear++;
    else if (dir === 'NEUTRAL') neutral++;
    else {
      // BOTH = half-half
      bull += 0.5;
      bear += 0.5;
    }
  }
  
  const total = bull + bear + neutral;
  if (total === 0) return 'NEUTRAL';
  
  const bullFrac = bull / total;
  const bearFrac = bear / total;
  
  if (bullFrac >= 0.7) return 'BULL';
  if (bearFrac >= 0.7) return 'BEAR';
  return 'NEUTRAL';
}

/**
 * Direction consistency penalty
 * 
 * Mixed BULL+BEAR in same hypothesis = penalty
 */
export function directionPenalty(components: PatternCandidate[]): { penalty: number; reason: string } {
  if (components.length <= 1) return { penalty: 1.0, reason: 'single_component' };
  
  let bull = 0, bear = 0;
  for (const c of components) {
    const dir = normalizeDirection(c.direction);
    if (dir === 'BULL') bull++;
    if (dir === 'BEAR') bear++;
  }
  
  if (bull > 0 && bear > 0) {
    // Mixed directions = heavy penalty
    return { penalty: 0.55, reason: 'mixed_directions' };
  }
  return { penalty: 1.0, reason: 'direction_consistent' };
}

/**
 * Confluence bonus for natural pattern combinations
 * 
 * Examples:
 * - triangle + breakout = good
 * - reversal + divergence = good
 * - candle confirmation = small bonus
 */
export function confluenceBonus(components: PatternCandidate[]): { bonus: number; reasons: string[] } {
  const types = new Set(components.map(c => c.type));
  const groups = new Set(components.map(c => c.group));
  
  let bonus = 0;
  const reasons: string[] = [];
  
  // Geometry + Breakout link
  const geometryPatterns = ['TRIANGLE_ASC', 'TRIANGLE_DESC', 'TRIANGLE_SYM', 
                           'CHANNEL_UP', 'CHANNEL_DOWN', 'WEDGE_RISING', 'WEDGE_FALLING'];
  const breakoutPatterns = ['LEVEL_BREAKOUT', 'LEVEL_RETEST', 'BREAKOUT_RETEST_BULL', 'BREAKOUT_RETEST_BEAR'];
  
  if (geometryPatterns.some(p => types.has(p)) && breakoutPatterns.some(p => types.has(p))) {
    bonus += 0.06;
    reasons.push('geometry+breakout_link');
  }
  
  // Reversal + Divergence link
  const reversalPatterns = ['DOUBLE_TOP', 'DOUBLE_BOTTOM', 'HNS', 'IHNS', 
                           'HEAD_SHOULDERS', 'INVERTED_HEAD_SHOULDERS'];
  const divergencePatterns = ['DIVERGENCE_BULL_RSI', 'DIVERGENCE_BEAR_RSI', 
                             'DIVERGENCE_BULL_MACD', 'DIVERGENCE_BEAR_MACD'];
  
  if (reversalPatterns.some(p => types.has(p)) && divergencePatterns.some(p => types.has(p))) {
    bonus += 0.05;
    reasons.push('reversal+divergence_link');
  }
  
  // Candle confirmation
  if (groups.has('CANDLES')) {
    bonus += 0.03;
    reasons.push('candle_confirmation');
  }
  
  // MA confirmation
  if (types.has('MA_CROSS_GOLDEN') || types.has('MA_CROSS_DEATH')) {
    bonus += 0.03;
    reasons.push('ma_signal_confirmation');
  }
  
  return { bonus: clamp(bonus, 0, 0.15), reasons };
}

/**
 * Main hypothesis scoring function
 * 
 * Formula:
 * score = (0.65 * avg_finalScore + 0.35 * top_finalScore) * dirPenalty + confBonus
 */
export function scoreHypothesis(h: Hypothesis, _ctx?: ScoreContext): ScoreResult {
  const comps = h.components;
  
  if (comps.length === 0) {
    return { score: 0, direction: 'NEUTRAL', reasons: ['empty'] };
  }
  
  // Base score: mix of average and top
  const scores = comps.map(c => c.finalScore);
  const avg = scores.reduce((s, c) => s + c, 0) / scores.length;
  const top = Math.max(...scores);
  const base = 0.65 * avg + 0.35 * top;
  
  // Direction
  const dir = inferHypothesisDirection(comps);
  
  // Penalties and bonuses
  const dirPen = directionPenalty(comps);
  const conf = confluenceBonus(comps);
  
  // Final score
  const score = clamp(base * dirPen.penalty + conf.bonus, 0, 1);
  
  return {
    score,
    direction: dir,
    reasons: [
      `base=${base.toFixed(4)}`,
      `dir=${dir}`,
      `dirPenalty=${dirPen.penalty.toFixed(2)}(${dirPen.reason})`,
      ...conf.reasons.map(r => `bonus:${r}`),
    ],
  };
}
