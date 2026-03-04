/**
 * PHASE 1.3 — Divergence Detection Engine
 * =========================================
 * 
 * Detects divergences between system verdicts and actual market moves.
 * 
 * DEFINITION:
 * - BULLISH verdict + price goes DOWN → DIVERGENCE
 * - BEARISH verdict + price goes UP → DIVERGENCE
 * - NEUTRAL verdict + price moves significantly → DIVERGENCE
 */

import { 
  MarketPriceBar, 
  VerdictPoint, 
  DivergenceEvent,
  PriceDirection,
} from './chart.types.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface DivergenceConfig {
  horizonBars: number;    // How many bars forward to check
  threshold: number;      // Min return to consider "moved" (e.g., 0.02 = 2%)
  minConfidence: number;  // Min verdict confidence to check
}

const DEFAULT_CONFIG: DivergenceConfig = {
  horizonBars: 6,
  threshold: 0.02,
  minConfidence: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// DIVERGENCE DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect divergences between verdicts and price moves
 */
export function detectDivergences(
  prices: MarketPriceBar[],
  verdicts: VerdictPoint[],
  config: Partial<DivergenceConfig> = {}
): DivergenceEvent[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const divergences: DivergenceEvent[] = [];
  
  if (prices.length < cfg.horizonBars + 1) {
    return divergences;
  }
  
  // Index prices by timestamp for quick lookup
  const priceMap = new Map(prices.map(p => [p.ts, p]));
  const sortedPrices = [...prices].sort((a, b) => a.ts - b.ts);
  
  // Helper to find price bar index at or after timestamp
  function findPriceIndex(ts: number): number {
    let lo = 0, hi = sortedPrices.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedPrices[mid].ts >= ts) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }
  
  for (const v of verdicts) {
    // Skip low confidence verdicts
    if (v.confidence < cfg.minConfidence) continue;
    
    // Skip NEUTRAL and NO_DATA for divergence detection
    if (v.verdict === 'NEUTRAL' || v.verdict === 'INCONCLUSIVE' || v.verdict === 'NO_DATA') {
      continue;
    }
    
    // Find price at verdict time
    const i0 = findPriceIndex(v.ts);
    if (i0 < 0 || i0 >= sortedPrices.length) continue;
    
    // Find price after horizon
    const i1 = Math.min(i0 + cfg.horizonBars, sortedPrices.length - 1);
    if (i1 <= i0) continue;
    
    const p0 = sortedPrices[i0].c;
    const p1 = sortedPrices[i1].c;
    const ret = (p1 - p0) / p0;
    const magnitude = Math.abs(ret);
    
    // Determine actual price direction
    const actualMove: PriceDirection = 
      ret > cfg.threshold / 2 ? 'UP' :
      ret < -cfg.threshold / 2 ? 'DOWN' : 'FLAT';
    
    // Expected direction based on verdict
    const expectedMove: PriceDirection = 
      v.verdict === 'BULLISH' ? 'UP' : 'DOWN';
    
    // Check for divergence
    let isDivergence = false;
    let reason = '';
    
    if (v.verdict === 'BULLISH' && ret <= -cfg.threshold) {
      isDivergence = true;
      reason = `BULLISH_but_price_DOWN_${(ret * 100).toFixed(1)}%`;
    } else if (v.verdict === 'BEARISH' && ret >= cfg.threshold) {
      isDivergence = true;
      reason = `BEARISH_but_price_UP_+${(ret * 100).toFixed(1)}%`;
    }
    
    if (isDivergence) {
      divergences.push({
        ts: v.ts,
        verdict: v.verdict,
        expectedMove,
        actualMove,
        magnitude,
        horizonBars: i1 - i0,
        reason,
      });
    }
  }
  
  return divergences;
}

/**
 * Calculate divergence statistics
 */
export function calculateDivergenceStats(
  verdicts: VerdictPoint[],
  divergences: DivergenceEvent[]
): {
  totalVerdicts: number;
  totalDivergences: number;
  divergenceRate: number;
  avgMagnitude: number;
  byVerdict: Record<string, { total: number; diverged: number; rate: number }>;
} {
  const validVerdicts = verdicts.filter(v => 
    v.verdict !== 'NEUTRAL' && v.verdict !== 'INCONCLUSIVE' && v.verdict !== 'NO_DATA'
  );
  
  const byVerdict: Record<string, { total: number; diverged: number; rate: number }> = {};
  
  // Count verdicts by type
  for (const v of validVerdicts) {
    if (!byVerdict[v.verdict]) {
      byVerdict[v.verdict] = { total: 0, diverged: 0, rate: 0 };
    }
    byVerdict[v.verdict].total++;
  }
  
  // Count divergences by verdict type
  for (const d of divergences) {
    if (byVerdict[d.verdict]) {
      byVerdict[d.verdict].diverged++;
    }
  }
  
  // Calculate rates
  for (const key of Object.keys(byVerdict)) {
    byVerdict[key].rate = byVerdict[key].total > 0 
      ? byVerdict[key].diverged / byVerdict[key].total 
      : 0;
  }
  
  const avgMagnitude = divergences.length > 0
    ? divergences.reduce((sum, d) => sum + d.magnitude, 0) / divergences.length
    : 0;
  
  return {
    totalVerdicts: validVerdicts.length,
    totalDivergences: divergences.length,
    divergenceRate: validVerdicts.length > 0 ? divergences.length / validVerdicts.length : 0,
    avgMagnitude,
    byVerdict,
  };
}

console.log('[Phase 1.3] Divergence Service loaded');
