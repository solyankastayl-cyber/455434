/**
 * DXY FORWARD TYPES
 * 
 * ISOLATION: DXY forward contracts. No BTC/SPX imports.
 */

export type DxyAction = "LONG" | "SHORT" | "HOLD";

export type DiagnosticsSources = {
  matches?: string;
  entropy?: string;
  tailRisk?: string;
  drawdown?: string;
  scan?: string;
};

export interface DxyForwardSignal {
  asset: "DXY";
  asOf: string;         // YYYY-MM-DD
  horizonDays: number;  // 7/14/30/...
  action: DxyAction;

  // math-core (immutable)
  forecastReturn: number; // decimal: 0.012 = +1.2%
  probUp: number;         // 0..1
  similarity: number;     // 0..1
  entropy: number;        // 0..1

  // audit/meta
  modelVersion: string;
  constitutionHash?: string | null;

  diagnostics?: {
    sources?: DiagnosticsSources;
  };

  createdAt: Date;
  updatedAt: Date;
}

export interface DxyForwardOutcome {
  asset: "DXY";
  asOf: string;
  horizonDays: number;
  targetDate: string;

  entryPrice: number;
  exitPrice: number;
  realizedReturn: number;

  isResolved: boolean;
  resolvedAt?: Date;
  wasFutureAtResolve?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface DxyForwardMetrics {
  asset: "DXY";
  window: "ALL" | "1Y" | "5Y" | "10Y";
  horizonDays: number;

  sampleCount: number;
  hitRate: number;
  avgReturn: number;
  bias: number;
  maxDrawdown: number;

  updatedAt: Date;
  createdAt: Date;
}

export interface DxySnapshotResult {
  asset: "DXY";
  asOf: string;
  focusDays: number;
  horizonsAttempted: number;
  createdCount: number;
  errors: Array<{ horizonDays: number; error: string }>;
}
