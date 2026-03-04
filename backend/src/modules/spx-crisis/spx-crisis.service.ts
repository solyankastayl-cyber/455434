/**
 * SPX CRISIS SERVICE
 * 
 * BLOCK B6.10.2 — Epoch Skill Matrix Builder
 * 
 * Builds skill matrix across crisis epochs to validate
 * whether SPX edge survives in market stress periods.
 */

import { SpxOutcomeModel } from '../spx-memory/spx-outcome.model.js';
import { SPX_CRISIS_EPOCHS, CrisisEpoch } from './spx-crisis.registry.js';
import type {
  EpochSkillCell,
  EpochSummary,
  CrisisSkillMatrix,
  CrisisGuardrailCell,
  CrisisGuardrailPolicy,
  CrisisGuardrailReason,
} from './spx-crisis.types.js';

const HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'];

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// EPOCH SKILL MATRIX BUILDER
// ═══════════════════════════════════════════════════════════════

export class SpxCrisisService {

  /**
   * Build crisis skill matrix from outcomes data
   */
  async buildCrisisSkillMatrix(preset = 'BALANCED'): Promise<CrisisSkillMatrix> {
    const rows: EpochSkillCell[] = [];
    const epochSummaries: EpochSummary[] = [];

    for (const epoch of SPX_CRISIS_EPOCHS) {
      const epochRows = await this.computeEpochSkill(epoch, preset);
      rows.push(...epochRows);

      // Build epoch summary
      const summary = this.buildEpochSummary(epoch, epochRows);
      epochSummaries.push(summary);
    }

    // Global verdict
    const strongCount = epochSummaries.filter(e => e.verdict === 'STRONG').length;
    const fragileCount = epochSummaries.filter(e => e.verdict === 'FRAGILE').length;
    const totalWithData = epochSummaries.filter(e => e.totalSamples > 0).length;

    let globalVerdict: CrisisSkillMatrix['globalVerdict'] = 'NO_DATA';
    if (totalWithData > 0) {
      if (fragileCount >= totalWithData * 0.5) {
        globalVerdict = 'EDGE_FRAGILE';
      } else if (strongCount >= totalWithData * 0.5) {
        globalVerdict = 'EDGE_CONFIRMED';
      } else {
        globalVerdict = 'EDGE_MIXED';
      }
    }

    // Recommendations
    const recommendations = this.generateRecommendations(epochSummaries, rows);

    return {
      preset,
      computedAt: new Date().toISOString(),
      totalEpochs: SPX_CRISIS_EPOCHS.length,
      totalCells: rows.length,
      rows,
      epochSummary: epochSummaries,
      globalVerdict,
      recommendations,
    };
  }

