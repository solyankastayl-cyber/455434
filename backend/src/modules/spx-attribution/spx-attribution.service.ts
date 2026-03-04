/**
 * SPX ATTRIBUTION — Service
 * 
 * BLOCK B6.2 — Computes attribution metrics from spx_outcomes
 */

import { SpxOutcomeModel } from '../spx-memory/spx-outcome.model.js';
import { SpxSnapshotModel } from '../spx-memory/spx-snapshot.model.js';
import type {
  SpxAttributionResponse,
  SpxAttributionQuery,
  SpxKpis,
  BreakdownItem,
  SpxInsight,
  SpxWindow,
  SpxSource,
  SpxCohort,
  SpxPreset
} from './spx-attribution.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function windowToDays(window: SpxWindow): number {
  switch (window) {
    case '30d': return 30;
    case '90d': return 90;
    case '365d': return 365;
    case 'all': return 99999;
    default: return 90;
  }
}

function getDateFilter(window: SpxWindow): { $gte?: string } | {} {
  if (window === 'all') return {};
  
  const days = windowToDays(window);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return { $gte: cutoff.toISOString().slice(0, 10) };
}

function getSourceFilter(source: SpxSource): string[] {
  switch (source) {
    case 'LIVE': return ['LIVE'];
    case 'VINTAGE': return ['V1950', 'V1990', 'V2008', 'V2020', 'BOOTSTRAP'];
    case 'ALL': return ['LIVE', 'V1950', 'V1990', 'V2008', 'V2020', 'BOOTSTRAP'];
    default: return ['LIVE', 'V1950', 'V1990', 'V2008', 'V2020', 'BOOTSTRAP'];
  }
}

