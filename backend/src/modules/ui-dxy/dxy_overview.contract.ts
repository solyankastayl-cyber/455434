/**
 * DXY FRACTAL OVERVIEW CONTRACT
 * 
 * Single aggregated pack for DXY Fractal UI
 * Decision Engine approach: Verdict first, details second
 */

// ═══════════════════════════════════════════════════════════════
// VERDICT (The Answer)
// ═══════════════════════════════════════════════════════════════

export type DxyAction = 'BUY' | 'SELL' | 'HOLD';
export type DxyBias = 'USD_UP' | 'USD_DOWN' | 'NEUTRAL';
export type RiskLevel = 'LOW' | 'NORMAL' | 'ELEVATED' | 'STRESS';
export type Regime = 'BULL_USD' | 'BEAR_USD' | 'NEUTRAL' | 'MIXED';

export interface DxyVerdict {
  action: DxyAction;
  bias: DxyBias;
  horizon: number;
  confidence: number;
  expectedMoveP50: number;
  rangeP10: number;
  rangeP90: number;
  positionMultiplier: number;
  capitalScaling: number;
  invalidations: string[];
}

// ═══════════════════════════════════════════════════════════════
// HEADER STATUS
// ═══════════════════════════════════════════════════════════════

export interface DxyHeaderStatus {
  signal: DxyAction;
  confidence: number;
  risk: RiskLevel;
  regime: Regime;
  asOf: string;
  dataStatus: 'REAL' | 'PARTIAL' | 'SYNTHETIC';
}

// ═══════════════════════════════════════════════════════════════
// CHART DATA
// ═══════════════════════════════════════════════════════════════

export interface ChartPoint {
  date: string;
  value: number;
  pct: number;
}

export interface ChartSeries {
  synthetic: ChartPoint[];
  replay: ChartPoint[];
  hybrid: ChartPoint[];
  macro: ChartPoint[];
  historical: ChartPoint[];
}

// ═══════════════════════════════════════════════════════════════
// FORECAST BY HORIZON
// ═══════════════════════════════════════════════════════════════

export interface HorizonForecast {
  horizon: number;
  synthetic: number;
  replay: number;
  hybrid: number;
  macroAdj: number;
  final: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// WHY THIS VERDICT
// ═══════════════════════════════════════════════════════════════

export type DriverSentiment = 'supportive' | 'neutral' | 'headwind';

export interface Driver {
  text: string;
  sentiment: DriverSentiment;
  factor: string;
}

export interface TransmissionLink {
  from: string;
  to: string;
  direction: 'positive' | 'negative' | 'neutral';
}

export interface TransmissionChain {
  chain: TransmissionLink[];
  target: string;
  netEffect: 'positive' | 'negative' | 'neutral';
}

export interface WhyVerdict {
  drivers: Driver[];
  transmission: TransmissionChain[];
  invalidations: string[];
}

// ═══════════════════════════════════════════════════════════════
// RISK CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface RiskContext {
  level: RiskLevel;
  expectedDrawdown: number;
  volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  positionMultiplier: number;
  capitalScaling: number;
  scalingExplanation: string;
}

// ═══════════════════════════════════════════════════════════════
// HISTORICAL ANALOGS
// ═══════════════════════════════════════════════════════════════

export interface HistoricalMatch {
  rank: number;
  dateRange: string;
  similarity: number;
  forwardReturn: number;
  decade: string;
}

export interface AnalogsSummary {
  bestMatch: {
    dateRange: string;
    similarity: number;
  };
  coverage: number;
  sampleSize: number;
  outcomeP50: number;
  outcomeP10: number;
  outcomeP90: number;
  topMatches: HistoricalMatch[];
}

// ═══════════════════════════════════════════════════════════════
// MACRO IMPACT
// ═══════════════════════════════════════════════════════════════

export interface MacroComponent {
  key: string;
  label: string;
  pressure: number;
  weight: number;
  contribution: number;
}

export interface MacroImpact {
  score: number;
  scoreSigned: number;
  confidence: number;
  regime: string;
  components: MacroComponent[];
  deltaPct: number;
  drivers: string[];
}

// ═══════════════════════════════════════════════════════════════
// MAIN PACK
// ═══════════════════════════════════════════════════════════════

export interface DxyOverviewPack {
  // Header
  header: DxyHeaderStatus;
  
  // The Answer
  verdict: DxyVerdict;
  
  // Chart Data
  chart: ChartSeries;
  currentPrice: number;
  
  // Forecast Table
  forecasts: HorizonForecast[];
  
  // Why
  why: WhyVerdict;
  
  // Risk
  risk: RiskContext;
  
  // Analogs
  analogs: AnalogsSummary;
  
  // Macro
  macro: MacroImpact;
  
  // Meta
  generatedAt: string;
}
