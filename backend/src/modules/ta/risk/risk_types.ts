/**
 * Phase G: Risk Pack Types
 * 
 * Trading plan types: entry, stop, targets, RR
 */

export type Price = number;

export type EntryType =
  | 'MARKET'
  | 'BREAKOUT_TRIGGER'
  | 'RETEST_ENTRY'
  | 'NECKLINE_BREAK'
  | 'CHANNEL_BREAK'
  | 'TRIANGLE_BREAK'
  | 'WAIT';

export type StopType =
  | 'ATR'
  | 'STRUCTURE'
  | 'LEVEL_ZONE'
  | 'INVALID';

export type TargetType =
  | 'MEASURED_MOVE'
  | 'FIB_EXTENSION'
  | 'NEXT_LEVEL'
  | 'INVALID';

export interface RiskLeg {
  price: Price | null;
  type: string;
  rationale: string[];
}

export interface RiskPack {
  valid: boolean;
  reasonIfInvalid?: string;

  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  bias: 'LONG' | 'SHORT' | 'WAIT';

  entry: {
    type: EntryType;
    price: Price | null;
    rationale: string[];
  };

  stop: {
    type: StopType;
    price: Price | null;
    rationale: string[];
  };

  targets: Array<{
    type: TargetType;
    price: Price | null;
    rationale: string[];
  }>;

  metrics: {
    rrToT1?: number;
    rrToT2?: number;
    rrToT3?: number;
    riskPct?: number;
    rewardPctT1?: number;
  };

  debug: {
    priceNow: number;
    atr: number;
    usedLevels?: any[];
    usedFib?: any[];
  };
}

export interface RiskContext {
  asset: string;
  timeframe: string;
  priceNow: number;
  atr: number;
  levels?: Array<{ mid: number; low?: number; high?: number; strength?: number }>;
  fib?: Array<{ level: number; price: number; kind: 'RETRACE' | 'EXT' }>;
  geometry?: any;
  marketRegime?: string;
  volRegime?: string;
}

export interface ScenarioLike {
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  intent?: { bias: 'LONG' | 'SHORT' | 'WAIT' };
  components: Array<any>;
}
