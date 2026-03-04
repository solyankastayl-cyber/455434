/**
 * AE/S-Brain v2 — Asset State Contract
 * 
 * Unified structure for DXY/SPX/BTC that Brain reads.
 * Brain doesn't know HOW you calculate these — it gets normalized packs.
 */

export type AssetId = 'dxy' | 'spx' | 'btc';

export interface PriceContext {
  spot: number;
  ret1d?: number;
  realizedVol20d?: number;
  drawdown90d?: number;
  trendBias?: 'UP' | 'DOWN' | 'NEUTRAL';
}

export interface FractalLayerPack {
  endReturnByHorizon: Record<string, number>; // '30D' -> 0.05
  confidence?: number;
  signal?: string;
}

export interface FractalPack {
  replay?: FractalLayerPack;
  synthetic?: FractalLayerPack;
  hybrid?: FractalLayerPack;
  macro?: FractalLayerPack & { engineVersion?: 'v1' | 'v2' };
}

export interface MacroV2Pack {
  regime: {
    name: string; // 'EASING' | 'TIGHTENING' | 'STRESS' | 'NEUTRAL'
    probs: Record<string, number>; // posterior probabilities
    persistence?: number;
  };
  perHorizonWeights?: Record<string, Record<string, number>>; // horizon -> component -> weight
  confidence: number;
  keyDrivers: Array<{
    key: string;
    direction: 'pos' | 'neg';
    strength: number;
  }>;
  scoreSigned?: number;
}

export interface LiquidityPack {
  impulse: number;
  regime: 'EXPANSION' | 'CONTRACTION' | 'NEUTRAL';
  confidence: number;
}

export interface GuardPack {
  level: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
  since?: string;
  rationale?: string;
}

export interface CascadePack {
  size: number; // 0..1
  caps?: {
    warn?: number;
    crisis?: number;
    block?: number;
  };
  multipliers?: Record<string, number>; // mStress, mLiquidity, etc.
}

export interface EvidencePack {
  headline?: string;
  keyDrivers?: string[];
  conflicts?: string[];
  whatWouldFlip?: string[];
}

export interface AssetStatePack {
  asset: AssetId;
  asOf: string; // YYYY-MM-DD
  
  // Price context
  price: PriceContext;
  
  // Fractal layers (what UI already uses)
  fractal: FractalPack;
  
  // Macro Engine V2 (DXY primary, others inherit)
  macroV2?: MacroV2Pack;
  
  // Liquidity state
  liquidity?: LiquidityPack;
  
  // Guard state
  guard?: GuardPack;
  
  // Cascade/Engine allocation
  cascade?: CascadePack;
  
  // Human-readable evidence
  evidence?: EvidencePack;
  
  // Data freshness
  meta?: {
    freshnessDays: number;
    dataSource: string;
    lastUpdate: string;
  };
}

/**
 * Validate AssetStatePack has minimum required fields
 */
export function validateAssetState(pack: AssetStatePack): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!pack.asset) errors.push('asset is required');
  if (!pack.asOf) errors.push('asOf is required');
  if (!pack.price?.spot) errors.push('price.spot is required');
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create empty AssetStatePack with defaults
 */
export function createEmptyAssetState(asset: AssetId, asOf: string): AssetStatePack {
  return {
    asset,
    asOf,
    price: { spot: 0 },
    fractal: {},
    meta: {
      freshnessDays: 999,
      dataSource: 'empty',
      lastUpdate: new Date().toISOString(),
    },
  };
}
