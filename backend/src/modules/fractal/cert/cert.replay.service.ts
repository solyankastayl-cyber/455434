/**
 * BLOCK 41.1 — Deterministic Replay Test
 * Ensures 100% identical results for same inputs
 */

import crypto from 'crypto';

export interface ReplayRequest {
  asOf: string;
  presetKey: string;
  runs?: number;
  symbol?: string;
  timeframe?: string;
}

export interface ReplayResult {
  runs: number;
  uniqueHashes: number;
  hashes: string[];
  pass: boolean;
  example: any;
  duration_ms: number;
}

/**
 * Stable hash for any object (sorted keys)
 */
export function stableHash(obj: any): string {
  const sortedJson = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(sortedJson).digest('hex');
}

/**
 * Run deterministic replay test
 * Same inputs → same outputs → same hash
 */
export async function runReplay(
  fractalSvc: any,
  req: ReplayRequest
): Promise<ReplayResult> {
  const start = Date.now();
  const runs = req.runs ?? 100;
  const results: { hash: string; sample: any }[] = [];

  for (let i = 0; i < runs; i++) {
    const signal = await fractalSvc.getSignal({
      symbol: req.symbol ?? 'BTCUSD',
      timeframe: req.timeframe ?? '1d',
      asOf: req.asOf,
      presetKey: req.presetKey,
    });

    // Remove non-deterministic fields before hashing
    const cleanSignal = { ...signal };
    delete cleanSignal.computedAt;
    delete cleanSignal.latency_ms;

    results.push({
      hash: stableHash(cleanSignal),
      sample: signal,
    });
  }

  const uniqueHashes = new Set(results.map((r) => r.hash));
  const pass = uniqueHashes.size === 1;

  return {
    runs,
    uniqueHashes: uniqueHashes.size,
    hashes: [...uniqueHashes].slice(0, 5),
    pass,
    example: results[0]?.sample ?? null,
    duration_ms: Date.now() - start,
  };
}
