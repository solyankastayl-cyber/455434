/**
 * SPX MEMORY LAYER — Snapshot Writer
 * 
 * BLOCK B6.1 — Write snapshots from SPX terminal
 * 
 * Fetches terminal data and writes idempotent snapshots.
 */

import type { FastifyInstance } from 'fastify';
import { SpxSnapshotModel } from './spx-snapshot.model.js';
import type { 
  SpxSnapshotWriteInput, 
  SpxHorizon, 
  Tier,
  SpxSnapshotDoc 
} from './spx-memory.types.js';
import { HORIZON_TO_TIER } from './spx-memory.types.js';

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT WRITER CLASS
// ═══════════════════════════════════════════════════════════════

export class SpxMemoryWriter {
  constructor(private app: FastifyInstance) {}

  /**
   * Write snapshots for all specified horizons
   */
  async writeSnapshots(input: SpxSnapshotWriteInput) {
    const { asOfDate, source, preset, horizons, policyHash, engineVersion, dryRun } = input;

    const written: { horizon: SpxHorizon; tier: Tier; ok: boolean; error?: string }[] = [];

    for (const horizon of horizons) {
      try {
        // Fetch terminal data using internal API
        const terminal = await this.app.inject({
          method: 'GET',
          url: `/api/spx/v2.1/focus-pack?symbol=SPX&focus=${horizon}`,
        });

        if (terminal.statusCode !== 200) {
          written.push({ 
            horizon, 
            tier: HORIZON_TO_TIER[horizon], 
            ok: false, 
            error: `Terminal failed: ${terminal.statusCode}` 
          });
          continue;
        }

        const payload = terminal.json() as any;
        
        if (!payload.ok) {
          written.push({ 
            horizon, 
            tier: HORIZON_TO_TIER[horizon], 
            ok: false, 
            error: payload.error || 'Terminal returned ok=false' 
          });
          continue;
        }

        const data = payload.data;

        // Extract decision/consensus info
        const phase = data?.phase || {};
        const divergence = data?.divergence || {};
        const overlay = data?.overlay || {};
        const primarySelection = data?.primarySelection || {};

        // Build snapshot document
        const doc: Partial<SpxSnapshotDoc> = {
          symbol: 'SPX',
          asOfDate,
          source,
          preset,
          horizon,
          tier: HORIZON_TO_TIER[horizon],

          // Direction from primary selection or phase
          direction: primarySelection?.primaryMatch?.direction || 
                     (overlay?.stats?.medianReturn > 0 ? 'BULL' : 
                      overlay?.stats?.medianReturn < 0 ? 'BEAR' : 'NEUTRAL'),
          
          // Action derived from direction + confidence
          action: this.deriveAction(overlay?.stats?.medianReturn, overlay?.stats?.hitRate),

          consensusIndex: Math.round((overlay?.stats?.hitRate || 0.5) * 100),
          conflictLevel: 'LOW', // Will be enhanced when consensus engine is integrated
          structuralLock: false,

          sizeMultiplier: this.deriveSizeMultiplier(divergence?.grade, overlay?.stats?.hitRate),
          confidence: Math.round((overlay?.stats?.hitRate || 0.5) * 100),

          phaseType: phase?.phase,
          phaseGrade: phase?.grade,
          divergenceScore: divergence?.score,
          divergenceGrade: divergence?.grade || 'NA',

          primaryMatchId: primarySelection?.primaryMatch?.id,
          matchesCount: overlay?.matches?.length || 0,

          policyHash,
          engineVersion,
        };

        if (!dryRun) {
          await SpxSnapshotModel.updateOne(
            { symbol: 'SPX', asOfDate, source, preset, horizon },
            { $set: doc },
            { upsert: true }
          );
        }

        written.push({ horizon, tier: HORIZON_TO_TIER[horizon], ok: true });
        
      } catch (error: any) {
        written.push({ 
          horizon, 
          tier: HORIZON_TO_TIER[horizon], 
          ok: false, 
          error: error.message 
        });
      }
    }

    return { 
      ok: true, 
      writtenCount: written.filter(w => w.ok).length, 
      totalRequested: horizons.length,
      written 
    };
  }

  /**
   * Derive action from median return and hit rate
   */
  private deriveAction(medianReturn?: number, hitRate?: number): 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE' {
    if (medianReturn == null || hitRate == null) return 'HOLD';
    
    if (hitRate < 0.4) return 'NO_TRADE';
    if (medianReturn > 0.02 && hitRate > 0.55) return 'BUY';
    if (medianReturn < -0.02 && hitRate < 0.45) return 'SELL';
    return 'HOLD';
  }

  /**
   * Derive size multiplier from divergence grade and hit rate
   */
  private deriveSizeMultiplier(grade?: string, hitRate?: number): number {
    let size = 1.0;
    
    // Divergence grade penalty
    switch (grade) {
      case 'A': size *= 1.05; break;
      case 'B': size *= 1.0; break;
      case 'C': size *= 0.9; break;
      case 'D': size *= 0.75; break;
      case 'F': size *= 0.5; break;
    }
    
    // Hit rate penalty
    if (hitRate != null) {
      if (hitRate < 0.4) size *= 0.5;
      else if (hitRate < 0.5) size *= 0.75;
    }
    
    return Math.round(size * 100) / 100;
  }
}

export default SpxMemoryWriter;
