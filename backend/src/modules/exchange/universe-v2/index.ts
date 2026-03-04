/**
 * BLOCK 2.10 — Universe V2 Module Index
 * ======================================
 */

// Types & Models
export * from './db/universe.model.js';

// Adapters
export { binanceUniverseAdapter } from './adapters/binance.universe.adapter.js';
export { bybitUniverseAdapter } from './adapters/bybit.universe.adapter.js';
export { hyperliquidUniverseAdapter } from './adapters/hyperliquid.universe.adapter.js';

// Services
export { UniverseScannerService, universeScannerService } from './services/universe_scanner.service.js';

// Routes
export { registerUniverseV2Routes } from './routes/universe_v2.routes.js';

console.log('[Universe] V2 Module loaded (Block 2.10)');
