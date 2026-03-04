/**
 * LIQUIDITY IMPULSE ENGINE — P2.2
 * 
 * Computes net liquidity impulse from Fed data:
 * 
 * liquidityImpulse = + Z(ΔWALCL) - Z(ΔRRP) - Z(ΔTGA)
 * 
 * Signs are critical:
 * - WALCL expansion → positive impulse (adds liquidity)
 * - RRP increase → negative impulse (absorbs liquidity)
 * - TGA increase → negative impulse (absorbs liquidity)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import {
  LIQUIDITY_SERIES,
  LiquidityState,
  LiquidityRegime,
  REGIME_THRESHOLDS,
  LiquidityContext,
  LiquiditySeriesContext,
} from './liquidity.contract.js';
import { buildLiquiditySeriesContext } from './liquidity.context.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════════════════════
// IMPULSE CALCULATION (P2.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute liquidity impulse from components
 * 
 * Formula: liquidityImpulse = + Z(ΔWALCL) - Z(ΔRRP) - Z(ΔTGA)
 * 
 * Uses 4-week delta Z-scores as primary signal
 * Falls back to 13w if 4w unavailable
 */
export function computeLiquidityImpulse(
  walcl: LiquiditySeriesContext,
  rrp: LiquiditySeriesContext,
  tga: LiquiditySeriesContext
): LiquidityState {
  // Get Z-scores (prefer 4w, fallback to 13w)
  const getZ = (ctx: LiquiditySeriesContext): number | null => {
    if (ctx.zscores.z4w !== null) return ctx.zscores.z4w;
    if (ctx.zscores.z13w !== null) return ctx.zscores.z13w;
    return null;
  };
  
  const zWalcl = getZ(walcl);
  const zRrp = getZ(rrp);
  const zTga = getZ(tga);
  
  // Count available components
  const available = [zWalcl, zRrp, zTga].filter(z => z !== null).length;
  
  // If no data, return neutral state
  if (available === 0) {
    return {
      impulse: 0,
      regime: 'NEUTRAL',
      confidence: 0,
      components: { walcl: 0, rrp: 0, tga: 0 },
    };
  }
  
  // Apply signs:
  // WALCL: positive sign (expansion = positive impulse)
  // RRP: negative sign (RRP absorbs → positive RRP = negative impulse)
  // TGA: negative sign (TGA absorbs → positive TGA = negative impulse)
  const walclComponent = (zWalcl ?? 0) * LIQUIDITY_SERIES.WALCL.sign;  // +1
  const rrpComponent = (zRrp ?? 0) * LIQUIDITY_SERIES.RRPONTSYD.sign;  // -1 (already negative)
  const tgaComponent = (zTga ?? 0) * LIQUIDITY_SERIES.WTREGEN.sign;    // -1 (already negative)
  
  // Sum components
  const rawImpulse = walclComponent + rrpComponent + tgaComponent;
  
  // Normalize by number of available components to keep scale consistent
  const normalizedImpulse = (rawImpulse * 3) / available;
  
  // Clamp to -3..+3 range
  const impulse = clamp(normalizedImpulse, -3, 3);
  
  // Classify regime
  const regime = classifyRegime(impulse);
  
  // Confidence based on data availability and signal strength
  const confidence = computeConfidence(available, Math.abs(impulse));
  
  return {
    impulse: Math.round(impulse * 1000) / 1000,
    regime,
    confidence: Math.round(confidence * 1000) / 1000,
    components: {
      walcl: Math.round(walclComponent * 1000) / 1000,
      rrp: Math.round(rrpComponent * 1000) / 1000,
      tga: Math.round(tgaComponent * 1000) / 1000,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION (P2.3)
// ═══════════════════════════════════════════════════════════════

/**
 * Classify liquidity regime based on impulse
 * 
 * Rules:
 * - impulse > +0.75 → EXPANSION
 * - impulse < -0.75 → CONTRACTION  
 * - else → NEUTRAL
 */
function classifyRegime(impulse: number): LiquidityRegime {
  if (impulse > REGIME_THRESHOLDS.EXPANSION_THRESHOLD) {
    return 'EXPANSION';
  }
  if (impulse < REGIME_THRESHOLDS.CONTRACTION_THRESHOLD) {
    return 'CONTRACTION';
  }
  return 'NEUTRAL';
}

/**
 * Compute confidence based on data availability and signal clarity
 */
function computeConfidence(available: number, absImpulse: number): number {
  // Base confidence from data availability
  const availabilityConf = available / 3;  // 0.33, 0.67, or 1.0
  
  // Signal clarity bonus (stronger signal = higher confidence)
  const signalClarity = Math.min(1, absImpulse / 2);  // Max at impulse = 2
  
  // Combined confidence
  return clamp(availabilityConf * 0.6 + signalClarity * 0.4, 0, 1);
}

// ═══════════════════════════════════════════════════════════════
// BUILD FULL LIQUIDITY CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Build complete liquidity context including all series and state
 */
export async function buildLiquidityContext(): Promise<LiquidityContext> {
  // Build individual contexts
  const walcl = await buildLiquiditySeriesContext('WALCL');
  const rrp = await buildLiquiditySeriesContext('RRPONTSYD');
  const tga = await buildLiquiditySeriesContext('WTREGEN');
  
  // Compute impulse state
  const state = computeLiquidityImpulse(walcl, rrp, tga);
  
  // Determine data quality
  const seriesAvailable = [walcl, rrp, tga].filter(s => s.available).length;
  let dataQuality: 'GOOD' | 'PARTIAL' | 'MISSING';
  let note: string;
  
  if (seriesAvailable === 3) {
    dataQuality = 'GOOD';
    note = 'All liquidity series available';
  } else if (seriesAvailable > 0) {
    dataQuality = 'PARTIAL';
    const missing = [walcl, rrp, tga].filter(s => !s.available).map(s => s.seriesId);
    note = `Missing series: ${missing.join(', ')}`;
  } else {
    dataQuality = 'MISSING';
    note = 'No liquidity data available. Run ingest first.';
  }
  
  return {
    walcl,
    rrp,
    tga,
    state,
    meta: {
      dataQuality,
      seriesAvailable,
      computedAt: new Date().toISOString(),
      note,
    },
  };
}

/**
 * Get just the liquidity state (for quick access)
 */
export async function getLiquidityState(): Promise<LiquidityState> {
  const ctx = await buildLiquidityContext();
  return ctx.state;
}

// ═══════════════════════════════════════════════════════════════
// P3: AS-OF LIQUIDITY CONTEXT
// ═══════════════════════════════════════════════════════════════

import { buildLiquiditySeriesContextAsOf } from './liquidity.context.js';

/**
 * P3: Build liquidity context as of a specific date.
 * Only uses data that would have been available at asOfDate.
 */
export async function buildLiquidityContextAsOf(asOfDate: string): Promise<LiquidityContext> {
  // Build individual contexts with as-of filtering
  const walcl = await buildLiquiditySeriesContextAsOf('WALCL', asOfDate);
  const rrp = await buildLiquiditySeriesContextAsOf('RRPONTSYD', asOfDate);
  const tga = await buildLiquiditySeriesContextAsOf('WTREGEN', asOfDate);
  
  // Compute impulse state
  const state = computeLiquidityImpulse(walcl, rrp, tga);
  
  // Determine data quality
  const seriesAvailable = [walcl, rrp, tga].filter(s => s.available).length;
  let dataQuality: 'GOOD' | 'PARTIAL' | 'MISSING';
  let note: string;
  
  if (seriesAvailable === 3) {
    dataQuality = 'GOOD';
    note = 'All liquidity series available';
  } else if (seriesAvailable > 0) {
    dataQuality = 'PARTIAL';
    const missing = [walcl, rrp, tga].filter(s => !s.available).map(s => s.seriesId);
    note = `Missing series: ${missing.join(', ')}`;
  } else {
    dataQuality = 'MISSING';
    note = `No liquidity data available as of ${asOfDate}`;
  }
  
  return {
    walcl,
    rrp,
    tga,
    state,
    meta: {
      dataQuality,
      seriesAvailable,
      computedAt: asOfDate,
      note,
    },
  };
}

/**
 * P3: Get liquidity state as of a specific date
 */
export async function getLiquidityStateAsOf(asOfDate: string): Promise<LiquidityState> {
  const ctx = await buildLiquidityContextAsOf(asOfDate);
  return ctx.state;
}