  /**
   * Compute skill for a single epoch
   */
  private async computeEpochSkill(epoch: CrisisEpoch, preset: string): Promise<EpochSkillCell[]> {
    const results: EpochSkillCell[] = [];

    // Query outcomes within epoch date range using mongoose
    // Field names: asOfDate (camelCase), expectedDirection (predicted), actualReturnPct
    const docs = await SpxOutcomeModel.find({
      preset,
      symbol: 'SPX',
      asOfDate: { $gte: epoch.start, $lte: epoch.end },
    }).lean();

    if (docs.length === 0) {
      // Return empty cells for all horizons
      for (const horizon of HORIZONS) {
        results.push({
          epoch: epoch.code,
          horizon,
          samples: 0,
          baseUpRate: 0.5,
          baseDownRate: 0.5,
          hitTotal: 0,
          skillTotal: 0,
          skillUp: 0,
          skillDown: 0,
        });
      }
      return results;
    }

    // Group by horizon
    const byHorizon = new Map<string, any[]>();
    for (const d of docs) {
      const horizon = d.horizon || '30d';
      const arr = byHorizon.get(horizon) ?? [];
      arr.push(d);
      byHorizon.set(horizon, arr);
    }

    // Process each horizon
    for (const horizon of HORIZONS) {
      const arr = byHorizon.get(horizon) ?? [];
      const total = arr.length;

      if (total === 0) {
        results.push({
          epoch: epoch.code,
          horizon,
          samples: 0,
          baseUpRate: 0.5,
          baseDownRate: 0.5,
          hitTotal: 0,
          skillTotal: 0,
          skillUp: 0,
          skillDown: 0,
        });
        continue;
      }

      // Compute realized direction from actualReturnPct
      // UP if return > 0.1%, DOWN if return < -0.1%
      const withRealizedDir = arr.map(x => ({
        ...x,
        realizedDirection: x.actualReturnPct > 0.1 ? 'UP' : x.actualReturnPct < -0.1 ? 'DOWN' : 'NEUTRAL',
        predictedDirection: x.expectedDirection === 'BULL' ? 'UP' : x.expectedDirection === 'BEAR' ? 'DOWN' : 'NEUTRAL',
      }));

      // Filter out NEUTRAL realized directions
      const validDocs = withRealizedDir.filter(x => x.realizedDirection !== 'NEUTRAL');
      const validTotal = validDocs.length || 1;

      // Baseline rates (actual market direction)
      const baseUp = validDocs.filter(x => x.realizedDirection === 'UP').length;
      const baseDown = validDocs.filter(x => x.realizedDirection === 'DOWN').length;
      const baseUpRate = safeDiv(baseUp, validTotal);
      const baseDownRate = safeDiv(baseDown, validTotal);
      const baselineHitTotal = Math.max(baseUpRate, baseDownRate);

      // Model hit rates
      const hits = arr.filter(x => x.hit === true).length;
      const hitTotal = safeDiv(hits, total);

      // Directional breakdown
      const predUp = withRealizedDir.filter(x => x.predictedDirection === 'UP');
      const predDown = withRealizedDir.filter(x => x.predictedDirection === 'DOWN');

      const hitUp = predUp.length > 0 
        ? safeDiv(predUp.filter(x => x.hit === true).length, predUp.length)
        : 0;
      const hitDown = predDown.length > 0
        ? safeDiv(predDown.filter(x => x.hit === true).length, predDown.length)
        : 0;

      results.push({
        epoch: epoch.code,
        horizon,
        samples: total,
        baseUpRate: round4(baseUpRate),
        baseDownRate: round4(baseDownRate),
        hitTotal: round4(hitTotal),
        skillTotal: round4(hitTotal - baselineHitTotal),
        skillUp: round4(hitUp - baseUpRate),
        skillDown: round4(hitDown - baseDownRate),
      });
    }

    return results;
  }

