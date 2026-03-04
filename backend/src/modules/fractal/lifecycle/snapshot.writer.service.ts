/**
 * BLOCK 56.2 — Signal Snapshot Writer Service
 * 
 * Writes daily signal snapshots for ACTIVE + SHADOW models.
 * Key principles:
 * - Write once, never mutate
 * - Idempotent (skip if exists)
 * - Forward only (no backfill)
 * - Per-preset snapshots (Conservative, Balanced, Aggressive)
 */

import { SignalSnapshotModel, type SignalSnapshotDocument } from '../storage/signal-snapshot.schema.js';
import { CanonicalStore } from '../data/canonical.store.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PresetKey = 'Conservative' | 'Balanced' | 'Aggressive';

interface SignalData {
  version: string;
  action: 'LONG' | 'SHORT' | 'HOLD';
  confidence: number;
  reliability: number;
  entropy: number;
  expectedReturn: number;
  tailRiskP95dd: number;
  regime: string;
  sizeMultiplier: number;
  dominantHorizon: '7d' | '14d' | '30d';
}

interface SnapshotWriteItem {
  preset: PresetKey;
  status: 'written' | 'skipped';
  reason?: string;
}

export interface SnapshotWriteResult {
  asofDate: string;
  symbol: string;
  written: number;
  skipped: number;
  items: SnapshotWriteItem[];
}

interface SnapshotDocument {
  asofDate: string;
  symbol: string;
  preset: PresetKey;
  
  active: SignalData;
  shadow: SignalData;
  
  meta: {
    source: string;
    tf: string;
    horizons: string[];
    windowLen: number;
  };
  
