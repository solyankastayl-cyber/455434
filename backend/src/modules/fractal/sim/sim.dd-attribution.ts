/**
 * BLOCK 34.3: DD Attribution Engine
 * Diagnose WHERE drawdowns originate
 * - By year
 * - By regime
 * - By horizon
 * - By side (long/short)
 * - By confidence level
 */

export interface DDSegment {
  ts: Date;
  dd: number;
  equity: number;
  peakEquity: number;
  year: string;
  regime: string;
  volatility: string;
  horizon: number;
  side: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  holdDays: number;
  entryPrice: number;
  currentPrice: number;
  positionPnl: number;
}

export interface DDGroupStats {
  count: number;
  avgDD: number;
  maxDD: number;
  totalDD: number;
  avgConfidence: number;
  avgHoldDays: number;
  segments: number;
}

export interface DDAttribution {
  totalSegments: number;
  peakDD: number;
  avgDD: number;
  
  // By dimension
  byYear: Record<string, DDGroupStats>;
  byRegime: Record<string, DDGroupStats>;
  byVolatility: Record<string, DDGroupStats>;
  byHorizon: Record<string, DDGroupStats>;
  bySide: Record<string, DDGroupStats>;
  byConfidenceBucket: Record<string, DDGroupStats>;
  
  // Cross-dimensional insights
  worstSegments: DDSegment[];
  dominantPattern: {
    year: string | null;
    regime: string | null;
    horizon: number | null;
    side: string | null;
    confidence: string | null;
    explanation: string;
  };
  
  // Actionable insights
  insights: string[];
}

export class DDAttributionEngine {
  private segments: DDSegment[] = [];
  private minDDThreshold = 0.05; // Track DD > 5%

  /**
   * Track a potential DD segment
   */
  track(params: {
    ts: Date;
    equity: number;
    peakEquity: number;
    regime?: { trend: string; volatility: string };
    horizon: number;
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    holdDays: number;
    entryPrice: number;
    currentPrice: number;
    positionPnl: number;
  }): void {
    const dd = params.peakEquity > 0 
      ? (params.peakEquity - params.equity) / params.peakEquity 
      : 0;

    if (dd < this.minDDThreshold) return;

    this.segments.push({
      ts: params.ts,
      dd,
      equity: params.equity,
      peakEquity: params.peakEquity,
      year: params.ts.getUTCFullYear().toString(),
      regime: params.regime?.trend ?? 'UNKNOWN',
      volatility: params.regime?.volatility ?? 'UNKNOWN',
      horizon: params.horizon,
      side: params.side,
      confidence: params.confidence,
      holdDays: params.holdDays,
      entryPrice: params.entryPrice,
      currentPrice: params.currentPrice,
      positionPnl: params.positionPnl
    });
  }

  /**
   * Compute full attribution
   */
  compute(): DDAttribution {
    if (this.segments.length === 0) {
      return this.emptyAttribution();
    }

    const byYear = this.groupBy(s => s.year);
    const byRegime = this.groupBy(s => s.regime);
    const byVolatility = this.groupBy(s => s.volatility);
    const byHorizon = this.groupBy(s => String(s.horizon));
    const bySide = this.groupBy(s => s.side);
    const byConfidenceBucket = this.groupBy(s => this.confidenceBucket(s.confidence));

    const peakDD = Math.max(...this.segments.map(s => s.dd));
    const avgDD = this.segments.reduce((a, s) => a + s.dd, 0) / this.segments.length;

    // Worst segments
    const worstSegments = [...this.segments]
      .sort((a, b) => b.dd - a.dd)
      .slice(0, 10);

    // Dominant pattern analysis
    const dominantPattern = this.findDominantPattern(byYear, byRegime, byHorizon, bySide, byConfidenceBucket);
    
    // Generate insights
    const insights = this.generateInsights(byYear, byRegime, byVolatility, byHorizon, bySide, byConfidenceBucket);

    return {
      totalSegments: this.segments.length,
      peakDD: this.round(peakDD, 4),
      avgDD: this.round(avgDD, 4),
      byYear: this.mapStats(byYear),
      byRegime: this.mapStats(byRegime),
      byVolatility: this.mapStats(byVolatility),
      byHorizon: this.mapStats(byHorizon),
      bySide: this.mapStats(bySide),
      byConfidenceBucket: this.mapStats(byConfidenceBucket),
      worstSegments: worstSegments.map(s => ({
        ...s,
        dd: this.round(s.dd, 4),
        confidence: this.round(s.confidence, 3),
        positionPnl: this.round(s.positionPnl, 4)
      })),
      dominantPattern,
      insights
    };
  }