function getCohortFilter(cohort: SpxCohort): string[] {
  if (cohort === 'ALL') return ['LIVE', 'V1950', 'V1990', 'V2008', 'V2020', 'BOOTSTRAP'];
  return [cohort];
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class SpxAttributionService {
  
  async getAttribution(query: SpxAttributionQuery): Promise<SpxAttributionResponse> {
    const window = query.window || '90d';
    const source = query.source || 'ALL';
    const cohort = query.cohort || 'ALL';
    const preset = query.preset || 'BALANCED';
    
    const dateFilter = getDateFilter(window);
    const sourceFilter = getSourceFilter(source);
    const cohortFilter = getCohortFilter(cohort);
    
    // Build match criteria
    const match: any = {
      symbol: 'SPX',
      source: { $in: sourceFilter },
    };
    
    if (cohort !== 'ALL') {
      match.source = { $in: cohortFilter };
    }
    
    if (dateFilter.$gte) {
      match.resolvedDate = dateFilter;
    }
    
    // Get all outcomes
    const outcomes = await SpxOutcomeModel.find(match).lean();
    
    // Compute KPIs
    const kpis = this.computeKpis(outcomes);
    
    // Compute breakdowns
    const breakdowns = await this.computeBreakdowns(outcomes, match);
    
    // Compute counts
    const counts = this.computeCounts(outcomes);
    
    // Generate insights
    const insights = this.generateInsights(kpis, breakdowns);
    
    return {
      ok: true,
      symbol: 'SPX',
      filters: { window, source, cohort, preset },
      kpis,
      breakdowns,
      counts,
      insights,
      computedAt: new Date().toISOString(),
    };
  }
  
  private computeKpis(outcomes: any[]): SpxKpis {
    if (outcomes.length === 0) {
      return {
        totalOutcomes: 0,
        hitRate: 0,
        expectancy: 0,
        avgReturn: 0,
        sharpe: 0,
        maxDD: 0,
      };
    }
    
    const hits = outcomes.filter(o => o.hit).length;
    const returns = outcomes.map(o => o.actualReturnPct / 100);
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    
    // Expectancy: avg win * win rate - avg loss * loss rate
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r < 0);
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const winRate = hits / outcomes.length;
    const expectancy = avgWin * winRate - avgLoss * (1 - winRate);
    
    // Max drawdown (simplified)
    let peak = 1;
    let maxDD = 0;
    let equity = 1;
    for (const r of returns) {
      equity *= (1 + r);
      if (equity > peak) peak = equity;
      const dd = (equity - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    
    return {
      totalOutcomes: outcomes.length,
      hitRate: Math.round(winRate * 1000) / 10,
      expectancy: Math.round(expectancy * 10000) / 10000,
      avgReturn: Math.round(avgReturn * 10000) / 100,
      sharpe: std > 0 ? Math.round((avgReturn / std) * 100) / 100 : 0,
      maxDD: Math.round(maxDD * 1000) / 10,
    };
  }
  
  private async computeBreakdowns(outcomes: any[], baseMatch: any) {
    // Get snapshots to join horizon/tier info
    const snapshotIds = outcomes.map(o => o.snapshotId);
    const snapshots = await SpxSnapshotModel.find({
      _id: { $in: snapshotIds.map(id => id) }
    }).lean();
    
    const snapshotMap = new Map();
    for (const s of snapshots) {
      snapshotMap.set(String((s as any)._id), s);
    }
    
    // Enrich outcomes with snapshot data
    const enriched = outcomes.map(o => {
      const snap = snapshotMap.get(o.snapshotId) || {};
      return {
        ...o,
        tier: snap.tier || 'UNKNOWN',
        phaseType: snap.phaseType || 'UNKNOWN',
        divergenceGrade: snap.divergenceGrade || 'NA',
      };
    });
    
    return {
      tier: this.groupBreakdown(enriched, 'tier'),
      horizon: this.groupBreakdown(enriched, 'horizon'),
      phase: this.groupBreakdown(enriched, 'phaseType'),
      divergence: this.groupBreakdown(enriched, 'divergenceGrade'),
    };
  }
  
  private groupBreakdown(outcomes: any[], key: string): BreakdownItem[] {
    const groups = new Map<string, any[]>();
    
    for (const o of outcomes) {
      const k = o[key] || 'UNKNOWN';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(o);
    }
    
    const items: BreakdownItem[] = [];
    
    for (const [k, group] of groups) {
      const hits = group.filter(o => o.hit).length;
      const returns = group.map(o => o.actualReturnPct / 100);
      const avgReturn = returns.length > 0 
        ? returns.reduce((a, b) => a + b, 0) / returns.length 
        : 0;
      
      const wins = returns.filter(r => r > 0);
      const losses = returns.filter(r => r < 0);
      const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
      const winRate = hits / group.length;
      const expectancy = avgWin * winRate - avgLoss * (1 - winRate);
      
      items.push({
        key: k,
        label: k,
        outcomes: group.length,
        hits,
        hitRate: Math.round(winRate * 1000) / 10,
        avgReturn: Math.round(avgReturn * 10000) / 100,
        expectancy: Math.round(expectancy * 10000) / 10000,
      });
    }
    
    return items.sort((a, b) => b.hitRate - a.hitRate);
  }
  
  private computeCounts(outcomes: any[]) {
    const bySource: Record<string, number> = {};
    const byCohort: Record<string, number> = {};
    
    for (const o of outcomes) {
      bySource[o.source] = (bySource[o.source] || 0) + 1;
      // cohort = source for SPX
      byCohort[o.source] = (byCohort[o.source] || 0) + 1;
    }
    
    return {
      total: outcomes.length,
      bySource,
      byCohort,
    };
  }
  
  private generateInsights(kpis: SpxKpis, breakdowns: any): SpxInsight[] {
    const insights: SpxInsight[] = [];
    
    // Hit rate insight
    if (kpis.hitRate > 55) {
      insights.push({
        type: 'INFO',
        title: 'Strong Hit Rate',
        description: `SPX hit rate at ${kpis.hitRate}% exceeds baseline.`,
        metric: 'hitRate',
      });
    } else if (kpis.hitRate < 45) {
      insights.push({
        type: 'WARNING',
        title: 'Low Hit Rate',
        description: `SPX hit rate at ${kpis.hitRate}% is below acceptable threshold.`,
        metric: 'hitRate',
      });
    }
    
    // Tier comparison
    const tiers = breakdowns.tier || [];
    const structureTier = tiers.find((t: any) => t.key === 'STRUCTURE');
    const timingTier = tiers.find((t: any) => t.key === 'TIMING');
    
    if (structureTier && timingTier) {
      const delta = structureTier.hitRate - timingTier.hitRate;
      if (delta >= 5) {
        insights.push({
          type: 'RECOMMENDATION',
          title: 'Structure Dominates',
          description: `STRUCTURE outperforms TIMING by ${delta.toFixed(1)}pp. Consider increasing STRUCTURE weight.`,
          metric: 'tier',
          delta,
        });
      }
    }
    
    // Divergence impact
    const divs = breakdowns.divergence || [];
    const gradeF = divs.find((d: any) => d.key === 'F');
    if (gradeF && gradeF.expectancy < 0) {
      insights.push({
        type: 'WARNING',
        title: 'Divergence F Collapse',
        description: `Grade F outcomes have negative expectancy (${(gradeF.expectancy * 100).toFixed(2)}%). Tighten divergence penalty.`,
        metric: 'divergence',
      });
    }
    
    // Phase insight
    const phases = breakdowns.phase || [];
    const bearPhase = phases.find((p: any) => p.key === 'BEAR_DRAWDOWN');
    if (bearPhase && bearPhase.avgReturn < -5) {
      insights.push({
        type: 'WARNING',
        title: 'Bear Phase Risk',
        description: `BEAR_DRAWDOWN phase has ${bearPhase.avgReturn.toFixed(1)}% avg return. Consider phase-aware sizing.`,
        metric: 'phase',
      });
    }
    
    return insights;
  }
}

export const spxAttributionService = new SpxAttributionService();

export default SpxAttributionService;
