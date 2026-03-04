/**
 * FORWARD METRICS SERVICE (FP4)
 * 
 * Aggregates forward performance metrics by horizon.
 * Production-safe: upsert (no duplication), lock (no race condition).
 */
import { ForwardMetricsModel } from "../models/forward_metrics.model";
import { ForwardOutcomeModel } from "../models/forward_outcome.model";
import { ForwardSignalModel } from "../models/forward_signal.model";

type Asset = "BTC" | "SPX";

// In-memory lock to prevent parallel rebuilds
const rebuildLocks = new Set<string>();

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function confidenceFromStats(resolved: number, hitRate: number): "LOW" | "MEDIUM" | "HIGH" {
  if (resolved < 20) return "LOW";
  if (resolved < 100) return "MEDIUM";
  if (hitRate > 0.6 || hitRate < 0.4) return "HIGH";
  return "MEDIUM";
}

function isActionable(action: string): boolean {
  return action === "BUY" || action === "REDUCE";
}

function isHit(action: string, realizedReturn: number): boolean {
  if (action === "BUY") return realizedReturn > 0;
  if (action === "REDUCE") return realizedReturn < 0;
  return false;
}

export type HorizonMetrics = {
  horizonDays: number;
  attempted: number;
  resolved: number;
  pending: number;
  actionableResolved: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgForecastReturn: number;
  avgRealizedReturn: number;
  bias: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

export type HorizonActionMetrics = {
  horizonDays: number;
  action: string;
  resolved: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgForecastReturn: number;
  avgRealizedReturn: number;
  bias: number;
};

export type MetricsResult = {
  asset: string;
  asOf: Date;
  window: string;
  totals: {
    attempted: number;
    resolved: number;
    pending: number;
  };
  overall: {
    actionableResolved: number;
    hits: number;
    misses: number;
    hitRate: number;
    avgForecastReturn: number;
    avgRealizedReturn: number;
    bias: number;
  };
  byHorizon: HorizonMetrics[];
  byHorizonByAction: HorizonActionMetrics[];
};

/**
 * Rebuild forward metrics for an asset.
 * Uses upsert to prevent duplication.
 */
export async function rebuildForwardMetrics(params: {
  asset: Asset;
  window?: string;
}): Promise<MetricsResult> {
  const asset = params.asset;
  const window = params.window ?? "ALL_TIME";

  // Lock to prevent parallel rebuilds
  if (rebuildLocks.has(asset)) {
    throw new Error(`Metrics rebuild already running for ${asset}`);
  }
  rebuildLocks.add(asset);

  try {
    // Get all signals for the asset
    const signals = await ForwardSignalModel.find({ asset }).lean();
    
    // Get all outcomes for the asset
    const outcomes = await ForwardOutcomeModel.find({ asset }).lean();

    // Build signal map for quick lookup
    const signalMap = new Map<string, any>();
    for (const s of signals) {
      signalMap.set(String(s._id), s);
    }

    // Total counts
    const totalsAttempted = signals.length;
    const totalsResolved = outcomes.length;
    const totalsPending = totalsAttempted - totalsResolved;

    // Group by horizon
    const byHorizonMap = new Map<number, { signals: any[]; outcomes: any[] }>();
    const byHorizonByActionMap = new Map<string, { signals: any[]; outcomes: any[] }>();

    // Initialize horizon groups from signals
    for (const s of signals) {
      const h = Number(s.horizonDays);
      if (!byHorizonMap.has(h)) {
        byHorizonMap.set(h, { signals: [], outcomes: [] });
      }
      byHorizonMap.get(h)!.signals.push(s);

      const key = `${h}|${s.signalAction}`;
      if (!byHorizonByActionMap.has(key)) {
        byHorizonByActionMap.set(key, { signals: [], outcomes: [] });
      }
      byHorizonByActionMap.get(key)!.signals.push(s);
    }

    // Add outcomes to groups
    for (const o of outcomes) {
      const h = Number(o.horizonDays);
      if (byHorizonMap.has(h)) {
        byHorizonMap.get(h)!.outcomes.push(o);
      }

      // Get signal action for this outcome
      const signal = signalMap.get(String(o.signalId));
      const action = signal?.signalAction || "UNKNOWN";
      const key = `${h}|${action}`;
      if (byHorizonByActionMap.has(key)) {
        byHorizonByActionMap.get(key)!.outcomes.push(o);
      }
    }

    // Calculate overall metrics
    let overallHits = 0;
    let overallMisses = 0;
    let overallSumForecast = 0;
    let overallSumRealized = 0;
    let overallActionableResolved = 0;

    for (const o of outcomes) {
      const signal = signalMap.get(String(o.signalId));
      if (!signal) continue;

      const action = signal.signalAction;
      if (!isActionable(action)) continue;

      const realizedReturn = Number(o.realizedReturn);
      if (!Number.isFinite(realizedReturn)) continue;

      const forecastReturn = Number(signal.forecastReturn);
      if (!Number.isFinite(forecastReturn)) continue;

      overallActionableResolved++;
      overallSumForecast += forecastReturn;
      overallSumRealized += realizedReturn;

      if (isHit(action, realizedReturn)) {
        overallHits++;
      } else {
        overallMisses++;
      }
    }

    const overallHitRate = overallActionableResolved > 0 
      ? clamp01(overallHits / overallActionableResolved) 
      : 0;
    const overallAvgForecast = overallActionableResolved > 0 
      ? overallSumForecast / overallActionableResolved 
      : 0;
    const overallAvgRealized = overallActionableResolved > 0 
      ? overallSumRealized / overallActionableResolved 
      : 0;

    // Calculate by horizon
    const byHorizon: HorizonMetrics[] = Array.from(byHorizonMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([horizonDays, data]) => {
        const attempted = data.signals.length;
        const resolved = data.outcomes.length;
        const pending = attempted - resolved;

        let hits = 0;
        let misses = 0;
        let sumForecast = 0;
        let sumRealized = 0;
        let actionableResolved = 0;

        for (const o of data.outcomes) {
          const signal = signalMap.get(String(o.signalId));
          if (!signal) continue;

          const action = signal.signalAction;
          if (!isActionable(action)) continue;

          const realizedReturn = Number(o.realizedReturn);
          if (!Number.isFinite(realizedReturn)) continue;

          const forecastReturn = Number(signal.forecastReturn);
          if (!Number.isFinite(forecastReturn)) continue;

          actionableResolved++;
          sumForecast += forecastReturn;
          sumRealized += realizedReturn;

          if (isHit(action, realizedReturn)) {
            hits++;
          } else {
            misses++;
          }
        }

        const hitRate = actionableResolved > 0 ? clamp01(hits / actionableResolved) : 0;
        const avgForecastReturn = actionableResolved > 0 ? sumForecast / actionableResolved : 0;
        const avgRealizedReturn = actionableResolved > 0 ? sumRealized / actionableResolved : 0;
        const bias = avgRealizedReturn - avgForecastReturn;

        return {
          horizonDays,
          attempted,
          resolved,
          pending,
          actionableResolved,
          hits,
          misses,
          hitRate,
          avgForecastReturn,
          avgRealizedReturn,
          bias,
          confidence: confidenceFromStats(actionableResolved, hitRate),
        };
      });

    // Calculate by horizon by action
    const byHorizonByAction: HorizonActionMetrics[] = Array.from(byHorizonByActionMap.entries())
      .map(([key, data]) => {
        const [hStr, action] = key.split("|");
        const horizonDays = Number(hStr);

        let hits = 0;
        let misses = 0;
        let sumForecast = 0;
        let sumRealized = 0;
        let resolved = 0;

        for (const o of data.outcomes) {
          const signal = signalMap.get(String(o.signalId));
          if (!signal) continue;
          if (!isActionable(action)) continue;

          const realizedReturn = Number(o.realizedReturn);
          if (!Number.isFinite(realizedReturn)) continue;

          const forecastReturn = Number(signal.forecastReturn);
          if (!Number.isFinite(forecastReturn)) continue;

          resolved++;
          sumForecast += forecastReturn;
          sumRealized += realizedReturn;

          if (isHit(action, realizedReturn)) {
            hits++;
          } else {
            misses++;
          }
        }

        const hitRate = resolved > 0 ? clamp01(hits / resolved) : 0;
        const avgForecastReturn = resolved > 0 ? sumForecast / resolved : 0;
        const avgRealizedReturn = resolved > 0 ? sumRealized / resolved : 0;
        const bias = avgRealizedReturn - avgForecastReturn;

        return {
          horizonDays,
          action,
          resolved,
          hits,
          misses,
          hitRate,
          avgForecastReturn,
          avgRealizedReturn,
          bias,
        };
      })
      .filter(m => m.resolved > 0 || isActionable(m.action))
      .sort((a, b) => a.horizonDays - b.horizonDays || a.action.localeCompare(b.action));

    const now = new Date();

    // Upsert individual horizon metrics
    for (const h of byHorizon) {
      await ForwardMetricsModel.findOneAndUpdate(
        { asset, horizonDays: h.horizonDays },
        {
          asset,
          horizonDays: h.horizonDays,
          sampleSize: h.actionableResolved,
          hitRate: h.hitRate,
          avgRealizedReturn: h.avgRealizedReturn,
          avgForecastReturn: h.avgForecastReturn,
          bias: h.bias,
          updatedAsOf: now.toISOString(),
        },
        { upsert: true, new: true }
      );
    }

    const result: MetricsResult = {
      asset,
      asOf: now,
      window,
      totals: {
        attempted: totalsAttempted,
        resolved: totalsResolved,
        pending: totalsPending,
      },
      overall: {
        actionableResolved: overallActionableResolved,
        hits: overallHits,
        misses: overallMisses,
        hitRate: overallHitRate,
        avgForecastReturn: overallAvgForecast,
        avgRealizedReturn: overallAvgRealized,
        bias: overallAvgRealized - overallAvgForecast,
      },
      byHorizon,
      byHorizonByAction,
    };

    return result;
  } finally {
    rebuildLocks.delete(asset);
  }
}

/**
 * Get latest metrics for an asset
 */
export async function getLatestForwardMetrics(asset: Asset) {
  const metrics = await ForwardMetricsModel.find({ asset })
    .sort({ horizonDays: 1 })
    .lean();
  return metrics;
}

/**
 * Get metrics summary for an asset (production-ready API response)
 */
export async function getMetricsSummary(asset: Asset) {
  const metrics = await getLatestForwardMetrics(asset);
  
  if (!metrics || metrics.length === 0) {
    return null;
  }

  // Calculate overall from stored metrics
  let totalSamples = 0;
  let totalHits = 0;
  let sumForecast = 0;
  let sumRealized = 0;

  for (const m of metrics) {
    const samples = m.sampleSize || 0;
    const hitRate = m.hitRate || 0;
    totalSamples += samples;
    totalHits += Math.round(samples * hitRate);
    sumForecast += (m.avgForecastReturn || 0) * samples;
    sumRealized += (m.avgRealizedReturn || 0) * samples;
  }

  const overallHitRate = totalSamples > 0 ? totalHits / totalSamples : 0;
  const avgForecast = totalSamples > 0 ? sumForecast / totalSamples : 0;
  const avgRealized = totalSamples > 0 ? sumRealized / totalSamples : 0;

  return {
    asset,
    updatedAt: metrics[0]?.updatedAsOf || null,
    overall: {
      sampleSize: totalSamples,
      hitRate: overallHitRate,
      avgForecastReturn: avgForecast,
      avgRealizedReturn: avgRealized,
      bias: avgRealized - avgForecast,
    },
    byHorizon: metrics.map(m => ({
      horizonDays: m.horizonDays,
      sampleSize: m.sampleSize,
      hitRate: m.hitRate,
      avgForecastReturn: m.avgForecastReturn,
      avgRealizedReturn: m.avgRealizedReturn,
      bias: m.bias,
    })),
  };
}

/**
 * FP6: Get equity curve data for visualization
 * Returns cumulative performance over time
 */
export async function getEquityCurve(params: {
  asset: Asset;
  horizonDays?: number;
}) {
  const { asset, horizonDays } = params;
  
  // Get all signals and outcomes
  const signals = await ForwardSignalModel.find({ asset }).lean();
  const outcomes = await ForwardOutcomeModel.find({ asset }).lean();
  
  // Build signal map
  const signalMap = new Map<string, any>();
  for (const s of signals) {
    signalMap.set(String(s._id), s);
  }
  
  // Build equity curve points
  type EquityPoint = {
    date: string;
    value: number;
    return: number;
    action: string;
    hit: boolean;
    cumReturn: number;
  };
  
  const points: EquityPoint[] = [];
  let cumReturn = 0;
  let equityValue = 1.0; // Start at 1.0
  
  // Filter and sort outcomes by date
  let filteredOutcomes = outcomes;
  if (horizonDays) {
    filteredOutcomes = outcomes.filter(o => o.horizonDays === horizonDays);
  }
  
  // Sort by asOfDate
  const sortedOutcomes = filteredOutcomes
    .map(o => {
      const signal = signalMap.get(String(o.signalId));
      return { ...o, signal };
    })
    .filter(o => o.signal && isActionable(o.signal.signalAction))
    .sort((a, b) => {
      const dateA = new Date(a.asOfDate).getTime();
      const dateB = new Date(b.asOfDate).getTime();
      return dateA - dateB;
    });
  
  for (const o of sortedOutcomes) {
    const signal = o.signal;
    const action = signal.signalAction;
    const realizedReturn = Number(o.realizedReturn);
    
    if (!Number.isFinite(realizedReturn)) continue;
    
    // For REDUCE signals, we profit when market goes down
    const tradeReturn = action === "REDUCE" ? -realizedReturn : realizedReturn;
    
    cumReturn += tradeReturn;
    equityValue = equityValue * (1 + tradeReturn);
    
    const hit = isHit(action, realizedReturn);
    
    points.push({
      date: o.asOfDate,
      value: equityValue,
      return: tradeReturn,
      action,
      hit,
      cumReturn,
    });
  }
  
  // Calculate summary stats
  const wins = points.filter(p => p.hit).length;
  const losses = points.filter(p => !p.hit).length;
  const winRate = points.length > 0 ? wins / points.length : 0;
  
  // Max drawdown calculation
  let peak = 1.0;
  let maxDrawdown = 0;
  for (const p of points) {
    if (p.value > peak) peak = p.value;
    const dd = (peak - p.value) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  // CAGR calculation (simplified)
  const totalReturn = equityValue - 1;
  const years = points.length > 0 ? points.length / 12 : 1; // Rough estimate
  const cagr = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  
  return {
    asset,
    horizonDays: horizonDays || "ALL",
    equity: points,
    metrics: {
      trades: points.length,
      wins,
      losses,
      winRate,
      totalReturn,
      cagr,
      maxDrawdown,
      finalEquity: equityValue,
    },
  };
}
