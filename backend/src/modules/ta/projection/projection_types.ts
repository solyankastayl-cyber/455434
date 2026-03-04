/**
 * Phase AC: Projection Engine Types
 * 
 * RenderPack contract for frontend visualization:
 * - Layers: pattern geometry, levels, MAs, waves
 * - Projections: target paths with probability bands
 */

// ═══════════════════════════════════════════════════════════════
// GEOMETRY PRIMITIVES
// ═══════════════════════════════════════════════════════════════

export type Point = {
  x: number;      // candle index or timestamp
  y: number;      // price
  label?: string;
};

export type Line = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style?: 'solid' | 'dashed' | 'dotted';
  color?: string;
};

export type Zone = {
  price: number;
  band: number;
  type: 'support' | 'resistance' | 'target' | 'stop';
  strength?: number;
};

// ═══════════════════════════════════════════════════════════════
// LAYER TYPES
// ═══════════════════════════════════════════════════════════════

export type PatternLayer = {
  kind: 'PATTERN';
  id: string;
  patternType: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  points: Point[];
  lines?: Line[];
  zones?: Zone[];
  score: number;
  contribution: number;  // to overall confluence
  reasons: string[];
};

export type LevelLayer = {
  kind: 'LEVELS';
  zones: Zone[];
  contribution: number;
};

export type MALayer = {
  kind: 'MA';
  lines: Array<{
    period: number;
    values: number[];
    slope: number;
    color: string;
  }>;
  alignment: 'BULL' | 'BEAR' | 'MIXED';
  contribution: number;
};

export type WaveLayer = {
  kind: 'WAVES';
  points: Point[];
  lines: Line[];
  waveType: 'ELLIOTT_5' | 'ELLIOTT_3' | 'ABC' | 'IMPULSE';
  contribution: number;
};

export type FibLayer = {
  kind: 'FIBONACCI';
  swing: {
    from: Point;
    to: Point;
    direction: 'UP' | 'DOWN';
  };
  levels: Array<{
    ratio: number;
    price: number;
    label: string;
    isGoldenPocket?: boolean;
  }>;
  contribution: number;
};

export type RenderLayer = 
  | PatternLayer 
  | LevelLayer 
  | MALayer 
  | WaveLayer
  | FibLayer;

// ═══════════════════════════════════════════════════════════════
// PROJECTION TYPES
// ═══════════════════════════════════════════════════════════════

export type ProjectionKind = 
  | 'MEASURED_MOVE'      // triangle height projection
  | 'DEPTH_PROJ'         // cup depth projection
  | 'POLE_PROJ'          // flag pole projection
  | 'FIB_EXTENSION'      // fibonacci extension
  | 'NECKLINE_BREAK'     // H&S neckline break
  | 'HARMONIC_REVERSAL'  // D point reversal
  | 'WAVE_TARGET'        // elliott wave target
  | 'LEVEL_BOUNCE'       // S/R bounce
  | 'CHANNEL_TARGET';    // channel breakout

export type ProjectionPath = Array<{
  t: number;       // relative time (bars from now)
  price: number;
  probability: number;  // confidence at this point
}>;

export type Projection = {
  id: string;
  kind: ProjectionKind;
  direction: 'BULLISH' | 'BEARISH';
  
  // Path to target
  path: ProjectionPath;
  
  // Confidence bands
  bands?: {
    low: number[];
    high: number[];
  };
  
  // Key levels
  entry: number;
  target: number;
  target2?: number;
  stop: number;
  
  // Risk metrics
  riskReward: number;
  probability: number;
  
  // Explainability
  rationale: string[];
  sourcePatterns: string[];  // pattern IDs that support this projection
};

// ═══════════════════════════════════════════════════════════════
// RENDER PACK
// ═══════════════════════════════════════════════════════════════

export type RenderPack = {
  symbol: string;
  timeframe: string;
  timestamp: string;
  
  // Current price context
  currentPrice: number;
  atr: number;
  regime: string;
  
  // All confirmation layers (10-20 typically)
  layers: RenderLayer[];
  
  // Top projections (1-3 typically)
  projections: Projection[];
  
  // Aggregate scores
  confluenceScore: number;
  dominantDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  
  // Summary
  summary: {
    patternsDetected: number;
    layersRendered: number;
    projectionsGenerated: number;
    confirmationStack: Array<{
      factor: string;
      contribution: number;
      direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    }>;
  };
};

// ═══════════════════════════════════════════════════════════════
// PROJECTOR INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface ProjectorContext {
  currentPrice: number;
  atr: number;
  timeframe: string;
  regime: string;
  ma50?: number;
  ma200?: number;
}

export interface Projector {
  id: string;
  name: string;
  supportedPatterns: string[];
  
