/**
 * VERDICT ENGINE IMPLEMENTATION
 * =============================
 * 
 * Multi-horizon ensemble verdict engine.
 * Evaluates ALL horizons, applies Rules + Meta-Brain + Calibration + Health per horizon,
 * then selects best candidate by utility score.
 * 
 * Pipeline:
 *   For each horizon:
 *     S2: Rules (guardrails)
 *     S3: Meta-Brain (invariants)
 *     S4: Calibration (Evolution credibility)
 *     S4.5: Health (Shadow Monitor)
 *     S5: Kelly-lite sizing (Block 3)
 *   → Pick best by utility
 *   → Final Verdict
 * 
 * Block 1: Added health snapshot capture for Evolution credibility weighting.
 * Block 3: Replaced static sizing with Kelly-lite dynamic position sizing.
 */

import type { VerdictEngine } from "../contracts/verdict.engine.js";
import type { VerdictContext, Verdict, Horizon, VerdictAdjustment, VerdictHealthSnapshot } from "../contracts/verdict.types.js";
import { genId, clamp01, bumpRisk } from "./utils.js";
import { getDefaultRules, applyRules } from "./rulebook.js";
import { decideAction, decideRisk } from "./sizing.js";
import type { MetaBrainPort } from "./meta_brain.hook.js";
import { NoopMetaBrain } from "./meta_brain.hook.js";
import type { CalibrationPort } from "./calibration.hook.js";
import { NoopCalibration, applyCalibration, calibrationAdjustment } from "./calibration.hook.js";
import type { HealthPort, HealthResult } from "./health.hook.js";
import { NoopHealth } from "./health.hook.js";
import type { HorizonCandidate } from "./ensemble.selector.js";
import { computeUtility } from "./ensemble.selector.js";
// Block 3: Dynamic position sizing
import { calculatePositionSize, type PositionSizingResult } from "./position-sizing.service.js";

export class VerdictEngineImpl implements VerdictEngine {
  constructor(
    private metaBrain: MetaBrainPort = new NoopMetaBrain(),
    private calibration: CalibrationPort = new NoopCalibration(),
    private healthPort: HealthPort = new NoopHealth()
  ) {}

