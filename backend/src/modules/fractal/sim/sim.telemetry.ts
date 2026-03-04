/**
 * BLOCK 34.1: Simulation Telemetry Engine
 * Event logging and breakdown analysis
 */

export type SimEventType =
  | 'ENTER'
  | 'EXIT'
  | 'FLIP'
  | 'FORCE_EXIT'
  | 'SOFT_KILL'
  | 'HARD_KILL'
  | 'DRIFT_CHANGE'
  | 'RETRAIN'
  | 'PROMOTE'
  | 'ROLLBACK'
  | 'HORIZON_CHANGE'
  | 'REGIME_CHANGE'
  | 'DD_THRESHOLD'
  | 'COOLDOWN_START'
  | 'COOLDOWN_END';

export interface SimEvent {
  ts: string;
  type: SimEventType;
  meta?: Record<string, any>;
}

export interface YearlyBreakdown {
  year: string;
  events: number;
  returns: number[];
  sharpe: number;
  maxDD: number;
  trades: number;
}

export interface RegimeBreakdown {
  regime: string;
  trades: number;
  pnl: number;
  avgHoldDays: number;
}

export interface HorizonBreakdown {
  horizon: number;
  count: number;
  avgReturn: number;
}

export class SimTelemetry {
  private events: SimEvent[] = [];
  private yearlyReturns: Map<string, number[]> = new Map();
  private regimeStats: Map<string, { trades: number; pnl: number; holdDays: number[] }> = new Map();
  private horizonStats: Map<number, { count: number; returns: number[] }> = new Map();

  /**
   * Log an event
   */
  log(type: SimEventType, ts: Date, meta?: Record<string, any>): void {
    this.events.push({
      ts: ts.toISOString(),
      type,
      meta
    });
  }

  /**
   * Track yearly return
   */
  trackYearlyReturn(ts: Date, ret: number): void {
    const year = ts.getUTCFullYear().toString();
    if (!this.yearlyReturns.has(year)) {
      this.yearlyReturns.set(year, []);
    }
    this.yearlyReturns.get(year)!.push(ret);
  }

  /**
   * Track regime performance
   */
  trackRegimeTrade(regime: string, pnl: number, holdDays: number): void {
    if (!this.regimeStats.has(regime)) {
      this.regimeStats.set(regime, { trades: 0, pnl: 0, holdDays: [] });
    }
    const stats = this.regimeStats.get(regime)!;
    stats.trades++;
    stats.pnl += pnl;
    stats.holdDays.push(holdDays);
  }

  /**
   * Track horizon usage
   */
  trackHorizon(horizon: number, ret: number): void {
    if (!this.horizonStats.has(horizon)) {
      this.horizonStats.set(horizon, { count: 0, returns: [] });
    }
    const stats = this.horizonStats.get(horizon)!;
    stats.count++;
    stats.returns.push(ret);
  }

  /**
   * Get all events (limited)
   */
  getEvents(limit: number = 10000): SimEvent[] {
    return this.events.slice(0, limit);
  }

  /**
   * Count events by type
   */
  count(type: SimEventType): number {
    return this.events.filter(e => e.type === type).length;
  }

  /**
   * Count all event types
   */
  countAll(): Record<SimEventType, number> {
    const counts: Record<string, number> = {};
    for (const e of this.events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts as Record<SimEventType, number>;
  }

  /**
   * Get events by year
   */
  breakdownEventsByYear(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const e of this.events) {
      const year = e.ts.slice(0, 4);
      map[year] = (map[year] || 0) + 1;
    }
    return map;
  }

  /**
   * Get yearly performance breakdown
   */
  getYearlyBreakdown(): YearlyBreakdown[] {
    const result: YearlyBreakdown[] = [];

    for (const [year, returns] of this.yearlyReturns.entries()) {
      if (returns.length === 0) continue;

      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.length > 1
        ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
        : 0;
      const vol = Math.sqrt(variance);
      const sharpe = vol > 0 ? (mean * Math.sqrt(52)) / vol : 0;

      // Calculate max DD for year
      let peak = 1;
      let maxDD = 0;
      let equity = 1;
      for (const r of returns) {
        equity *= (1 + r);
        if (equity > peak) peak = equity;
        const dd = (peak - equity) / peak;
        if (dd > maxDD) maxDD = dd;
      }

      // Count trades in this year
      const trades = this.events.filter(e =>
        e.ts.startsWith(year) && e.type === 'ENTER'
      ).length;

      result.push({
        year,
        events: this.events.filter(e => e.ts.startsWith(year)).length,
        returns,
        sharpe,
        maxDD,
        trades
      });
    }

    return result.sort((a, b) => a.year.localeCompare(b.year));
  }