  /**
   * Generate projection from pattern geometry
   */
  project(
    pattern: PatternLayer,
    context: ProjectorContext
  ): Projection | null;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN PRIORS (from TA textbook)
// ═══════════════════════════════════════════════════════════════

export type PatternPrior = {
  type: string;
  direction: 'BULLISH' | 'BEARISH';
  baseProbability: number;
  avgTargetATR: number;      // typical target in ATR units
  avgDurationBars: number;   // typical duration to target
  winRateHistorical: number; // from textbook/backtests
};

export const PATTERN_PRIORS: PatternPrior[] = [
  // Triangles
  { type: 'TRIANGLE_ASC', direction: 'BULLISH', baseProbability: 0.68, avgTargetATR: 1.5, avgDurationBars: 15, winRateHistorical: 0.64 },
  { type: 'TRIANGLE_DESC', direction: 'BEARISH', baseProbability: 0.68, avgTargetATR: 1.5, avgDurationBars: 15, winRateHistorical: 0.64 },
  { type: 'TRIANGLE_SYM', direction: 'BULLISH', baseProbability: 0.55, avgTargetATR: 1.2, avgDurationBars: 12, winRateHistorical: 0.52 },
  
  // Wedges
  { type: 'WEDGE_RISING', direction: 'BEARISH', baseProbability: 0.65, avgTargetATR: 1.3, avgDurationBars: 10, winRateHistorical: 0.62 },
  { type: 'WEDGE_FALLING', direction: 'BULLISH', baseProbability: 0.65, avgTargetATR: 1.3, avgDurationBars: 10, winRateHistorical: 0.62 },
  
  // Flags
  { type: 'FLAG_BULL', direction: 'BULLISH', baseProbability: 0.67, avgTargetATR: 2.0, avgDurationBars: 8, winRateHistorical: 0.65 },
  { type: 'FLAG_BEAR', direction: 'BEARISH', baseProbability: 0.67, avgTargetATR: 2.0, avgDurationBars: 8, winRateHistorical: 0.65 },
  
  // Head & Shoulders
  { type: 'HNS', direction: 'BEARISH', baseProbability: 0.70, avgTargetATR: 2.5, avgDurationBars: 20, winRateHistorical: 0.68 },
  { type: 'IHNS', direction: 'BULLISH', baseProbability: 0.70, avgTargetATR: 2.5, avgDurationBars: 20, winRateHistorical: 0.68 },
  
  // Double patterns
  { type: 'DOUBLE_TOP', direction: 'BEARISH', baseProbability: 0.72, avgTargetATR: 2.0, avgDurationBars: 15, winRateHistorical: 0.70 },
  { type: 'DOUBLE_BOTTOM', direction: 'BULLISH', baseProbability: 0.72, avgTargetATR: 2.0, avgDurationBars: 15, winRateHistorical: 0.70 },
  
  // Cup & Handle
  { type: 'CUP_HANDLE', direction: 'BULLISH', baseProbability: 0.65, avgTargetATR: 3.0, avgDurationBars: 25, winRateHistorical: 0.62 },
  
  // Channels
  { type: 'CHANNEL_UP', direction: 'BULLISH', baseProbability: 0.60, avgTargetATR: 1.0, avgDurationBars: 5, winRateHistorical: 0.58 },
  { type: 'CHANNEL_DOWN', direction: 'BEARISH', baseProbability: 0.60, avgTargetATR: 1.0, avgDurationBars: 5, winRateHistorical: 0.58 },
  
  // Harmonics
  { type: 'HARMONIC_GARTLEY_BULL', direction: 'BULLISH', baseProbability: 0.62, avgTargetATR: 2.0, avgDurationBars: 12, winRateHistorical: 0.60 },
  { type: 'HARMONIC_GARTLEY_BEAR', direction: 'BEARISH', baseProbability: 0.62, avgTargetATR: 2.0, avgDurationBars: 12, winRateHistorical: 0.60 },
  { type: 'HARMONIC_BAT_BULL', direction: 'BULLISH', baseProbability: 0.60, avgTargetATR: 1.8, avgDurationBars: 10, winRateHistorical: 0.58 },
  { type: 'HARMONIC_BAT_BEAR', direction: 'BEARISH', baseProbability: 0.60, avgTargetATR: 1.8, avgDurationBars: 10, winRateHistorical: 0.58 },
  { type: 'HARMONIC_BUTTERFLY_BULL', direction: 'BULLISH', baseProbability: 0.58, avgTargetATR: 2.2, avgDurationBars: 15, winRateHistorical: 0.55 },
  { type: 'HARMONIC_BUTTERFLY_BEAR', direction: 'BEARISH', baseProbability: 0.58, avgTargetATR: 2.2, avgDurationBars: 15, winRateHistorical: 0.55 },
  { type: 'HARMONIC_CRAB_BULL', direction: 'BULLISH', baseProbability: 0.55, avgTargetATR: 2.5, avgDurationBars: 18, winRateHistorical: 0.52 },
  { type: 'HARMONIC_CRAB_BEAR', direction: 'BEARISH', baseProbability: 0.55, avgTargetATR: 2.5, avgDurationBars: 18, winRateHistorical: 0.52 },
  { type: 'HARMONIC_ABCD_BULL', direction: 'BULLISH', baseProbability: 0.63, avgTargetATR: 1.5, avgDurationBars: 8, winRateHistorical: 0.61 },
  { type: 'HARMONIC_ABCD_BEAR', direction: 'BEARISH', baseProbability: 0.63, avgTargetATR: 1.5, avgDurationBars: 8, winRateHistorical: 0.61 },
  
  // Elliott
  { type: 'ELLIOTT_5_WAVE', direction: 'BULLISH', baseProbability: 0.58, avgTargetATR: 3.0, avgDurationBars: 30, winRateHistorical: 0.55 },
  { type: 'ELLIOTT_3_WAVE', direction: 'BULLISH', baseProbability: 0.55, avgTargetATR: 2.0, avgDurationBars: 20, winRateHistorical: 0.52 },
  { type: 'CORRECTION_ABC', direction: 'BEARISH', baseProbability: 0.60, avgTargetATR: 1.5, avgDurationBars: 15, winRateHistorical: 0.57 },
];

/**
 * Get prior for pattern type
 */
export function getPatternPrior(patternType: string): PatternPrior | null {
  return PATTERN_PRIORS.find(p => p.type === patternType) || null;
}
