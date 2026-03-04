/**
 * FORECAST SNAPSHOT SERVICE
 * =========================
 * 
 * BLOCK F1: Daily Forecast Recording
 * 
 * Converts Verdict V4 output -> ForecastPoint
 * Records daily snapshots for historical tracking.
 * 
 * IMPORTANT: This service is the ONLY way to create forecast history.
 * Points are append-only and immutable.
 */

import type { 
  ForecastPoint, 
  ForecastModelKey, 
  ForecastHorizon,
  ForecastDirection 
} from './forecast-series.types.js';
import { ForecastSeriesRepo } from './forecast-series.repo.js';

/**
 * Extract day key from ISO timestamp
 */
function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

/**
 * Determine direction from expected move
 */
function toDirection(expectedMovePct: number): ForecastDirection {
  if (expectedMovePct > 0.001) return 'UP';
  if (expectedMovePct < -0.001) return 'DOWN';
  return 'FLAT';
}

/**
 * Verdict-like structure from V4 API
 */
export type VerdictLike = {
  symbol: string;
  horizon: ForecastHorizon;
  
  // Core verdict data
  fromPrice: number;
  expectedMovePct: number;
  confidence: number;
  
  // Optional explain data
  explain?: {
    overlays?: { 
      volatilityPct?: number;
      [key: string]: unknown;
    };
    meta?: { 
      verdictId?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

export class ForecastSnapshotService {
  constructor(private repo: ForecastSeriesRepo) {}

  /**
   * Record a single forecast point from verdict data
   */
  async recordPoint(params: {
    symbol: string;
    model: ForecastModelKey;
    horizon: ForecastHorizon;
    verdict: VerdictLike;
    createdAtIso?: string; // Allow override for testing
  }): Promise<{ point: ForecastPoint; inserted: boolean }> {
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();
    const createdDay = dayKey(createdAtIso);

    const point: ForecastPoint = {
      symbol: params.symbol,
      model: params.model,
      horizon: params.horizon,
      createdAtIso,
      createdDay,

      basePrice: params.verdict.fromPrice,
      expectedMovePct: params.verdict.expectedMovePct,
      confidence: params.verdict.confidence,
      direction: toDirection(params.verdict.expectedMovePct),

      volatilityPct: params.verdict.explain?.overlays?.volatilityPct,
      source: {
        verdictId: params.verdict.explain?.meta?.verdictId as string | undefined,
        engine: 'V4',
      }
    };

    const result = await this.repo.upsertPoint(point);
    
    return { point, inserted: result.inserted };
  }

  /**
   * Record forecasts for multiple models at once
   */
  async recordMultiModel(params: {
    symbol: string;
    horizon: ForecastHorizon;
    models: ForecastModelKey[];
    verdicts: Map<ForecastModelKey, VerdictLike>;
    createdAtIso?: string;
  }): Promise<{ recorded: number; skipped: number }> {
    let recorded = 0;
    let skipped = 0;

    for (const model of params.models) {
      const verdict = params.verdicts.get(model);
      if (!verdict) {
        skipped++;
        continue;
      }

      const result = await this.recordPoint({
        symbol: params.symbol,
        model,
        horizon: params.horizon,
        verdict,
        createdAtIso: params.createdAtIso,
      });

      if (result.inserted) {
        recorded++;
      } else {
        skipped++;
      }
    }

    return { recorded, skipped };
  }
}

// Singleton
let serviceInstance: ForecastSnapshotService | null = null;

export function getForecastSnapshotService(repo: ForecastSeriesRepo): ForecastSnapshotService {
  if (!serviceInstance) {
    serviceInstance = new ForecastSnapshotService(repo);
  }
  return serviceInstance;
}

console.log('[ForecastSnapshotService] Module loaded (Block F1)');