  /**
   * Get regime breakdown
   */
  getRegimeBreakdown(): RegimeBreakdown[] {
    const result: RegimeBreakdown[] = [];

    for (const [regime, stats] of this.regimeStats.entries()) {
      const avgHoldDays = stats.holdDays.length
        ? stats.holdDays.reduce((a, b) => a + b, 0) / stats.holdDays.length
        : 0;

      result.push({
        regime,
        trades: stats.trades,
        pnl: stats.pnl,
        avgHoldDays
      });
    }

    return result.sort((a, b) => b.trades - a.trades);
  }

  /**
   * Get horizon breakdown
   */
  getHorizonBreakdown(): HorizonBreakdown[] {
    const result: HorizonBreakdown[] = [];

    for (const [horizon, stats] of this.horizonStats.entries()) {
      const avgReturn = stats.returns.length
        ? stats.returns.reduce((a, b) => a + b, 0) / stats.returns.length
        : 0;

      result.push({
        horizon,
        count: stats.count,
        avgReturn
      });
    }

    return result.sort((a, b) => a.horizon - b.horizon);
  }

  /**
   * Get DD attribution by period
   * Returns segments where largest DD occurred
   */
  getDDAttribution(equityCurve: { ts: Date; equity: number }[]): {
    maxDDPeriod: { start: string; end: string; dd: number };
    topDDPeriods: { start: string; end: string; dd: number }[];
  } {
    if (equityCurve.length < 2) {
      return {
        maxDDPeriod: { start: '', end: '', dd: 0 },
        topDDPeriods: []
      };
    }

    let peak = equityCurve[0].equity;
    let peakIdx = 0;
    let maxDD = 0;
    let maxDDStart = 0;
    let maxDDEnd = 0;

    const ddPeriods: { startIdx: number; endIdx: number; dd: number }[] = [];

    for (let i = 1; i < equityCurve.length; i++) {
      const eq = equityCurve[i].equity;
      
      if (eq > peak) {
        // New peak - close any open DD period
        if (maxDD > 0.05) { // Track DD > 5%
          ddPeriods.push({
            startIdx: peakIdx,
            endIdx: i - 1,
            dd: maxDD
          });
        }
        peak = eq;
        peakIdx = i;
        maxDD = 0;
      } else {
        const dd = (peak - eq) / peak;
        if (dd > maxDD) {
          maxDD = dd;
          maxDDStart = peakIdx;
          maxDDEnd = i;
        }
      }
    }

    // Add final DD period if significant
    if (maxDD > 0.05) {
      ddPeriods.push({
        startIdx: peakIdx,
        endIdx: equityCurve.length - 1,
        dd: maxDD
      });
    }

    // Sort by DD desc and take top 5
    ddPeriods.sort((a, b) => b.dd - a.dd);
    const topPeriods = ddPeriods.slice(0, 5);

    const formatPeriod = (startIdx: number, endIdx: number, dd: number) => ({
      start: equityCurve[startIdx]?.ts?.toISOString?.()?.slice(0, 10) || '',
      end: equityCurve[endIdx]?.ts?.toISOString?.()?.slice(0, 10) || '',
      dd: Math.round(dd * 10000) / 10000
    });

    return {
      maxDDPeriod: formatPeriod(maxDDStart, maxDDEnd, ddPeriods[0]?.dd || 0),
      topDDPeriods: topPeriods.map(p => formatPeriod(p.startIdx, p.endIdx, p.dd))
    };
  }

  /**
   * Get summary telemetry object
   */
  getSummary(): {
    eventCounts: Record<string, number>;
    eventsByYear: Record<string, number>;
    retrainCount: number;
    rollbackCount: number;
    promoteCount: number;
    hardKills: number;
    softKills: number;
    horizonChanges: number;
    driftChanges: number;
    avgEventsPerYear: number;
  } {
    const eventCounts = this.countAll();
    const eventsByYear = this.breakdownEventsByYear();
    const years = Object.keys(eventsByYear);

    return {
      eventCounts,
      eventsByYear,
      retrainCount: this.count('RETRAIN'),
      rollbackCount: this.count('ROLLBACK'),
      promoteCount: this.count('PROMOTE'),
      hardKills: this.count('HARD_KILL'),
      softKills: this.count('SOFT_KILL'),
      horizonChanges: this.count('HORIZON_CHANGE'),
      driftChanges: this.count('DRIFT_CHANGE'),
      avgEventsPerYear: years.length
        ? this.events.length / years.length
        : 0
    };
  }

  /**
   * Reset telemetry
   */
  reset(): void {
    this.events = [];
    this.yearlyReturns.clear();
    this.regimeStats.clear();
    this.horizonStats.clear();
  }
}
