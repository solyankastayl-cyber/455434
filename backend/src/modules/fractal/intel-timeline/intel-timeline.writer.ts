/**
 * BLOCK 82 — Intel Timeline Writer Service
 * 
 * Idempotent upsert for daily phase strength + dominance snapshots.
 * Called from daily-run pipeline after DRIFT_INTELLIGENCE_WRITE.
 */

import { IntelTimelineModel } from './intel-timeline.model.js';
import type {
  IntelTimelineWriteInput,
  IntelTimelineSource,
  DominanceTier,
  PhaseGrade,
  PhaseType,
  VolRegime,
  DivergenceGrade,
} from './intel-timeline.types.js';

// ═══════════════════════════════════════════════════════════════
// WRITER SERVICE
// ═══════════════════════════════════════════════════════════════

class IntelTimelineWriterService {
  
  /**
   * Write or update a single intel timeline snapshot (idempotent upsert)
   */
  async writeSnapshot(input: IntelTimelineWriteInput): Promise<{ ok: boolean; upserted: boolean; date: string }> {
    const date = input.date || new Date().toISOString().split('T')[0];
    
    const doc = {
      date,
      symbol: input.symbol || 'BTC',
      source: input.source,
      
      // Phase
      phaseType: input.phaseType,
      phaseGrade: input.phaseGrade,
      phaseScore: input.phaseScore,
      phaseSharpe: input.phaseSharpe,
      phaseHitRate: input.phaseHitRate,
      phaseExpectancy: input.phaseExpectancy,
      phaseSamples: input.phaseSamples,
      
      // Dominance
      dominanceTier: input.dominanceTier,
      structuralLock: input.structuralLock,
      timingOverrideBlocked: input.timingOverrideBlocked,
      tierWeights: input.tierWeights,
      
      // Context
      volRegime: input.volRegime,
      divergenceGrade: input.divergenceGrade,
      divergenceScore: input.divergenceScore,
      
      // Decision
      finalAction: input.finalAction,
      finalSize: input.finalSize,
      consensusIndex: input.consensusIndex,
      conflictLevel: input.conflictLevel,
      
      // Meta
      engineVersion: input.engineVersion || 'v2.1.0',
      policyHash: input.policyHash || '',
    };
    
    const result = await IntelTimelineModel.updateOne(
      { date, symbol: input.symbol || 'BTC', source: input.source },
      { $set: doc },
      { upsert: true }
    );
    
    console.log(`[IntelTimeline] Written ${input.source} snapshot for ${date}: upserted=${result.upsertedCount > 0}`);
    
    return {
      ok: true,
      upserted: result.upsertedCount > 0,
      date,
    };
  }
  
  /**
   * Write LIVE snapshot from daily-run context
   * Extracts data from decision kernel / phase scoring / dominance rule
   */
  async writeLiveSnapshot(params: {
    symbol?: string;
    phaseType?: PhaseType;
    phaseGrade?: PhaseGrade;
    phaseScore?: number;
    phaseSharpe?: number;
    phaseHitRate?: number;
    phaseExpectancy?: number;
    phaseSamples?: number;
    dominanceTier?: DominanceTier;
    structuralLock?: boolean;
    timingOverrideBlocked?: boolean;
    tierWeights?: { structure: number; tactical: number; timing: number };
    volRegime?: VolRegime;
    divergenceGrade?: DivergenceGrade;
    divergenceScore?: number;
    finalAction?: string;
    finalSize?: number;
    consensusIndex?: number;
    conflictLevel?: string;
    engineVersion?: string;
    policyHash?: string;
  }): Promise<{ ok: boolean; upserted: boolean; date: string }> {
    return this.writeSnapshot({
      symbol: params.symbol || 'BTC',
      source: 'LIVE',
      phaseType: params.phaseType || 'NEUTRAL',
      phaseGrade: params.phaseGrade || 'C',
      phaseScore: params.phaseScore ?? 50,
      phaseSharpe: params.phaseSharpe ?? 0,
      phaseHitRate: params.phaseHitRate ?? 0.5,
      phaseExpectancy: params.phaseExpectancy ?? 0,
      phaseSamples: params.phaseSamples ?? 0,
      dominanceTier: params.dominanceTier || 'STRUCTURE',
      structuralLock: params.structuralLock ?? false,
      timingOverrideBlocked: params.timingOverrideBlocked ?? false,
      tierWeights: params.tierWeights || { structure: 0.5, tactical: 0.3, timing: 0.2 },
      volRegime: params.volRegime || 'NORMAL',
      divergenceGrade: params.divergenceGrade || 'C',
      divergenceScore: params.divergenceScore ?? 50,
      finalAction: params.finalAction || 'HOLD',
      finalSize: params.finalSize ?? 0,
      consensusIndex: params.consensusIndex ?? 50,
      conflictLevel: params.conflictLevel || 'LOW',
      engineVersion: params.engineVersion,
      policyHash: params.policyHash,
    });
  }
  
  /**
   * Batch write for backfill (V2014/V2020)
   */
  async batchWrite(
    snapshots: IntelTimelineWriteInput[]
  ): Promise<{ ok: boolean; written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;
    
    for (const snapshot of snapshots) {
      try {
        const result = await this.writeSnapshot(snapshot);
        if (result.upserted) {
          written++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`[IntelTimeline] Error writing snapshot:`, err);
        skipped++;
      }
    }
    
    return { ok: true, written, skipped };
  }
}

export const intelTimelineWriterService = new IntelTimelineWriterService();
export default intelTimelineWriterService;
