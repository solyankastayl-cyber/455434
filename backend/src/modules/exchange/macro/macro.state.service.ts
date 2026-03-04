/**
 * BLOCK 2.2 — Macro State Service
 * =================================
 * Tracks BTC.D, ETH.D, Fear & Greed and classifies macro regime.
 */

import type { Collection, Db } from 'mongodb';
import type { MacroState, MacroRegime } from './macro.types.js';

// Fear & Greed thresholds
const FEAR_EXTREME = 20;
const FEAR_NORMAL = 40;
const GREED_NORMAL = 60;
const GREED_EXTREME = 80;

// Dominance thresholds
const BTC_D_HIGH = 55;
const BTC_D_LOW = 45;
const BTC_D_DELTA_THRESHOLD = 1.5;  // % change per day

export class MacroStateService {
  private col: Collection<MacroState> | null = null;
  private currentState: MacroState | null = null;

  init(db: Db) {
    this.col = db.collection<MacroState>('macro_state');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ ts: -1 });
      await this.col.createIndex({ regime: 1, ts: -1 });
    } catch (e) {
      console.warn('[MacroState] Index creation:', e);
    }
  }

  /**
   * Update macro state with new data
   */
  async update(data: {
    btcDominance: number;
    ethDominance: number;
    fearGreedIndex: number;
    btcPrice: number;
    btcChange24h: number;
  }): Promise<MacroState> {
    const prev = this.currentState;
    const ts = Date.now();

    // Calculate deltas
    const btcDominanceDelta24h = prev 
      ? data.btcDominance - prev.btcDominance 
      : 0;
    const ethDominanceDelta24h = prev
      ? data.ethDominance - prev.ethDominance
      : 0;

    // Classify fear/greed
    const fearGreedLabel = this.classifyFearGreed(data.fearGreedIndex);

    // Classify BTC trend
    const btcTrend = this.classifyBtcTrend(data.btcChange24h);

    // Classify macro regime
    const { regime, confidence } = this.classifyRegime(
      data.btcDominance,
      btcDominanceDelta24h,
      data.ethDominance,
      data.fearGreedIndex,
      btcTrend
    );

    const state: MacroState = {
      ts,
      btcDominance: data.btcDominance,
      btcDominanceDelta24h,
      ethDominance: data.ethDominance,
      ethDominanceDelta24h,
      fearGreedIndex: data.fearGreedIndex,
      fearGreedLabel,
      regime,
      confidence,
      btcPrice: data.btcPrice,
      btcChange24h: data.btcChange24h,
      btcTrend,
    };

    // Persist
    if (this.col) {
      await this.col.insertOne(state);
    }

    this.currentState = state;
    return state;
  }

  /**
   * Get current macro state
   */
  getCurrent(): MacroState | null {
    return this.currentState;
  }

  /**
   * Get latest from DB
   */
  async getLatest(): Promise<MacroState | null> {
    if (!this.col) return this.currentState;
    const doc = await this.col.find({}).sort({ ts: -1 }).limit(1).next();
    if (doc) this.currentState = doc;
    return doc;
  }

  /**
   * Get history
   */
  async getHistory(limit = 100): Promise<MacroState[]> {
    if (!this.col) return [];
    return this.col.find({}, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  }

  // ═══════════════════════════════════════════════════════════════
  // CLASSIFICATION LOGIC
  // ═══════════════════════════════════════════════════════════════

  private classifyFearGreed(index: number): MacroState['fearGreedLabel'] {
    if (index <= FEAR_EXTREME) return 'EXTREME_FEAR';
    if (index <= FEAR_NORMAL) return 'FEAR';
    if (index >= GREED_EXTREME) return 'EXTREME_GREED';
    if (index >= GREED_NORMAL) return 'GREED';
    return 'NEUTRAL';
  }

  private classifyBtcTrend(change24h: number): 'UP' | 'DOWN' | 'SIDEWAYS' {
    if (change24h > 3) return 'UP';
    if (change24h < -3) return 'DOWN';
    return 'SIDEWAYS';
  }

  private classifyRegime(
    btcD: number,
    btcDDelta: number,
    ethD: number,
    fearGreed: number,
    btcTrend: 'UP' | 'DOWN' | 'SIDEWAYS'
  ): { regime: MacroRegime; confidence: number } {
    const signals: Array<{ regime: MacroRegime; weight: number }> = [];

    // Risk Off: High fear + BTC down
    if (fearGreed < FEAR_NORMAL && btcTrend === 'DOWN') {
      signals.push({ regime: 'RISK_OFF', weight: 1.2 });
    }

    // Risk On: High greed + BTC up
    if (fearGreed > GREED_NORMAL && btcTrend === 'UP') {
      signals.push({ regime: 'RISK_ON', weight: 1.2 });
    }

    // BTC Dominant: BTC.D high or rising fast
    if (btcD > BTC_D_HIGH || btcDDelta > BTC_D_DELTA_THRESHOLD) {
      signals.push({ regime: 'BTC_DOMINANT', weight: 1.0 + btcDDelta * 0.2 });
    }

    // Altseason: BTC.D low or falling fast
    if (btcD < BTC_D_LOW || btcDDelta < -BTC_D_DELTA_THRESHOLD) {
      signals.push({ regime: 'ALTSEASON', weight: 1.0 + Math.abs(btcDDelta) * 0.2 });
    }

    // ETH Rotation: ETH.D rising while BTC.D stable
    if (ethD > 18 && Math.abs(btcDDelta) < 0.5) {
      signals.push({ regime: 'ETH_ROTATION', weight: 0.8 });
    }

    // Default to transition if mixed
    if (signals.length === 0) {
      return { regime: 'TRANSITION', confidence: 0.5 };
    }

    // Pick highest weight
    signals.sort((a, b) => b.weight - a.weight);
    const top = signals[0];
    
    // Confidence based on weight dominance
    const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
    const confidence = Math.min(1, top.weight / totalWeight * 1.2);

    return { regime: top.regime, confidence };
  }

  /**
   * Check if cluster type is allowed in current regime
   */
  isClusterTypeAllowed(clusterType: string, regime?: MacroRegime): boolean {
    const currentRegime = regime ?? this.currentState?.regime ?? 'TRANSITION';
    
    // Simple mapping
    const blockedMap: Record<MacroRegime, string[]> = {
      BTC_DOMINANT: ['BREAKOUT', 'MOMENTUM'],
      RISK_OFF: ['BREAKOUT', 'MOMENTUM'],
      ETH_ROTATION: [],
      ALTSEASON: [],
      RISK_ON: [],
      TRANSITION: [],
    };

    return !blockedMap[currentRegime]?.includes(clusterType.toUpperCase());
  }
}

export const macroStateService = new MacroStateService();

console.log('[Macro] State Service loaded');
