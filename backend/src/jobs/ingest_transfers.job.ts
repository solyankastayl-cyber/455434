/**
 * ETAP 6.1 — Ingest Job
 * 
 * Cron job for automated raw transfer ingestion.
 * 
 * Schedule:
 * - 24h: every 5 minutes
 * - 7d: every 15 minutes
 * - 30d: every hour
 */
import { EthereumRpc } from '../onchain/ethereum/ethereum.rpc.js';
import { runIngest, getIngestStatus } from '../core/ingest/ingest.service.js';

export interface IngestJobResult {
  window: string;
  executed: boolean;
  inserted: number;
  skippedDuplicates: number;
  errors: number;
  duration: number;
  message?: string;
}

/**
 * Run ingest for a specific window
 */
export async function runIngestJob(
  rpc: EthereumRpc,
  window: '24h' | '7d' | '30d'
): Promise<IngestJobResult> {
  const startTime = Date.now();

  try {
    const result = await runIngest(rpc, {
      chain: 'ethereum',
      window,
      mode: 'incremental',
    });

    return {
      window,
      executed: true,
      inserted: result.inserted || 0,
      skippedDuplicates: result.skippedDuplicates || 0,
      errors: result.errors || 0,
      duration: result.duration || Date.now() - startTime,
      message: result.message,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      window,
      executed: false,
      inserted: 0,
      skippedDuplicates: 0,
      errors: 1,
      duration: Date.now() - startTime,
      message,
    };
  }
}

/**
 * Get job status for all windows
 */
export async function getIngestJobStatus(): Promise<{
  windows: Record<string, {
    lastRun: string | null;
    health: string;
    totalTransfers: number;
  }>;
}> {
  const windows = ['24h', '7d', '30d'] as const;
  const result: Record<string, { lastRun: string | null; health: string; totalTransfers: number }> = {};

  for (const window of windows) {
    try {
      const status = await getIngestStatus('ethereum', window);
      result[window] = {
        lastRun: status.lastRun?.finishedAt || null,
        health: status.health,
        totalTransfers: status.lastRun?.inserted || 0,
      };
    } catch {
      result[window] = {
        lastRun: null,
        health: 'error',
        totalTransfers: 0,
      };
    }
  }

  return { windows: result };
}
