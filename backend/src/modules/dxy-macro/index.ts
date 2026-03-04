/**
 * DXY MACRO MODULE INDEX — D6 v1
 * 
 * ISOLATION RULE:
 * - MUST NOT import from /modules/btc
 * - MUST NOT import from /modules/spx
 * - MUST NOT modify /modules/dxy core
 * - Only reads DXY fractal output
 * 
 * This module adds macro-economic context layer on top of
 * the frozen DXY fractal core.
 */

import { FastifyInstance } from 'fastify';
import { registerDxyMacroRoutes } from './api/dxy-macro.routes.js';
import { checkFedFundsIntegrity, fetchAndIngestFromFred } from './services/fed-funds-ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// COLD START — Auto-load Fed Funds data if missing
// ═══════════════════════════════════════════════════════════════

async function coldStartFedFundsData(): Promise<void> {
  console.log('[DXY Macro] Cold Start: Checking Fed Funds data...');
  
  const integrity = await checkFedFundsIntegrity();
  console.log(`[DXY Macro] Cold Start: ${integrity.count} data points, ${integrity.coverageYears.toFixed(1)} years`);
  
  if (!integrity.ok) {
    console.log('[DXY Macro] Cold Start: Data insufficient, attempting FRED fetch...');
    
    try {
      const result = await fetchAndIngestFromFred();
      console.log(`[DXY Macro] Cold Start: ✅ Loaded ${result.written} data points from FRED`);
      console.log(`[DXY Macro] Cold Start: Range: ${result.range.from} → ${result.range.to}`);
    } catch (err) {
      console.error('[DXY Macro] Cold Start: Failed to fetch from FRED:', err);
      console.log('[DXY Macro] Cold Start: ⚠️ Run POST /api/dxy-macro/admin/ingest manually');
    }
  } else {
    console.log('[DXY Macro] Cold Start: ✅ Fed Funds data OK');
  }
}

// ═══════════════════════════════════════════════════════════════
// REGISTER MODULE
// ═══════════════════════════════════════════════════════════════

export async function registerDxyMacroModule(fastify: FastifyInstance): Promise<void> {
  console.log('[DXY Macro] ═══════════════════════════════════════════════════════');
  console.log('[DXY Macro] Registering DXY Macro Module v1.0.0 (D6)');
  
  // Cold start data check
  await coldStartFedFundsData();
  
  // Register routes
  await registerDxyMacroRoutes(fastify);
  
  console.log('[DXY Macro] ✅ DXY Macro Module registered successfully');
  console.log('[DXY Macro] ═══════════════════════════════════════════════════════');
}

// Re-export types
export * from './contracts/dxy-macro.contract.js';

// Re-export services for testing
export { getRateContext, getRateHistory } from './services/rate-context.service.js';
export { computeMacroAdjustment, applyMacroAdjustment } from './services/macro-adjustment.service.js';
export { checkFedFundsIntegrity, getFedFundsMeta } from './services/fed-funds-ingest.service.js';