  resolved: boolean;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const ACTIVE_VERSION = 'v2.1-frozen-7-14-30-2026';
const SHADOW_VERSION = 'v2.1-shadow-001'; // Same as active for now, will differ later

const PRESETS: PresetKey[] = ['Conservative', 'Balanced', 'Aggressive'];

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class SnapshotWriterService {
  private canonicalStore = new CanonicalStore();
  
  /**
   * Get the latest daily candle date (asofDate)
   */
  async getLatestAsofDate(symbol: string): Promise<string> {
    const latestTs = await this.canonicalStore.getLatestTs(symbol, '1d');
    if (!latestTs) {
      throw new Error(`No candle data for ${symbol}`);
    }
    return latestTs.toISOString().slice(0, 10);
  }
  
  /**
   * Fetch signal from Fractal API
   */
  async fetchSignal(symbol: string, preset: PresetKey): Promise<SignalData> {
    try {
      const signalUrl = `http://localhost:8002/api/fractal/v2.1/signal?symbol=${symbol}`;
      const response = await fetch(signalUrl);
      
      if (!response.ok) {
        console.warn(`[SnapshotWriter] Signal fetch failed: ${response.status}`);
        return this.getDefaultSignal();
      }
      
      const data = await response.json();
      
      // Extract signal data
      const assembled = data.assembled || {};
      const risk = data.risk || {};
      const meta = data.meta || {};
      
      // Determine action from dominant horizon
      let action: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
      const expectedReturn = assembled.expectedReturn ?? 0;
      if (expectedReturn > 0.02) action = 'LONG';
      else if (expectedReturn < -0.02) action = 'SHORT';
      
      // Determine dominant horizon
      let dominantHorizon: '7d' | '14d' | '30d' = '30d';
      const horizons = data.signalsByHorizon || {};
      let maxConf = 0;
      for (const [h, sig] of Object.entries(horizons) as [string, any][]) {
        if (sig?.confidence > maxConf) {
          maxConf = sig.confidence;
          dominantHorizon = h as '7d' | '14d' | '30d';
        }
      }
      
      return {
        version: ACTIVE_VERSION,
        action,
        confidence: assembled.confidence ?? 0.01,
        reliability: data.reliability?.score ?? 0.70,
        entropy: assembled.entropy ?? 0.90,
        expectedReturn: assembled.expectedReturn ?? 0,
        tailRiskP95dd: risk.mcP95_DD ?? 0.50,
        regime: meta.phase ?? 'UNKNOWN',
        sizeMultiplier: assembled.sizeMultiplier ?? 0.25,
        dominantHorizon
      };
    } catch (err) {
      console.error(`[SnapshotWriter] Signal fetch error:`, err);
      return this.getDefaultSignal();
    }
  }
  
  /**
   * Get default signal when API fails
   */
  private getDefaultSignal(): SignalData {
    return {
      version: ACTIVE_VERSION,
      action: 'HOLD',
      confidence: 0.01,
      reliability: 0.50,
      entropy: 0.95,
      expectedReturn: 0,
      tailRiskP95dd: 0.50,
      regime: 'UNKNOWN',
      sizeMultiplier: 0,
      dominantHorizon: '30d'
    };
  }
  
  /**
   * Generate shadow signal (currently same as active, will differ later)
   */
  generateShadowSignal(active: SignalData): SignalData {
    // For now, shadow = active with different version tag
    // Later: apply different parameters
    return {
      ...active,
      version: SHADOW_VERSION
    };
  }
  
  /**
   * Check if snapshot exists for given date/symbol/preset
   */
  async snapshotExists(asofDate: string, symbol: string, preset: PresetKey): Promise<boolean> {
    const count = await SignalSnapshotModel.countDocuments({
      symbol,
      asOf: new Date(asofDate),
      'strategy.preset': preset.toUpperCase()
    });
    return count > 0;
  }
  
  /**
   * Write snapshot for a single preset
   */
  async writePresetSnapshot(
    asofDate: string,
    symbol: string,
    preset: PresetKey,
    active: SignalData,
    shadow: SignalData
  ): Promise<SnapshotWriteItem> {
    // Idempotency check
    const exists = await this.snapshotExists(asofDate, symbol, preset);
    if (exists) {
      return {
        preset,
        status: 'skipped',
        reason: 'already_exists'
      };
    }
    
    // Create snapshot document
    const doc: Partial<SignalSnapshotDocument> = {
      symbol,
      asOf: new Date(asofDate),
      timeframe: '1D',
      version: active.version,
      modelId: `${active.version}-${preset.toLowerCase()}`,
      modelType: 'ACTIVE',
      
      action: active.action,
      dominantHorizon: parseInt(active.dominantHorizon) as 7 | 14 | 30,
      expectedReturn: active.expectedReturn,
      confidence: active.confidence,
      reliability: active.reliability,
      entropy: active.entropy,
      stability: 0.80, // Placeholder
      
      risk: {
        maxDD_WF: 0.08,
        mcP95_DD: active.tailRiskP95dd,
        softStop: -0.05
      },
      
      strategy: {
        preset: preset.toUpperCase() as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
        minConf: preset === 'Conservative' ? 0.10 : preset === 'Balanced' ? 0.05 : 0.02,
        maxEntropy: preset === 'Conservative' ? 0.40 : preset === 'Balanced' ? 0.60 : 0.80,
        maxTail: preset === 'Conservative' ? 0.45 : preset === 'Balanced' ? 0.55 : 0.65,
        positionSize: active.sizeMultiplier,
        mode: active.action === 'HOLD' ? 'NO_TRADE' : 'ENTER',
        edgeScore: Math.round(active.confidence * active.reliability * (1 - active.entropy) * 100)
      },
      
      metrics: {
        similarityMean: 0,
        effectiveN: 0,
        matchCount: 0
      },
      
      governance: {
        guardMode: 'NORMAL',
        healthStatus: 'HEALTHY'
      },
      
      source: 'LIVE',
      createdAt: new Date()
    };
    
    await SignalSnapshotModel.create(doc);
    
    // Also write shadow version
    const shadowDoc: Partial<SignalSnapshotDocument> = {
      ...doc,
      version: shadow.version,
      modelId: `${shadow.version}-${preset.toLowerCase()}`,
      modelType: 'SHADOW',
      confidence: shadow.confidence,
      reliability: shadow.reliability,
      entropy: shadow.entropy,
      expectedReturn: shadow.expectedReturn
    };
    
    await SignalSnapshotModel.create(shadowDoc);
    
    return {
      preset,
      status: 'written'
    };
  }
  
  /**
   * Write snapshots for all presets (main entry point)
   */
  async writeBtcSnapshots(asofDateOverride?: string): Promise<SnapshotWriteResult> {
    const symbol = 'BTC';
    
    // Get asofDate from latest candle
    const asofDate = asofDateOverride || await this.getLatestAsofDate(symbol);
    
    console.log(`[SnapshotWriter] Writing BTC snapshots for ${asofDate}`);
    
    const items: SnapshotWriteItem[] = [];
    let written = 0;
    let skipped = 0;
    
    for (const preset of PRESETS) {
      // Fetch signal (same for all presets, but strategy differs)
      const active = await this.fetchSignal(symbol, preset);
      const shadow = this.generateShadowSignal(active);
      
      const item = await this.writePresetSnapshot(asofDate, symbol, preset, active, shadow);
      items.push(item);
      
      if (item.status === 'written') written++;
      else skipped++;
    }
    
    console.log(`[SnapshotWriter] Done: written=${written}, skipped=${skipped}`);
    
    return {
      asofDate,
      symbol,
      written,
      skipped,
      items
    };
  }
  
  /**
   * Get latest snapshot for symbol
   */
  async getLatestSnapshot(symbol: string): Promise<SignalSnapshotDocument | null> {
    return SignalSnapshotModel.findOne({
      symbol,
      modelType: 'ACTIVE'
    }).sort({ asOf: -1 }).lean();
  }
  
  /**
   * Get snapshots in date range
   */
  async getSnapshotsRange(
    symbol: string,
    from: string,
    to: string
  ): Promise<SignalSnapshotDocument[]> {
    return SignalSnapshotModel.find({
      symbol,
      modelType: 'ACTIVE',
      asOf: {
        $gte: new Date(from),
        $lte: new Date(to)
      }
    }).sort({ asOf: 1 }).lean();
  }
  
  /**
   * Count snapshots for symbol
   */
  async countSnapshots(symbol: string): Promise<{ active: number; shadow: number }> {
    const active = await SignalSnapshotModel.countDocuments({ symbol, modelType: 'ACTIVE' });
    const shadow = await SignalSnapshotModel.countDocuments({ symbol, modelType: 'SHADOW' });
    return { active, shadow };
  }
}

// Export singleton
export const snapshotWriterService = new SnapshotWriterService();
