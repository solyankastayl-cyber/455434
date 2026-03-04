/**
 * P9.1 — Brain Compare Contract
 */

export interface AllocationSnapshot {
  spxSize: number;
  btcSize: number;
  cashSize: number;
  meta?: Record<string, any>;
}

export interface DirectiveDetail {
  type: 'CAP' | 'HAIRCUT' | 'SCALE';
  target: string;
  value: number;
  reason: string;
}

export interface ChangedField {
  field: 'spxSize' | 'btcSize' | 'cashSize';
  from: number;
  to: number;
  delta: number;
  reasons: string[];
  sources: string[];
}

export type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface BrainComparePack {
  asOf: string;
  inputsHash: string;

  base: {
    engineMode: 'brain_off';
    allocations: AllocationSnapshot;
    evidence?: any;
  };

  brain: {
    engineMode: 'brain_on';
    allocations: AllocationSnapshot;
    decision: {
      scenario: 'BASE' | 'RISK' | 'TAIL';
      probabilities: { base: number; risk: number; tail: number };
      directives: DirectiveDetail[];
      evidence: any;
    };
  };

  diff: {
    allocationsDelta: { spx: number; btc: number; cash: number };
    changed: ChangedField[];
    severity: Severity;
    diffHash: string;
  };

  context: {
    crossAsset?: { label: string; confidence: number };
    macro?: { regime: string; confidence: number; activeEngine: 'v1' | 'v2' };
    guard?: { level: string };
    liquidity?: { regime: string };
  };
}