  async evaluate(ctx: VerdictContext): Promise<Verdict> {
    const verdictId = genId("verdict");
    const snapshot = ctx.snapshot;

    // Apply rules once (context-level)
    const rules = getDefaultRules();
    const ruleResults = applyRules(ctx, rules);

    // Block 1: Capture health snapshot for the chosen horizon (will be set later)
    let capturedHealth: HealthResult | null = null;

    const candidates: Array<{
      cand: HorizonCandidate;
      adjustments: VerdictAdjustment[];
      appliedRules: Verdict["appliedRules"];
      raw: Verdict["raw"];
      healthResult: HealthResult; // Block 1: Store health per candidate
    }> = [];

    // Evaluate each horizon as a candidate
    for (const out of ctx.outputs) {
      const horizon = out.horizon;
      let expectedReturn = Number(out.expectedReturn || 0);
      let confidence = clamp01(out.confidenceRaw);

      // Base action/risk (pre-rules)
      let action = decideAction(expectedReturn, confidence, !!ctx.constraints?.allowShort);
      let risk = decideRisk(confidence);

      const adjustments: VerdictAdjustment[] = [];
      const appliedRules: Verdict["appliedRules"] = [];

      // S2: Rules (apply same rule results to each candidate)
      for (const rr of ruleResults) {
        appliedRules.push({ id: rr.id, severity: rr.severity, message: rr.message });

        if (rr.overrideAction) action = rr.overrideAction;

        if (rr.adjust?.confidenceMul) {
          const before = confidence;
          confidence = clamp01(confidence * rr.adjust.confidenceMul);
          adjustments.push({
            stage: "RULES",
            key: rr.id,
            deltaConfidence: confidence - before,
            notes: `h=${horizon} ${rr.message}`,
          });
        }

        if (rr.adjust?.returnMul) {
          const before = expectedReturn;
          expectedReturn = expectedReturn * rr.adjust.returnMul;
          adjustments.push({
            stage: "RULES",
            key: rr.id,
            deltaReturn: expectedReturn - before,
            notes: `h=${horizon} ${rr.message}`,
          });
        }

        if (typeof rr.adjust?.riskBump === "number") {
          risk = bumpRisk(risk, rr.adjust.riskBump);
        }
      }

      // Re-decide after rules
      if (action !== "HOLD") {
        action = decideAction(expectedReturn, confidence, !!ctx.constraints?.allowShort);
      }
      risk = decideRisk(confidence);

      // S3: Meta-Brain
      if (ctx.metaBrain?.invariantsEnabled !== false) {
        try {
          const mb = await this.metaBrain.adjust({
            action,
            expectedReturn,
            confidence,
            risk,
            snapshot,
          });

          action = mb.action;
          expectedReturn = mb.expectedReturn;
          confidence = clamp01(mb.confidence);
          risk = mb.risk;

          if (mb.adjustments?.length) {
            adjustments.push(...mb.adjustments.map(a => ({
              ...a,
              notes: a.notes ? `h=${horizon} ${a.notes}` : `h=${horizon}`,
            })));
          }
        } catch (err: any) {
          console.warn(`[VerdictEngine] Meta-brain error for ${horizon}:`, err.message);
        }
      }

      // S4: Calibration (Evolution) — per horizon
      try {
        const calib = await this.calibration.getConfidenceModifier({
          symbol: snapshot.symbol,
          modelId: out.modelId,
          horizon,
          regime: snapshot.regime,
        });

        const beforeCal = confidence;
        confidence = applyCalibration(confidence, calib.modifier);
        const cadj = calibrationAdjustment(beforeCal, confidence, `h=${horizon} ${calib.notes || ""}`.trim());
        if (cadj) adjustments.push(cadj);
      } catch (err: any) {
        console.warn(`[VerdictEngine] Calibration error for ${horizon}:`, err.message);
      }

      // S4.5: Health (Shadow Monitor) — per horizon
      // Block 1: Capture full health result for Evolution
      let healthResult: HealthResult = { modifier: 1.0, state: "HEALTHY" };
      try {
        healthResult = await this.healthPort.getHealthModifier({ horizon, modelId: out.modelId });
        const beforeH = confidence;
        confidence = clamp01(confidence * healthResult.modifier);
        if (Math.abs(confidence - beforeH) > 1e-6) {
          adjustments.push({
            stage: "CALIBRATION",
            key: "HORIZON_HEALTH",
            deltaConfidence: confidence - beforeH,
            notes: `h=${horizon} health=${healthResult.state}${healthResult.notes ? " " + healthResult.notes : ""}`,
          });
        }
      } catch (err: any) {
        console.warn(`[VerdictEngine] Health error for ${horizon}:`, err.message);
      }

      // Finalize action/risk/size
      risk = decideRisk(confidence);
      action = decideAction(expectedReturn, confidence, !!ctx.constraints?.allowShort);

      // Block 3: Dynamic position sizing with Kelly-lite
      const maxPct = ctx.constraints?.maxPositionPct ?? 0.25;
      let positionSizePct = 0;
      let sizingResult: PositionSizingResult | undefined;
      
      if (action !== "HOLD") {
        sizingResult = calculatePositionSize({
          confidence,
          expectedReturn,
          risk,
          horizon,
          healthState: healthResult.state,
          maxPositionPct: maxPct,
        });
        positionSizePct = sizingResult.positionSizePct;
        
        // Add sizing adjustment for audit trail
        if (sizingResult.kellyRaw > 0) {
          adjustments.push({
            stage: "CALIBRATION",
            key: "KELLY_SIZING",
            notes: `h=${horizon} ${sizingResult.notes}`,
          });
        }
      }

      const cand: HorizonCandidate = {
        horizon,
        modelId: out.modelId,
        expectedReturn,
        confidence,
        action,
        risk,
        positionSizePct,
        utility: 0,
      };
      cand.utility = computeUtility(cand);

      candidates.push({
        cand,
        adjustments,
        appliedRules,
        raw: {
          expectedReturn: Number(out.expectedReturn || 0),
          confidence: clamp01(out.confidenceRaw),
          horizon,
          modelId: out.modelId,
        },
        healthResult, // Block 1: Store health for this candidate
      });
    }

    // Pick best candidate by utility
    const sorted = candidates.slice().sort((a, b) => b.cand.utility - a.cand.utility);
    const best = sorted[0];

    // Fallback: if all utilities are negative, HOLD
    const chosen = best && best.cand.utility > 0 ? best : candidates[0];

    // If no outputs at all
    if (!chosen) {
      return {
        verdictId,
        symbol: snapshot.symbol,
        ts: snapshot.ts,
        horizon: "7D",
        action: "HOLD",
        expectedReturn: 0,
        confidence: 0,
        risk: "HIGH",
        positionSizePct: 0,
        raw: { expectedReturn: 0, confidence: 0, horizon: "7D", modelId: "none" },
        adjustments: [],
        appliedRules: [],
        modelId: "none",
        regime: snapshot.regime,
        health: { state: "HEALTHY", modifier: 1.0 }, // Block 1: Default health
      };
    }

    const { cand, adjustments, appliedRules, raw, healthResult } = chosen;

    // Block 1: Build health snapshot for Evolution
    const healthSnapshot: VerdictHealthSnapshot = {
      state: healthResult.state,
      modifier: healthResult.modifier,
      ece: healthResult.ece,
      divergence: healthResult.divergence,
      criticalStreak: healthResult.criticalStreak,
      notes: healthResult.notes,
    };

    console.log(
      `[VerdictEngine] ${snapshot.symbol} → ${cand.horizon} ${cand.action} ` +
      `conf=${(cand.confidence * 100).toFixed(0)}% util=${cand.utility.toFixed(4)} health=${healthResult.state}`
    );

    return {
      verdictId,
      symbol: snapshot.symbol,
      ts: snapshot.ts,

      horizon: cand.horizon,
      action: cand.action,
      expectedReturn: cand.expectedReturn,
      confidence: cand.confidence,
      risk: cand.risk,
      positionSizePct: cand.positionSizePct,

      raw,
      adjustments,
      appliedRules,

      modelId: cand.modelId,
      regime: snapshot.regime,
      
      // Block 1: Include health snapshot for Evolution
      health: healthSnapshot,
    };
  }
}

console.log('[Verdict] Engine implementation loaded');
