/**
 * SPX TERMINAL — Module Index
 * 
 * BLOCK B1-B4 — SPX Data Foundation
 * 
 * Exports all SPX module components.
 * IMPORTANT: This module is ISOLATED from BTC.
 * No imports from /modules/btc/ allowed.
 */

// Routes
export { registerSpxRoutes } from './spx.routes.js';

// Config
export { default as SPX_CONFIG } from './spx.config.js';

// Constants
export * from './spx.constants.js';

// Types
export * from './spx.types.js';

// Models
export { 
  SpxCandleModel, 
  SpxBackfillProgressModel,
  SpxIngestionLogModel,
  ensureSpxIndexes,
} from './spx.mongo.js';

// Services
export { ingestSpxFromStooq, getIngestionLogs } from './spx.ingest.service.js';
export { 
  runSpxBackfill, 
  getBackfillProgress, 
  resetBackfillProgress,
  getCohortCounts,
} from './spx.backfill.service.js';
export { validateSpxData, auditSpxGaps, getSpxStats } from './spx.validation.service.js';
export { querySpxCandles, getLatestSpxCandle, getSpxCandlesByCohort } from './spx.candles.service.js';

// Cohorts
export { pickSpxCohort, pickSpxCohortByTs } from './spx.cohorts.js';

// Stooq client
export { fetchStooqCsv, parseStooqDailyCsv } from './spx.stooq.client.js';

// Yahoo CSV ingest
export { ingestFromYahooCsv, replaceWithYahooCsv, parseYahooCsv } from './spx.yahoo.ingest.js';

// Normalizer
export { toCanonicalSpxCandles, filterByDateRange } from './spx.normalizer.js';
