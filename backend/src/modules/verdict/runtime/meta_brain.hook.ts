/**
 * META-BRAIN HOOK
 * 
 * Port for connecting real Meta-Brain invariants
 */

import type { Action, RiskLevel, VerdictAdjustment } from "../contracts/verdict.types.js";
import { clamp01 } from "./utils.js";

export type MetaBrainInput = {
  action: Action;
  expectedReturn: number;
  confidence: number;
  risk: RiskLevel;
  snapshot: any;
};

export type MetaBrainOutput = {
  action: Action;
  expectedReturn: number;
  confidence: number;
  risk: RiskLevel;
  adjustments: VerdictAdjustment[];
};

export interface MetaBrainPort {
  adjust(input: MetaBrainInput): Promise<MetaBrainOutput>;
}

// v1 fallback: no-op (если не подключили интеллект)
export class NoopMetaBrain implements MetaBrainPort {
  async adjust(input: MetaBrainInput): Promise<MetaBrainOutput> {
    return { ...input, adjustments: [] };
  }
}

console.log('[Verdict] Meta-brain hook loaded');
