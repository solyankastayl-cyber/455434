/**
 * BLOCK 56.4 — Forward Equity Module Index
 */

export { 
  forwardEquityService, 
  ForwardEquityService,
  type ForwardEquityQuery,
  type ForwardEquityResponse,
  type ForwardEquityGridResponse,
  type ForwardEquityMetrics,
  type LedgerEvent,
  type Role,
  type Preset,
  type HorizonDays
} from './forward.equity.service.js';

export { forwardEquityRoutes } from './forward.routes.js';
export { testSnapshotRoutes } from './test-snapshot.routes.js';

export * from './forward.metrics.js';
