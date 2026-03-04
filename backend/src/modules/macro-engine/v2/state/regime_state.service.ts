/**
 * REGIME STATE SERVICE — P1 Dynamic Macro State with Memory
 * 
 * Maintains regime as state machine, not point computation:
 * - Fetches previous state from MongoDB
 * - Updates via Markov transition + emissions
 * - Applies hysteresis (no regime flip-flopping)
 * - Stores new state
 */

import { MacroRegimeStateModel, IMacroRegimeState } from '../models/macro_state.model.js';
import { getMarkovEngine } from '../../../index-engine/services/macro_layer/macro_markov.service.js';
import { MacroRegime } from '../../interfaces/macro_engine.interface.js';

// ═══════════════════════════════════════════════════════════════
// HYSTERESIS CONFIG
// ═══════════════════════════════════════════════════════════════

const HYSTERESIS_CONFIG = {
  minDaysInRegime: 3,             // Minimum days before regime can change
  probThreshold: 0.15,            // Prob difference needed to switch
  maxChanges30D: 5,               // Max regime changes in 30 days
};

// ═══════════════════════════════════════════════════════════════
// REGIME STATE SERVICE
// ═══════════════════════════════════════════════════════════════

export class RegimeStateService {
  
  /**
   * Get current regime state from storage
   */
  async getCurrentState(symbol: string): Promise<IMacroRegimeState | null> {
    try {
      const state = await MacroRegimeStateModel
        .findOne({ symbol })
        .sort({ asOf: -1 })
        .lean();
      
      return state;
    } catch (e) {
      console.log('[RegimeState] Error fetching state:', (e as any).message);
      return null;
    }
  }
  
  /**
   * Update regime state with Markov + hysteresis
   */
  async updateState(params: {
    symbol: string;
    scoreVector: Record<string, number>;
    scoreSigned: number;
    confidence: number;
    rawRegime: MacroRegime;  // Regime from point computation
  }): Promise<IMacroRegimeState> {
    const now = new Date();
    const markovEngine = getMarkovEngine();
    
    // 1. Fetch previous state
    const prevState = await this.getCurrentState(params.symbol);
    
    // 2. Compute Markov state
    const markovState = markovEngine.getState(
      params.scoreVector,
      params.scoreSigned,
      params.confidence,
      prevState?.dominant as MacroRegime || params.rawRegime
    );
    
    // 3. Apply hysteresis
    const { finalRegime, regimeChanged } = this.applyHysteresis(
      prevState,
      markovState.regime,
      markovState.regimeProbabilities[markovState.regime],
      now
    );
    
    // 4. Compute entropy (regime uncertainty)
    const entropy = this.computeEntropy(markovState.regimeProbabilities as any);
    
    // 5. Count changes in last 30 days
    const changeCount30D = await this.countRecentChanges(params.symbol, 30);
    
    // 6. Create new state
    const newState = new MacroRegimeStateModel({
      symbol: params.symbol,
      asOf: now,
      
      dominant: finalRegime,
      probs: new Map(Object.entries(markovState.regimeProbabilities)),
      
      persistence: markovState.persistence,
      entropy,
      
      lastChangeAt: regimeChanged ? now : (prevState?.lastChangeAt || now),
      changeCount30D: regimeChanged ? changeCount30D + 1 : changeCount30D,
      
      scoreSigned: params.scoreSigned,
      confidence: params.confidence,
      transitionHint: markovState.transitionHint,
      
      sourceVersion: 'v2',
    });
    
    // 7. Save to MongoDB
    try {
      await newState.save();
      console.log(`[RegimeState] Updated ${params.symbol}: ${finalRegime} (changed: ${regimeChanged})`);
    } catch (e) {
      console.log('[RegimeState] Error saving state:', (e as any).message);
    }
    
    return newState;
  }
  
  /**
   * Apply hysteresis to prevent regime flip-flopping
   */
  private applyHysteresis(
    prevState: IMacroRegimeState | null,
    newRegime: MacroRegime,
    newProb: number,
    now: Date
  ): { finalRegime: MacroRegime; regimeChanged: boolean } {
    // No previous state — accept new regime
    if (!prevState) {
      return { finalRegime: newRegime, regimeChanged: true };
    }
    
    const prevRegime = prevState.dominant as MacroRegime;
    
    // Same regime — no change
    if (prevRegime === newRegime) {
      return { finalRegime: prevRegime, regimeChanged: false };
    }
    
    // Check minimum days in regime
    const daysSinceChange = prevState.lastChangeAt
      ? Math.floor((now.getTime() - prevState.lastChangeAt.getTime()) / (1000 * 60 * 60 * 24))
      : 999;
    
    if (daysSinceChange < HYSTERESIS_CONFIG.minDaysInRegime) {
      console.log(`[Hysteresis] Blocked: only ${daysSinceChange} days in ${prevRegime}`);
      return { finalRegime: prevRegime, regimeChanged: false };
    }
    
    // Check probability threshold
    const prevProb = prevState.probs?.get(prevRegime) || 0.5;
    const probDiff = newProb - prevProb;
    
    if (probDiff < HYSTERESIS_CONFIG.probThreshold) {
      console.log(`[Hysteresis] Blocked: prob diff ${probDiff.toFixed(2)} < threshold`);
      return { finalRegime: prevRegime, regimeChanged: false };
    }
    
    // Check max changes
    if ((prevState.changeCount30D || 0) >= HYSTERESIS_CONFIG.maxChanges30D) {
      console.log(`[Hysteresis] Blocked: too many changes (${prevState.changeCount30D})`);
      return { finalRegime: prevRegime, regimeChanged: false };
    }
    
    // All checks passed — allow regime change
    return { finalRegime: newRegime, regimeChanged: true };
  }
  
  /**
   * Compute entropy (regime uncertainty)
   */
  private computeEntropy(probs: Record<string, number>): number {
    const values = Object.values(probs).filter(p => p > 0);
    if (values.length === 0) return 0;
    
    // Shannon entropy normalized to [0, 1]
    const entropy = -values.reduce((sum, p) => sum + p * Math.log2(p), 0);
    const maxEntropy = Math.log2(values.length);
    
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }
  
  /**
   * Count regime changes in recent days
   */
  private async countRecentChanges(symbol: string, days: number): Promise<number> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      
      const states = await MacroRegimeStateModel
        .find({ symbol, asOf: { $gte: cutoff } })
        .sort({ asOf: 1 })
        .select('dominant')
        .lean();
      
      let changes = 0;
      for (let i = 1; i < states.length; i++) {
        if (states[i].dominant !== states[i - 1].dominant) {
          changes++;
        }
      }
      
      return changes;
    } catch (e) {
      return 0;
    }
  }
  
  /**
   * Get regime history
   */
  async getHistory(symbol: string, limit: number = 30): Promise<IMacroRegimeState[]> {
    try {
      return await MacroRegimeStateModel
        .find({ symbol })
        .sort({ asOf: -1 })
        .limit(limit)
        .lean();
    } catch (e) {
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: RegimeStateService | null = null;

export function getRegimeStateService(): RegimeStateService {
  if (!instance) {
    instance = new RegimeStateService();
  }
  return instance;
}
