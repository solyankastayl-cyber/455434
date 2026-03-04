/**
 * P10.1 — Regime Memory Service
 * 
 * Tracks duration and stability of regimes across scopes.
 * Key operations:
 * - updateFromWorldState(asOf): compute and store current regime state
 * - getCurrent(asOf): get regime memory pack for date
 * - getTimeline(start, end, stepDays): historical regime memory
 * 
 * CRITICAL: asOf-safe, deterministic, no lookahead
 */

import * as crypto from 'crypto';
import { 
  RegimeScope, 
  RegimeMemoryState, 
  RegimeMemoryPack, 
  RegimeTimelinePack,
  RegimeTimelinePoint,
  computeStability,
  STABILITY_PARAMS,
} from '../contracts/regime_memory.contract.js';
import { RegimeMemoryModel, RegimeHistoryModel, IRegimeMemoryDoc } from '../models/regime_memory.model.js';
import { getWorldStateService } from './world_state.service.js';

export class RegimeMemoryService {

  // ═══════════════════════════════════════════════════════════════
  // GET CURRENT REGIME MEMORY PACK
  // ═══════════════════════════════════════════════════════════════

  async getCurrent(asOf?: string): Promise<RegimeMemoryPack> {
    const targetDate = asOf || new Date().toISOString().split('T')[0];
    
    // First, ensure state is computed for this date
    await this.updateFromWorldState(targetDate);
    
    // Fetch all scopes
    const [macroDoc, guardDoc, crossAssetDoc] = await Promise.all([
      RegimeMemoryModel.findOne({ scope: 'macro' }),
      RegimeMemoryModel.findOne({ scope: 'guard' }),
      RegimeMemoryModel.findOne({ scope: 'crossAsset' }),
    ]);

    const macro = this.docToState(macroDoc, 'macro', targetDate);
    const guard = this.docToState(guardDoc, 'guard', targetDate);
    const crossAsset = this.docToState(crossAssetDoc, 'crossAsset', targetDate);

    const inputsHash = this.computePackHash(macro, guard, crossAsset);

    return {
      asOf: targetDate,
      macro,
      guard,
      crossAsset,
      meta: {
        generatedAt: new Date().toISOString(),
        inputsHash,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE FROM WORLD STATE (main entry point)
  // ═══════════════════════════════════════════════════════════════

  async updateFromWorldState(asOf: string): Promise<void> {
    console.log(`[RegimeMemory] Updating state for asOf=${asOf}`);

    // Get world state (asOf-safe)
    const worldState = await getWorldStateService().buildWorldState(asOf);

    // Extract current regime values from world state
    const macroValue = this.extractMacroRegime(worldState);
    const guardValue = this.extractGuardLevel(worldState);
    const crossAssetValue = this.extractCrossAssetRegime(worldState);

    // Update each scope
    await Promise.all([
      this.updateScope('macro', macroValue, asOf),
      this.updateScope('guard', guardValue, asOf),
      this.updateScope('crossAsset', crossAssetValue, asOf),
    ]);

    console.log(`[RegimeMemory] Updated: macro=${macroValue}, guard=${guardValue}, crossAsset=${crossAssetValue}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE SINGLE SCOPE
  // ═══════════════════════════════════════════════════════════════

  private async updateScope(scope: RegimeScope, newValue: string, asOf: string): Promise<void> {
    const asOfDate = new Date(asOf);
    const inputHash = crypto.createHash('sha256')
      .update(`${scope}:${newValue}:${asOf}`)
      .digest('hex').slice(0, 16);

    // Record in history (for flip counting)
    await RegimeHistoryModel.updateOne(
      { scope, date: asOfDate },
      { $set: { value: newValue, inputHash } },
      { upsert: true }
    );

    // Get current state
    let doc = await RegimeMemoryModel.findOne({ scope });

    if (!doc) {
      // First time: initialize
      doc = new RegimeMemoryModel({
        scope,
        current: newValue,
        since: asOfDate,
        daysInState: 0,
        flips30d: 0,
        stability: 0.5,
        lastUpdated: asOfDate,
        previousStates: [],
        lastInputHash: inputHash,
      });
      await doc.save();
      return;
    }

    // Check if regime changed
    if (doc.current !== newValue) {
      // REGIME FLIP: record transition
      const daysInPrevious = this.daysBetween(doc.since, asOfDate);
      
      const transition = {
        value: doc.current,
        since: doc.since,
        until: asOfDate,
        days: daysInPrevious,
      };

      // Keep last 5 transitions
      const newPreviousStates = [transition, ...(doc.previousStates || [])].slice(0, 5);

      doc.current = newValue;
      doc.since = asOfDate;
      doc.daysInState = 0;
      doc.previousStates = newPreviousStates;
    } else {
      // Same regime: calculate days from since to asOf
      // Only update since if asOf is earlier (backfill scenario)
      if (asOfDate < doc.since) {
        doc.since = asOfDate;
      }
      doc.daysInState = this.daysBetween(doc.since, asOfDate);
    }

    // Count flips in last 30 days
    const flips30d = await this.countFlips(scope, asOf, STABILITY_PARAMS.FLIP_LOOKBACK_DAYS);
    doc.flips30d = flips30d;

    // Compute stability
    doc.stability = computeStability(doc.daysInState, flips30d);

    doc.lastUpdated = asOfDate;
    doc.lastInputHash = inputHash;

    await doc.save();
  }

  // ═══════════════════════════════════════════════════════════════
  // COUNT FLIPS IN LOOKBACK PERIOD
  // ═══════════════════════════════════════════════════════════════

  private async countFlips(scope: RegimeScope, asOf: string, lookbackDays: number): Promise<number> {
    const endDate = new Date(asOf);
    const startDate = new Date(asOf);
    startDate.setDate(startDate.getDate() - lookbackDays);

    const history = await RegimeHistoryModel.find({
      scope,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    if (history.length < 2) return 0;

    let flips = 0;
    for (let i = 1; i < history.length; i++) {
      if (history[i].value !== history[i - 1].value) {
        flips++;
      }
    }

    return flips;
  }

  // ═══════════════════════════════════════════════════════════════
  // GET TIMELINE
  // ═══════════════════════════════════════════════════════════════

  async getTimeline(start: string, end: string, stepDays: number = 7): Promise<RegimeTimelinePack> {
    const points: RegimeTimelinePoint[] = [];
    const dates = this.generateDates(start, end, stepDays);

    // Limit to 100 points max for performance
    const limitedDates = dates.slice(0, 100);
    if (dates.length > 100) {
      console.warn(`[RegimeMemory] Timeline limited to 100 points (requested ${dates.length})`);
    }

    let macroFlips = 0, guardFlips = 0, crossAssetFlips = 0;
    let macroStabilitySum = 0, guardStabilitySum = 0, crossAssetStabilitySum = 0;
    const macroValues: string[] = [];
    const guardValues: string[] = [];
    const crossAssetValues: string[] = [];

    // Batch fetch history for efficiency
    const startDate = new Date(start);
    const endDate = new Date(end);
    const historyMap = new Map<string, { macro?: string; guard?: string; crossAsset?: string }>();
    
    const allHistory = await RegimeHistoryModel.find({
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 }).lean();
    
    for (const h of allHistory) {
      const dateKey = h.date.toISOString().split('T')[0];
      if (!historyMap.has(dateKey)) {
        historyMap.set(dateKey, {});
      }
      historyMap.get(dateKey)![h.scope as RegimeScope] = h.value;
    }

    // Get current state for since dates
    const [macroDoc, guardDoc, crossAssetDoc] = await Promise.all([
      RegimeMemoryModel.findOne({ scope: 'macro' }).lean(),
      RegimeMemoryModel.findOne({ scope: 'guard' }).lean(),
      RegimeMemoryModel.findOne({ scope: 'crossAsset' }).lean(),
    ]);

    const sinceMap = {
      macro: macroDoc?.since ? new Date(macroDoc.since) : new Date(start),
      guard: guardDoc?.since ? new Date(guardDoc.since) : new Date(start),
      crossAsset: crossAssetDoc?.since ? new Date(crossAssetDoc.since) : new Date(start),
    };

    for (let i = 0; i < limitedDates.length; i++) {
      const asOf = limitedDates[i];
      const asOfDate = new Date(asOf);
      
      // Get values from history map or use defaults
      const entry = historyMap.get(asOf) || {};
      const macroVal = entry.macro || 'NEUTRAL';
      const guardVal = entry.guard || 'NONE';
      const crossAssetVal = entry.crossAsset || 'MIXED';

      // Calculate days and stability
      const macroDays = Math.max(0, this.daysBetween(sinceMap.macro, asOfDate));
      const guardDays = Math.max(0, this.daysBetween(sinceMap.guard, asOfDate));
      const crossAssetDays = Math.max(0, this.daysBetween(sinceMap.crossAsset, asOfDate));

      // Approximate flips (from history)
      const macroFlips30d = await this.countFlips('macro', asOf, 30);
      const guardFlips30d = await this.countFlips('guard', asOf, 30);
      const crossAssetFlips30d = await this.countFlips('crossAsset', asOf, 30);

      points.push({
        asOf,
        macro: { 
          value: macroVal, 
          daysInState: macroDays, 
          stability: computeStability(macroDays, macroFlips30d)
        },
        guard: { 
          value: guardVal, 
          daysInState: guardDays, 
          stability: computeStability(guardDays, guardFlips30d)
        },
        crossAsset: { 
          value: crossAssetVal, 
          daysInState: crossAssetDays, 
          stability: computeStability(crossAssetDays, crossAssetFlips30d)
        },
      });

      macroStabilitySum += computeStability(macroDays, macroFlips30d);
      guardStabilitySum += computeStability(guardDays, guardFlips30d);
      crossAssetStabilitySum += computeStability(crossAssetDays, crossAssetFlips30d);

      macroValues.push(macroVal);
      guardValues.push(guardVal);
      crossAssetValues.push(crossAssetVal);

      // Count flips from previous point
      if (i > 0) {
        if (macroValues[i] !== macroValues[i - 1]) macroFlips++;
        if (guardValues[i] !== guardValues[i - 1]) guardFlips++;
        if (crossAssetValues[i] !== crossAssetValues[i - 1]) crossAssetFlips++;
      }
    }

    const n = points.length || 1;

    return {
      start,
      end,
      stepDays,
      points,
      summary: {
        macroFlips,
        guardFlips,
        crossAssetFlips,
        avgMacroStability: round3(macroStabilitySum / n),
        avgGuardStability: round3(guardStabilitySum / n),
        avgCrossAssetStability: round3(crossAssetStabilitySum / n),
        dominantMacro: this.getDominant(macroValues),
        dominantGuard: this.getDominant(guardValues),
        dominantCrossAsset: this.getDominant(crossAssetValues),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // RECOMPUTE (admin, full rebuild)
  // ═══════════════════════════════════════════════════════════════

  async recompute(start: string, end: string, stepDays: number = 1): Promise<{ processed: number; errors: number }> {
    console.log(`[RegimeMemory] RECOMPUTE: ${start} → ${end}, step=${stepDays}d`);
    
    // Clear existing data
    await RegimeHistoryModel.deleteMany({
      date: { $gte: new Date(start), $lte: new Date(end) }
    });
    
    // Clear memory state to rebuild from scratch
    await RegimeMemoryModel.deleteMany({});

    const dates = this.generateDates(start, end, stepDays);
    let processed = 0;
    let errors = 0;

    for (const asOf of dates) {
      try {
        await this.updateFromWorldState(asOf);
        processed++;
        if (processed % 30 === 0) {
          console.log(`[RegimeMemory] Processed ${processed}/${dates.length}`);
        }
      } catch (e) {
        console.warn(`[RegimeMemory] Error at ${asOf}:`, (e as Error).message);
        errors++;
      }
    }

    console.log(`[RegimeMemory] RECOMPUTE complete: ${processed} processed, ${errors} errors`);
    return { processed, errors };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private extractMacroRegime(worldState: any): string {
    // Priority: DXY macro regime > AE regime > NEUTRAL
    const dxyRegime = worldState.assets?.dxy?.macroV2?.regime?.name;
    if (dxyRegime && dxyRegime !== 'UNKNOWN') return dxyRegime;

    const aeRegime = worldState.assets?.dxy?.ae?.regime;
    if (aeRegime) return aeRegime;

    return 'NEUTRAL';
  }

  private extractGuardLevel(worldState: any): string {
    const guard = worldState.assets?.dxy?.guard?.level;
    if (guard) return guard;
    return 'NONE';
  }

  private extractCrossAssetRegime(worldState: any): string {
    const crossAsset = worldState.crossAsset?.regime?.label;
    if (crossAsset) return crossAsset;
    return 'MIXED';
  }

  private docToState(doc: IRegimeMemoryDoc | null, scope: RegimeScope, asOf: string): RegimeMemoryState {
    if (!doc) {
      return {
        scope,
        current: scope === 'guard' ? 'NONE' : (scope === 'crossAsset' ? 'MIXED' : 'NEUTRAL'),
        since: asOf,
        daysInState: 0,
        flips30d: 0,
        stability: 0.5,
        lastUpdated: asOf,
        previousStates: [],
      };
    }

    return {
      scope,
      current: doc.current,
      since: doc.since.toISOString().split('T')[0],
      daysInState: doc.daysInState,
      flips30d: doc.flips30d,
      stability: doc.stability,
      lastUpdated: doc.lastUpdated.toISOString(),
      previousStates: (doc.previousStates || []).map(p => ({
        value: p.value,
        since: p.since.toISOString().split('T')[0],
        until: p.until.toISOString().split('T')[0],
        days: p.days,
      })),
    };
  }

  private daysBetween(start: Date, end: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((end.getTime() - start.getTime()) / msPerDay);
  }

  private generateDates(start: string, end: string, stepDays: number): string[] {
    const dates: string[] = [];
    let current = new Date(start);
    const endDate = new Date(end);
    
    while (current <= endDate && dates.length < 500) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + stepDays);
    }
    
    return dates;
  }

  private getDominant(values: string[]): string {
    const counts: Record<string, number> = {};
    for (const v of values) {
      counts[v] = (counts[v] || 0) + 1;
    }
    
    let best = values[0] || 'UNKNOWN';
    let bestCount = 0;
    for (const [v, c] of Object.entries(counts)) {
      if (c > bestCount) {
        best = v;
        bestCount = c;
      }
    }
    return best;
  }

  private computePackHash(macro: RegimeMemoryState, guard: RegimeMemoryState, crossAsset: RegimeMemoryState): string {
    const data = JSON.stringify({
      m: macro.current,
      md: macro.daysInState,
      g: guard.current,
      gd: guard.daysInState,
      c: crossAsset.current,
      cd: crossAsset.daysInState,
    });
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// Singleton
let instance: RegimeMemoryService | null = null;

export function getRegimeMemoryService(): RegimeMemoryService {
  if (!instance) {
    instance = new RegimeMemoryService();
  }
  return instance;
}