  /**
   * Build summary for an epoch
   */
  private buildEpochSummary(epoch: CrisisEpoch, rows: EpochSkillCell[]): EpochSummary {
    const validRows = rows.filter(r => r.samples > 0);
    const n = validRows.length || 1;
    const posSkill = validRows.filter(r => r.skillTotal >= 0).length;
    const stabilityScore = Math.round((posSkill / n) * 100);

    // Verdict
    let verdict: EpochSummary['verdict'] = 'MIXED';
    if (stabilityScore >= 70) verdict = 'STRONG';
    else if (stabilityScore <= 35) verdict = 'FRAGILE';

    // Worst/Best cells
    const sorted = [...validRows].sort((a, b) => a.skillTotal - b.skillTotal);
    const worst = sorted.length > 0 ? {
      horizon: sorted[0].horizon,
      skillTotal: sorted[0].skillTotal,
    } : null;
    const best = sorted.length > 0 ? {
      horizon: sorted[sorted.length - 1].horizon,
      skillTotal: sorted[sorted.length - 1].skillTotal,
    } : null;

    const totalSamples = rows.reduce((s, r) => s + r.samples, 0);
    const edgeSurvived = stabilityScore >= 50 && validRows.some(r => r.skillTotal > 0.01);

    return {
      epoch: epoch.code,
      label: epoch.label,
      type: epoch.type,
      stabilityScore,
      verdict,
      edgeSurvived,
      worst,
      best,
      totalSamples,
      horizonCount: validRows.length,
    };
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(summaries: EpochSummary[], rows: EpochSkillCell[]): string[] {
    const recs: string[] = [];

    // Check 90d specifically (our confirmed edge horizon)
    const rows90d = rows.filter(r => r.horizon === '90d');
    const avg90dSkill = rows90d.length > 0
      ? rows90d.reduce((s, r) => s + r.skillTotal, 0) / rows90d.length
      : 0;

    if (avg90dSkill > 0.01) {
      recs.push('90D horizon maintains positive skill across crises - ALLOW confirmed');
    } else if (avg90dSkill < -0.01) {
      recs.push('90D horizon shows negative skill in crises - consider CAUTION');
    }

    // Check for fragile epochs
    const fragileEpochs = summaries.filter(s => s.verdict === 'FRAGILE');
    if (fragileEpochs.length > 0) {
      recs.push(`FRAGILE epochs detected: ${fragileEpochs.map(e => e.epoch).join(', ')} - apply extra guardrails`);
    }

    // Check for consistent negative skill on short horizons
    const rows7d = rows.filter(r => r.horizon === '7d' && r.samples > 0);
    const neg7d = rows7d.filter(r => r.skillTotal < 0).length;
    if (rows7d.length > 0 && neg7d / rows7d.length > 0.7) {
      recs.push('7D horizon consistently negative - recommend BLOCK');
    }

    // Check DOWN-skill asymmetry
    const negDownSkill = rows.filter(r => r.skillDown < -0.02 && r.samples > 0);
    if (negDownSkill.length > rows.length * 0.3) {
      recs.push('Significant negative DOWN-skill detected - consider disabling shorts');
    }

    if (recs.length === 0) {
      recs.push('Insufficient data for strong recommendations - run full calibration');
    }

    return recs;
  }

  // ═══════════════════════════════════════════════════════════════
  // CRISIS-AWARE GUARDRAILS BUILDER (B6.10.4)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build guardrails policy from crisis matrix
   */
  async buildCrisisGuardrailsPolicy(preset = 'BALANCED'): Promise<CrisisGuardrailPolicy> {
    const matrix = await this.buildCrisisSkillMatrix(preset);

    const thresholds = {
      blockSkillTotal: -0.01,     // -1%
      cautionSkillTotal: 0.005,   // +0.5%
      blockSkillDown: -0.015,     // -1.5%
      minSamples: 50,
    };

    const defaultCaps = {
      allow: 1.0,
      caution: 0.85,
      block: 0,
    };

    // Map epoch verdicts
    const epochVerdicts = new Map(
      matrix.epochSummary.map(e => [e.epoch, e.verdict])
    );

    const cells: CrisisGuardrailCell[] = [];
    let allowedCount = 0;
    let cautionCount = 0;
    let blockedCount = 0;

    for (const row of matrix.rows) {
      const reasons: CrisisGuardrailReason[] = [];
      let level: CrisisGuardrailCell['level'] = 'ALLOW';
      let sizeCap = defaultCaps.allow;

      const verdict = epochVerdicts.get(row.epoch) ?? 'MIXED';

      // Check conditions
      if (verdict === 'FRAGILE') {
        reasons.push('EPOCH_FRAGILE');
      }

      if (row.samples < thresholds.minSamples && row.samples > 0) {
        reasons.push('LOW_SAMPLES');
      }

      if (row.skillTotal <= thresholds.blockSkillTotal) {
        reasons.push('NEG_SKILL_TOTAL');
      }

      if (row.skillDown <= thresholds.blockSkillDown) {
        reasons.push('NEG_SKILL_DOWN');
      }

      // Check asymmetry (big difference between UP and DOWN skill)
      const asymmetry = Math.abs(row.skillUp - row.skillDown);
      if (asymmetry > 0.05 && row.samples > 0) {
        reasons.push('HIGH_ASYMMETRY');
      }

      // Determine level
      const hasHardBlock = reasons.includes('NEG_SKILL_TOTAL') || reasons.includes('NEG_SKILL_DOWN');
      const hasSoftIssue = reasons.length > 0;

      if (hasHardBlock) {
        level = 'BLOCK';
        sizeCap = defaultCaps.block;
        blockedCount++;
      } else if (hasSoftIssue && row.skillTotal < thresholds.cautionSkillTotal) {
        level = 'CAUTION';
        sizeCap = defaultCaps.caution;
        cautionCount++;
      } else if (hasSoftIssue && reasons.includes('LOW_SAMPLES')) {
        level = 'CAUTION';
        sizeCap = 0.9;
        cautionCount++;
      } else {
        allowedCount++;
      }

      cells.push({
        epoch: row.epoch,
        horizon: row.horizon,
        level,
        sizeCap,
        reasons,
        metrics: {
          samples: row.samples,
          skillTotal: row.skillTotal,
          skillUp: row.skillUp,
          skillDown: row.skillDown,
        },
      });
    }

    return {
      version: 'B6.10.4',
      preset,
      generatedAt: new Date().toISOString(),
      thresholds,
      defaultCaps,
      cells,
      summary: {
        allowedCells: allowedCount,
        cautionCells: cautionCount,
        blockedCells: blockedCount,
      },
    };
  }
}

// Singleton
export const spxCrisisService = new SpxCrisisService();
export default SpxCrisisService;
