/**
 * VERDICT RULEBOOK
 * 
 * Guardrails that apply before Meta-Brain
 */

import type { VerdictContext, RuleResult, Action } from "../contracts/verdict.types.js";

export interface VerdictRule {
  id: string;
  when(ctx: VerdictContext): boolean;
  run(ctx: VerdictContext): RuleResult;
}

const MIN_LIQ = 0.15;

const ruleMinLiquidityBlock: VerdictRule = {
  id: "MIN_LIQUIDITY_BLOCK",
  when: (ctx) => typeof ctx.snapshot.liquidityScore === "number" && ctx.snapshot.liquidityScore < MIN_LIQ,
  run: () => ({
    id: "MIN_LIQUIDITY_BLOCK",
    severity: "BLOCK",
    message: "Liquidity too low — forcing HOLD",
    overrideAction: "HOLD" as Action,
  }),
};

const ruleFlightToSafety: VerdictRule = {
  id: "BTC_FLIGHT_TO_SAFETY_CONF_CUT",
  when: (ctx) => (ctx.snapshot.regime || "").includes("FLIGHT_TO_SAFETY"),
  run: () => ({
    id: "BTC_FLIGHT_TO_SAFETY_CONF_CUT",
    severity: "WARN",
    message: "Flight-to-safety regime — reduce confidence and bump risk",
    adjust: { confidenceMul: 0.68, riskBump: 1 },
  }),
};

const ruleVolSpike: VerdictRule = {
  id: "VOL_SPIKE_RISK_UP",
  when: (ctx) => typeof ctx.snapshot.volatility === "number" && ctx.snapshot.volatility > 0.08,
  run: (ctx) => ({
    id: "VOL_SPIKE_RISK_UP",
    severity: "WARN",
    message: `High volatility (${ctx.snapshot.volatility}) — reduce confidence`,
    adjust: { confidenceMul: 0.80, riskBump: 1 },
  }),
};

const ruleExtremeFear: VerdictRule = {
  id: "MACRO_EXTREME_FEAR",
  when: (ctx) => (ctx.snapshot.macro?.fearGreed ?? 50) < 20,
  run: () => ({
    id: "MACRO_EXTREME_FEAR",
    severity: "WARN",
    message: "Extreme fear detected — reduce confidence",
    adjust: { confidenceMul: 0.75, riskBump: 1 },
  }),
};

export function getDefaultRules(): VerdictRule[] {
  return [ruleMinLiquidityBlock, ruleFlightToSafety, ruleVolSpike, ruleExtremeFear];
}

export function applyRules(ctx: VerdictContext, rules: VerdictRule[]): RuleResult[] {
  const results: RuleResult[] = [];
  for (const r of rules) {
    try {
      if (r.when(ctx)) results.push(r.run(ctx));
    } catch {
      // ignore broken rule in v1
    }
  }
  return results;
}

console.log('[Verdict] Rulebook loaded');