  /**
   * Group segments by key
   */
  private groupBy(keyFn: (s: DDSegment) => string): Map<string, DDSegment[]> {
    const map = new Map<string, DDSegment[]>();
    for (const s of this.segments) {
      const key = keyFn(s);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }

  /**
   * Convert confidence to bucket
   */
  private confidenceBucket(conf: number): string {
    if (conf >= 0.8) return 'HIGH (>=80%)';
    if (conf >= 0.5) return 'MEDIUM (50-80%)';
    if (conf >= 0.2) return 'LOW (20-50%)';
    return 'VERY_LOW (<20%)';
  }

  /**
   * Compute stats for each group
   */
  private mapStats(groups: Map<string, DDSegment[]>): Record<string, DDGroupStats> {
    const result: Record<string, DDGroupStats> = {};
    
    for (const [key, segs] of groups.entries()) {
      const dds = segs.map(s => s.dd);
      const confs = segs.map(s => s.confidence);
      const holds = segs.map(s => s.holdDays);

      result[key] = {
        count: segs.length,
        avgDD: this.round(dds.reduce((a, b) => a + b, 0) / dds.length, 4),
        maxDD: this.round(Math.max(...dds), 4),
        totalDD: this.round(dds.reduce((a, b) => a + b, 0), 4),
        avgConfidence: this.round(confs.reduce((a, b) => a + b, 0) / confs.length, 3),
        avgHoldDays: this.round(holds.reduce((a, b) => a + b, 0) / holds.length, 1),
        segments: segs.length
      };
    }

    return result;
  }

  /**
   * Find dominant pattern
   */
  private findDominantPattern(
    byYear: Map<string, DDSegment[]>,
    byRegime: Map<string, DDSegment[]>,
    byHorizon: Map<string, DDSegment[]>,
    bySide: Map<string, DDSegment[]>,
    byConf: Map<string, DDSegment[]>
  ): DDAttribution['dominantPattern'] {
    const findMax = (m: Map<string, DDSegment[]>) => {
      let maxKey: string | null = null;
      let maxCount = 0;
      for (const [k, v] of m.entries()) {
        if (v.length > maxCount) {
          maxCount = v.length;
          maxKey = k;
        }
      }
      return { key: maxKey, count: maxCount, pct: this.segments.length > 0 ? maxCount / this.segments.length : 0 };
    };

    const yearMax = findMax(byYear);
    const regimeMax = findMax(byRegime);
    const horizonMax = findMax(byHorizon);
    const sideMax = findMax(bySide);
    const confMax = findMax(byConf);

    // Build explanation
    const parts: string[] = [];
    if (yearMax.pct > 0.4) parts.push(`${Math.round(yearMax.pct * 100)}% DD in ${yearMax.key}`);
    if (regimeMax.pct > 0.4) parts.push(`${Math.round(regimeMax.pct * 100)}% DD in ${regimeMax.key} regime`);
    if (horizonMax.pct > 0.4) parts.push(`${Math.round(horizonMax.pct * 100)}% DD at horizon ${horizonMax.key}`);
    if (sideMax.pct > 0.5) parts.push(`${Math.round(sideMax.pct * 100)}% DD on ${sideMax.key} side`);
    if (confMax.pct > 0.4) parts.push(`${Math.round(confMax.pct * 100)}% DD with ${confMax.key} confidence`);

    return {
      year: yearMax.pct > 0.3 ? yearMax.key : null,
      regime: regimeMax.pct > 0.3 ? regimeMax.key : null,
      horizon: horizonMax.pct > 0.3 ? Number(horizonMax.key) : null,
      side: sideMax.pct > 0.4 ? sideMax.key : null,
      confidence: confMax.pct > 0.3 ? confMax.key : null,
      explanation: parts.length > 0 ? parts.join('; ') : 'DD evenly distributed across dimensions'
    };
  }

  /**
   * Generate actionable insights
   */
  private generateInsights(
    byYear: Map<string, DDSegment[]>,
    byRegime: Map<string, DDSegment[]>,
    byVolatility: Map<string, DDSegment[]>,
    byHorizon: Map<string, DDSegment[]>,
    bySide: Map<string, DDSegment[]>,
    byConf: Map<string, DDSegment[]>
  ): string[] {
    const insights: string[] = [];
    const total = this.segments.length;
    if (total === 0) return ['No significant DD segments detected'];

    // Year concentration
    for (const [year, segs] of byYear.entries()) {
      const pct = segs.length / total;
      if (pct > 0.5) {
        const avgDD = segs.reduce((a, s) => a + s.dd, 0) / segs.length;
        insights.push(`🔴 ${Math.round(pct * 100)}% of DD concentrated in ${year} (avgDD: ${(avgDD * 100).toFixed(1)}%)`);
      }
    }

    // Regime concentration
    for (const [regime, segs] of byRegime.entries()) {
      const pct = segs.length / total;
      if (pct > 0.4) {
        insights.push(`⚠️ ${Math.round(pct * 100)}% of DD in ${regime} regime → Consider regime-specific risk`);
      }
    }

    // Volatility concentration
    const highVolSegs = byVolatility.get('HIGH_VOL') ?? [];
    if (highVolSegs.length / total > 0.5) {
      insights.push(`⚠️ ${Math.round(highVolSegs.length / total * 100)}% DD in HIGH_VOL → Consider vol-based exposure scaling`);
    }

    // Horizon concentration
    for (const [horizon, segs] of byHorizon.entries()) {
      const pct = segs.length / total;
      if (pct > 0.5) {
        insights.push(`⚠️ ${Math.round(pct * 100)}% DD at horizon ${horizon} → Consider horizon hysteresis`);
      }
    }

    // Side asymmetry
    const longSegs = bySide.get('LONG') ?? [];
    const shortSegs = bySide.get('SHORT') ?? [];
    const longPct = longSegs.length / total;
    const shortPct = shortSegs.length / total;
    if (longPct > 0.7) {
      insights.push(`⚠️ ${Math.round(longPct * 100)}% DD on LONG side → Consider asymmetric risk for longs`);
    } else if (shortPct > 0.7) {
      insights.push(`⚠️ ${Math.round(shortPct * 100)}% DD on SHORT side → Consider tighter short exposure`);
    }

    // Confidence analysis
    const lowConfSegs = [...(byConf.get('LOW (20-50%)') ?? []), ...(byConf.get('VERY_LOW (<20%)') ?? [])];
    const lowConfPct = lowConfSegs.length / total;
    if (lowConfPct > 0.5) {
      insights.push(`🔴 ${Math.round(lowConfPct * 100)}% DD from LOW confidence entries → Need confidence gating`);
    }

    // Average hold days analysis
    const avgHold = this.segments.reduce((a, s) => a + s.holdDays, 0) / total;
    if (avgHold > 30) {
      insights.push(`⚠️ Avg hold during DD: ${avgHold.toFixed(0)} days → Consider shorter maxHold or earlier exit`);
    }

    if (insights.length === 0) {
      insights.push('✅ DD evenly distributed — no single dominant pattern');
    }

    return insights;
  }

  /**
   * Empty attribution
   */
  private emptyAttribution(): DDAttribution {
    return {
      totalSegments: 0,
      peakDD: 0,
      avgDD: 0,
      byYear: {},
      byRegime: {},
      byVolatility: {},
      byHorizon: {},
      bySide: {},
      byConfidenceBucket: {},
      worstSegments: [],
      dominantPattern: {
        year: null,
        regime: null,
        horizon: null,
        side: null,
        confidence: null,
        explanation: 'No DD segments to analyze'
      },
      insights: ['No significant drawdown segments detected']
    };
  }

  private round(n: number, d: number): number {
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }

  /**
   * Reset for new simulation
   */
  reset(): void {
    this.segments = [];
  }
}
