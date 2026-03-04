/**
 * SPX RULES — Service
 * 
 * BLOCK B6.6 — Rule Extraction Engine (Skill-first, Institutional)
 * 
 * Key insight: hitRate alone is meaningless for SPX because of bull drift.
 * We compute SKILL = modelHitRate - baselineRate to find real edge.
 * 
 * - skillUp: how much better model is at predicting UP vs random
 * - skillDown: how much better model is at predicting DOWN vs random
 * - skillTotal: weighted combination avoiding bull bias
 */

import { SpxOutcomeModel } from '../spx-memory/spx-outcome.model.js';
import { SpxSnapshotModel } from '../spx-memory/spx-snapshot.model.js';
import type { RuleCell, RulesExtractResponse, SkillMetric, ExtractedRules } from './spx-rules.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function safeDiv(a: number, b: number): number {
  return b <= 0 ? 0 : a / b;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function decadeOf(dateStr: string): string {
  const y = Number(dateStr.slice(0, 4));
  const d = Math.floor(y / 10) * 10;
  return `${d}s`;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class SpxRulesService {
  
  /**
   * Extract rules with skill scores
   * 
   * @param metric - Which skill metric to use for ranking
   */
  async extract(metric: SkillMetric = 'skillTotal'): Promise<RulesExtractResponse> {
    // Thresholds (institutional defaults)
    const MIN_TOTAL = 300;          // Minimum samples per cell
    const STRONG_SKILL = 0.03;      // +3pp = strong edge
    const WEAK_SKILL = 0.005;       // +0.5pp = weak edge
    const BROKEN_SKILL = -0.03;     // -3pp = model is harmful
    const CAUTION_ABS = 0.015;      // ±1.5pp = caution zone

    // 1) Load all outcomes with predicted direction from snapshots
    const outcomes = await SpxOutcomeModel.find({ symbol: 'SPX' })
      .select({ 
        asOfDate: 1, 
        horizon: 1, 
        actualReturnPct: 1, 
        hit: 1, 
        expectedDirection: 1,
        snapshotId: 1 
      })
      .lean()
      .exec();

    // 2) Group by decade + horizon
    type CellData = {
      total: number;
      predUp: number;
      predDown: number;
      predNeutral: number;
      realizedUp: number;
      realizedDown: number;
      realizedNeutral: number;
      hitUp: number;       // predicted UP and was correct
      hitDown: number;     // predicted DOWN and was correct
      hitTotal: number;    // any correct prediction
    };

    const cellMap = new Map<string, CellData>();
    let globalPredUp = 0;
    let globalTotal = 0;

    for (const o of outcomes) {
      const decade = decadeOf((o as any).asOfDate);
      const horizon = (o as any).horizon;
      const key = `${decade}__${horizon}`;

      // Get or create cell
      let cell = cellMap.get(key);
      if (!cell) {
        cell = {
          total: 0, predUp: 0, predDown: 0, predNeutral: 0,
          realizedUp: 0, realizedDown: 0, realizedNeutral: 0,
          hitUp: 0, hitDown: 0, hitTotal: 0
        };
        cellMap.set(key, cell);
      }

      cell.total++;
      globalTotal++;

      // Predicted direction (from expectedDirection field)
      const pred = (o as any).expectedDirection;
      if (pred === 'BULL') {
        cell.predUp++;
        globalPredUp++;
      } else if (pred === 'BEAR') {
        cell.predDown++;
      } else {
        cell.predNeutral++;
      }

      // Realized direction (from return)
      const ret = (o as any).actualReturnPct;
      const THRESHOLD = 0.1; // 0.1% threshold for direction
      let realizedDir: 'UP' | 'DOWN' | 'NEUTRAL';
      if (ret > THRESHOLD) {
        realizedDir = 'UP';
        cell.realizedUp++;
      } else if (ret < -THRESHOLD) {
        realizedDir = 'DOWN';
        cell.realizedDown++;
      } else {
        realizedDir = 'NEUTRAL';
        cell.realizedNeutral++;
      }

      // Hit calculation
      const isHit = (o as any).hit;
      if (isHit) cell.hitTotal++;
      
      // Direction-specific hits
      if (pred === 'BULL' && realizedDir === 'UP') cell.hitUp++;
      if (pred === 'BEAR' && realizedDir === 'DOWN') cell.hitDown++;
    }

    // 3) Convert to RuleCell array with skill calculations
    const matrix: RuleCell[] = [];

    for (const [key, data] of cellMap.entries()) {
      const [decade, horizon] = key.split('__');

      // Baseline rates (what you'd get by always predicting majority)
      const baseUpRate = safeDiv(data.realizedUp, data.total);
      const baseDownRate = safeDiv(data.realizedDown, data.total);

      // Model hit rates
      const hitTotal = safeDiv(data.hitTotal, data.total);
      const hitUp = safeDiv(data.hitUp, data.predUp);
      const hitDown = safeDiv(data.hitDown, data.predDown);

      // Prediction share
      const predUpShare = safeDiv(data.predUp, data.total);

      // Skills
      const skillUp = round4(hitUp - baseUpRate);
      const skillDown = round4(hitDown - baseDownRate);
      
      // Weighted skill total (avoids bull bias)
      const wUp = safeDiv(data.predUp, data.predUp + data.predDown);
      const wDown = 1 - wUp;
      const skillTotal = round4(skillUp * wUp + skillDown * wDown);

      matrix.push({
        decade,
        horizon,
        total: data.total,
        predUp: data.predUp,
        predDown: data.predDown,
        predNeutral: data.predNeutral,
        predUpShare: round4(predUpShare),
        realizedUp: data.realizedUp,
        realizedDown: data.realizedDown,
        realizedNeutral: data.realizedNeutral,
        baseUpRate: round4(baseUpRate),
        baseDownRate: round4(baseDownRate),
        hitTotal: round4(hitTotal),
        hitUp: round4(hitUp),
        hitDown: round4(hitDown),
        skillTotal,
        skillUp,
        skillDown
      });
    }

    // 4) Filter eligible cells
    const eligible = matrix.filter(c => c.total >= MIN_TOTAL);

    // 5) Sort by selected metric
    const getSkill = (c: RuleCell): number => {
      if (metric === 'skillUp') return c.skillUp;
      if (metric === 'skillDown') return c.skillDown;
      return c.skillTotal;
    };

    const sorted = [...eligible].sort((a, b) => getSkill(b) - getSkill(a));
    const winners = sorted.slice(0, 12);
    const losers = [...sorted].reverse().slice(0, 12);

    // 6) Extract rules
    const rules: ExtractedRules = {
      strongEdgeCells: eligible.filter(c => getSkill(c) >= STRONG_SKILL),
      weakEdgeCells: eligible.filter(c => getSkill(c) >= WEAK_SKILL && getSkill(c) < STRONG_SKILL),
      brokenCells: eligible.filter(c => getSkill(c) <= BROKEN_SKILL),
      cautionCells: eligible.filter(c => 
        Math.abs(getSkill(c)) >= CAUTION_ABS && 
        Math.abs(getSkill(c)) < STRONG_SKILL &&
        getSkill(c) > BROKEN_SKILL
      )
    };

    // 7) Summary by horizon
    const horizonMap = new Map<string, { samples: number; skillSum: number }>();
    for (const c of eligible) {
      const cur = horizonMap.get(c.horizon) ?? { samples: 0, skillSum: 0 };
      cur.samples += c.total;
      cur.skillSum += getSkill(c) * c.total;
      horizonMap.set(c.horizon, cur);
    }
    const horizonSummary = [...horizonMap.entries()]
      .map(([horizon, v]) => ({
        horizon,
        samples: v.samples,
        avgSkill: round4(safeDiv(v.skillSum, v.samples))
      }))
      .sort((a, b) => {
        const order: Record<string, number> = { '7d': 1, '14d': 2, '30d': 3, '90d': 4, '180d': 5, '365d': 6 };
        return (order[a.horizon] || 99) - (order[b.horizon] || 99);
      });

    // 8) Summary by decade
    const decadeMap = new Map<string, { samples: number; skillSum: number }>();
    for (const c of eligible) {
      const cur = decadeMap.get(c.decade) ?? { samples: 0, skillSum: 0 };
      cur.samples += c.total;
      cur.skillSum += getSkill(c) * c.total;
      decadeMap.set(c.decade, cur);
    }
    const decadeSummary = [...decadeMap.entries()]
      .map(([decade, v]) => ({
        decade,
        samples: v.samples,
        avgSkill: round4(safeDiv(v.skillSum, v.samples))
      }))
      .sort((a, b) => a.decade.localeCompare(b.decade));

    // 9) Overall diagnostics
    const avgSkillTotal = safeDiv(
      eligible.reduce((s, c) => s + getSkill(c) * c.total, 0),
      eligible.reduce((s, c) => s + c.total, 0)
    );

    return {
      diagnostics: {
        metric,
        minTotal: MIN_TOTAL,
        eligibleCells: eligible.length,
        totalCells: matrix.length,
        totalOutcomes: globalTotal,
        predUpShare: round4(safeDiv(globalPredUp, globalTotal)),
        avgSkillTotal: round4(avgSkillTotal)
      },
      matrix: eligible,
      winners,
      losers,
      rules,
      horizonSummary,
      decadeSummary
    };
  }

  /**
   * Get skill breakdown for Epoch Matrix heatmap
   */
  async getEpochMatrix(metric: SkillMetric = 'skillTotal'): Promise<{
    decades: string[];
    horizons: string[];
    cells: Array<{ decade: string; horizon: string; value: number; samples: number }>;
  }> {
    const result = await this.extract(metric);
    
    const decades = [...new Set(result.matrix.map(c => c.decade))].sort();
    const horizons = ['7d', '14d', '30d', '90d', '180d', '365d'];

    const getSkill = (c: RuleCell): number => {
      if (metric === 'skillUp') return c.skillUp;
      if (metric === 'skillDown') return c.skillDown;
      return c.skillTotal;
    };

    const cells = result.matrix.map(c => ({
      decade: c.decade,
      horizon: c.horizon,
      value: getSkill(c),
      samples: c.total
    }));

    return { decades, horizons, cells };
  }
}

export const spxRulesService = new SpxRulesService();
export default SpxRulesService;
