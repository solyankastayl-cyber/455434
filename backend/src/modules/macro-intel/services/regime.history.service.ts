/**
 * Macro Regime History Service
 * ============================
 * 
 * Tracks and stores regime transitions for historical analysis.
 * P1.1 — Historical Regime Transitions
 */

import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RegimeTransition {
  from: string;
  to: string;
  timestamp: Date;
  durationHours: number;  // Duration of previous regime
  fearGreed: number;
  btcDominance: number;
  btcPrice?: number;
  riskLevelFrom: string;
  riskLevelTo: string;
  trigger?: string;       // What triggered the transition
}

export interface RegimeHistoryEntry {
  regime: string;
  riskLevel: string;
  startedAt: Date;
  endedAt?: Date;
  durationHours?: number;
  metrics: {
    fearGreedStart: number;
    fearGreedEnd?: number;
    btcDominanceStart: number;
    btcDominanceEnd?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_TRANSITIONS = 'macro_regime_transitions';
const COLLECTION_HISTORY = 'macro_regime_history';

// In-memory current regime tracking
let currentRegime: {
  regime: string;
  riskLevel: string;
  startedAt: Date;
  fearGreed: number;
  btcDominance: number;
  btcPrice?: number;
} | null = null;

// ═══════════════════════════════════════════════════════════════
// TRACK REGIME CHANGE
// ═══════════════════════════════════════════════════════════════

export async function trackRegimeChange(
  newRegime: string,
  newRiskLevel: string,
  metrics: {
    fearGreed: number;
    btcDominance: number;
    btcPrice?: number;
  }
): Promise<RegimeTransition | null> {
  const db = await getDb();
  const now = new Date();
  
  // Initialize if first call
  if (!currentRegime) {
    // Try to load from DB
    const lastHistory = await db.collection(COLLECTION_HISTORY).findOne(
      {},
      { sort: { startedAt: -1 } }
    );
    
    if (lastHistory) {
      currentRegime = {
        regime: lastHistory.regime,
        riskLevel: lastHistory.riskLevel,
        startedAt: lastHistory.startedAt,
        fearGreed: lastHistory.metrics.fearGreedStart,
        btcDominance: lastHistory.metrics.btcDominanceStart,
      };
    } else {
      // First time ever - just set current
      currentRegime = {
        regime: newRegime,
        riskLevel: newRiskLevel,
        startedAt: now,
        ...metrics,
      };
      
      // Store initial history entry
      await db.collection(COLLECTION_HISTORY).insertOne({
        regime: newRegime,
        riskLevel: newRiskLevel,
        startedAt: now,
        metrics: {
          fearGreedStart: metrics.fearGreed,
          btcDominanceStart: metrics.btcDominance,
        },
      });
      
      return null;
    }
  }
  
  // Check if regime changed
  if (currentRegime.regime === newRegime) {
    return null; // No change
  }
  
  // Calculate duration
  const durationMs = now.getTime() - currentRegime.startedAt.getTime();
  const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10;
  
  // Create transition record
  const transition: RegimeTransition = {
    from: currentRegime.regime,
    to: newRegime,
    timestamp: now,
    durationHours,
    fearGreed: metrics.fearGreed,
    btcDominance: metrics.btcDominance,
    btcPrice: metrics.btcPrice,
    riskLevelFrom: currentRegime.riskLevel,
    riskLevelTo: newRiskLevel,
    trigger: determineTransitionTrigger(currentRegime, newRegime, metrics),
  };
  
  // Store transition
  await db.collection(COLLECTION_TRANSITIONS).insertOne({
    ...transition,
    createdAt: now,
  });
  
  // Update previous history entry with end time
  await db.collection(COLLECTION_HISTORY).updateOne(
    { regime: currentRegime.regime, endedAt: { $exists: false } },
    {
      $set: {
        endedAt: now,
        durationHours,
        'metrics.fearGreedEnd': metrics.fearGreed,
        'metrics.btcDominanceEnd': metrics.btcDominance,
      },
    }
  );
  
  // Create new history entry
  await db.collection(COLLECTION_HISTORY).insertOne({
    regime: newRegime,
    riskLevel: newRiskLevel,
    startedAt: now,
    metrics: {
      fearGreedStart: metrics.fearGreed,
      btcDominanceStart: metrics.btcDominance,
    },
  });
  
  // Update current
  currentRegime = {
    regime: newRegime,
    riskLevel: newRiskLevel,
    startedAt: now,
    ...metrics,
  };
  
  console.log(`[Macro History] Regime transition: ${transition.from} → ${transition.to} (after ${durationHours}h)`);
  
  return transition;
}

// ═══════════════════════════════════════════════════════════════
// GET HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getRegimeHistory(limit: number = 50): Promise<RegimeHistoryEntry[]> {
  const db = await getDb();
  
  const history = await db.collection(COLLECTION_HISTORY)
    .find({})
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
  
  return history.map(h => ({
    regime: h.regime,
    riskLevel: h.riskLevel,
    startedAt: h.startedAt,
    endedAt: h.endedAt,
    durationHours: h.durationHours,
    metrics: h.metrics,
  }));
}

export async function getRegimeTransitions(limit: number = 50): Promise<RegimeTransition[]> {
  const db = await getDb();
  
  const transitions = await db.collection(COLLECTION_TRANSITIONS)
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  
  return transitions.map(({ _id, createdAt, ...rest }) => rest as RegimeTransition);
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export async function getRegimeStats(): Promise<{
  totalTransitions: number;
  regimeDistribution: Record<string, { count: number; avgDurationHours: number }>;
  mostFrequentTransitions: Array<{ from: string; to: string; count: number }>;
  currentRegime: {
    regime: string;
    riskLevel: string;
    durationHours: number;
  } | null;
}> {
  const db = await getDb();
  
  // Count total transitions
  const totalTransitions = await db.collection(COLLECTION_TRANSITIONS).countDocuments();
  
  // Regime distribution
  const historyDocs = await db.collection(COLLECTION_HISTORY).find({}).toArray();
  const regimeDistribution: Record<string, { count: number; totalDuration: number }> = {};
  
  for (const h of historyDocs) {
    if (!regimeDistribution[h.regime]) {
      regimeDistribution[h.regime] = { count: 0, totalDuration: 0 };
    }
    regimeDistribution[h.regime].count++;
    regimeDistribution[h.regime].totalDuration += h.durationHours || 0;
  }
  
  // Calculate averages
  const distribution: Record<string, { count: number; avgDurationHours: number }> = {};
  for (const [regime, data] of Object.entries(regimeDistribution)) {
    distribution[regime] = {
      count: data.count,
      avgDurationHours: data.count > 0 ? Math.round(data.totalDuration / data.count * 10) / 10 : 0,
    };
  }
  
  // Most frequent transitions
  const transitionCounts: Record<string, number> = {};
  const transitions = await db.collection(COLLECTION_TRANSITIONS).find({}).toArray();
  for (const t of transitions) {
    const key = `${t.from}→${t.to}`;
    transitionCounts[key] = (transitionCounts[key] || 0) + 1;
  }
  
  const mostFrequentTransitions = Object.entries(transitionCounts)
    .map(([key, count]) => {
      const [from, to] = key.split('→');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  // Current regime duration
  let currentRegimeInfo = null;
  if (currentRegime) {
    const durationMs = Date.now() - currentRegime.startedAt.getTime();
    currentRegimeInfo = {
      regime: currentRegime.regime,
      riskLevel: currentRegime.riskLevel,
      durationHours: Math.round(durationMs / (1000 * 60 * 60) * 10) / 10,
    };
  }
  
  return {
    totalTransitions,
    regimeDistribution: distribution,
    mostFrequentTransitions,
    currentRegime: currentRegimeInfo,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function determineTransitionTrigger(
  prev: typeof currentRegime,
  newRegime: string,
  metrics: { fearGreed: number; btcDominance: number }
): string {
  if (!prev) return 'INITIAL';
  
  const fearGreedDelta = metrics.fearGreed - prev.fearGreed;
  const btcDomDelta = metrics.btcDominance - prev.btcDominance;
  
  const triggers: string[] = [];
  
  // Fear & Greed change
  if (Math.abs(fearGreedDelta) > 10) {
    triggers.push(fearGreedDelta > 0 ? 'FEAR_GREED_UP' : 'FEAR_GREED_DOWN');
  }
  
  // BTC Dominance change
  if (Math.abs(btcDomDelta) > 2) {
    triggers.push(btcDomDelta > 0 ? 'BTC_DOM_UP' : 'BTC_DOM_DOWN');
  }
  
  // Regime-specific triggers
  if (newRegime === 'PANIC_SELL_OFF' && metrics.fearGreed < 20) {
    triggers.push('EXTREME_FEAR');
  }
  if (newRegime === 'ALT_SEASON' && metrics.btcDominance < 45) {
    triggers.push('ALT_DOMINANCE');
  }
  
  return triggers.length > 0 ? triggers.join('+') : 'GRADUAL_SHIFT';
}
