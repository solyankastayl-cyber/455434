/**
 * VERDICT ENGINE CONTRACT
 */

import { VerdictContext, Verdict } from "./verdict.types.js";

export interface VerdictEngine {
  evaluate(ctx: VerdictContext): Promise<Verdict>;
}

console.log('[Verdict] Engine contract loaded');
