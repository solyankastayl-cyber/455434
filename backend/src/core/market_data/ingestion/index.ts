/**
 * Market Ingestion Index (P1.5)
 */

export {
  syncSymbol,
  syncAllSymbols,
  backfillSymbol,
  getIngestionStatus
} from './market_ingestor.service.js';

export type { SyncResult, BatchSyncResult } from './market_ingestor.service.js';
