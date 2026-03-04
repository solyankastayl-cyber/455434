/**
 * DXY MACRO CPI MODULE INDEX — D6 v2
 * 
 * ISOLATION RULE:
 * - MUST NOT import from /modules/btc
 * - MUST NOT import from /modules/spx
 * - MUST NOT modify /modules/dxy core
 * - Only reads DXY fractal output
 * 
 * This module adds CPI (inflation) context layer on top of
 * the frozen DXY fractal core and Fed Funds layer.
 */

import { FastifyInstance } from 'fastify';
import { registerCpiRoutes } from './api/cpi.routes.js';
import { checkCpiIntegrity, ingestAllCpiSeries } from './services/cpi_ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// COLD START — Auto-load CPI data if missing
// ═══════════════════════════════════════════════════════════════

async function coldStartCpiData(): Promise<void> {
  console.log('[CPI] Cold Start: Checking CPI data...');
  
  const integrity = await checkCpiIntegrity();
  console.log(`[CPI] Cold Start: headline=${integrity.headline}, core=${integrity.core} points`);
  
  if (!integrity.ok) {
    console.log('[CPI] Cold Start: Data insufficient, attempting FRED fetch...');
    
    try {
      const result = await ingestAllCpiSeries('1947-01-01');
      console.log(`[CPI] Cold Start: ✅ Loaded headline=${result.headline.total}, core=${result.core.total} points`);
      console.log(`[CPI] Cold Start: Range: ${result.rangeStart} → ${result.rangeEnd}`);
    } catch (err) {
      console.error('[CPI] Cold Start: Failed to fetch from FRED:', err);
      console.log('[CPI] Cold Start: ⚠️ Run POST /api/dxy-macro/admin/cpi/ingest manually');
    }
  } else {
    console.log('[CPI] Cold Start: ✅ CPI data OK');
  }
}

// ═══════════════════════════════════════════════════════════════
// REGISTER MODULE
// ═══════════════════════════════════════════════════════════════

export async function registerCpiModule(fastify: FastifyInstance): Promise<void> {
  console.log('[CPI] ═══════════════════════════════════════════════════════');
  console.log('[CPI] Registering CPI Macro Module v1.0.0 (D6 v2)');
  
  // Cold start data check
  await coldStartCpiData();
  
  // Register routes
  await registerCpiRoutes(fastify);
  
  console.log('[CPI] ✅ CPI Macro Module registered successfully');
  console.log('[CPI] ═══════════════════════════════════════════════════════');
}

// Re-export for integration
export { getCpiContext, getCpiHistory } from './services/cpi_context.service.js';
export { computeCpiAdjustment, combineMacroMultipliers } from './services/cpi_adjustment.service.js';
export { checkCpiIntegrity, getCpiMeta } from './services/cpi_ingest.service.js';
export * from './contracts/cpi.contract.js';
