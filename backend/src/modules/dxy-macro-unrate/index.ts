/**
 * DXY MACRO UNRATE MODULE INDEX — D6 v3
 * 
 * ISOLATION RULE:
 * - MUST NOT import from /modules/btc
 * - MUST NOT import from /modules/spx
 * - MUST NOT modify /modules/dxy core
 * - Only reads DXY fractal output
 * 
 * This module adds unemployment rate context layer on top of
 * the frozen DXY fractal core and existing macro layers.
 */

import { FastifyInstance } from 'fastify';
import { registerUnrateRoutes } from './api/unrate.routes.js';
import { checkUnrateIntegrity, ingestUnrateFromFred } from './services/unrate.ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// COLD START — Auto-load UNRATE data if missing
// ═══════════════════════════════════════════════════════════════

async function coldStartUnrateData(): Promise<void> {
  console.log('[UNRATE] Cold Start: Checking unemployment data...');
  
  const integrity = await checkUnrateIntegrity();
  console.log(`[UNRATE] Cold Start: ${integrity.count} points, ${integrity.coverageYears.toFixed(1)} years`);
  
  if (!integrity.ok) {
    console.log('[UNRATE] Cold Start: Data insufficient, attempting FRED fetch...');
    
    try {
      const result = await ingestUnrateFromFred('1948-01-01');
      console.log(`[UNRATE] Cold Start: ✅ Loaded ${result.total} points from FRED`);
      console.log(`[UNRATE] Cold Start: Range: ${result.rangeStart} → ${result.rangeEnd}`);
    } catch (err) {
      console.error('[UNRATE] Cold Start: Failed to fetch from FRED:', err);
      console.log('[UNRATE] Cold Start: ⚠️ Run POST /api/dxy-macro/admin/unrate/ingest manually');
    }
  } else {
    console.log('[UNRATE] Cold Start: ✅ UNRATE data OK');
  }
}

// ═══════════════════════════════════════════════════════════════
// REGISTER MODULE
// ═══════════════════════════════════════════════════════════════

export async function registerUnrateModule(fastify: FastifyInstance): Promise<void> {
  console.log('[UNRATE] ═══════════════════════════════════════════════════════');
  console.log('[UNRATE] Registering Unemployment Rate Module v1.0.0 (D6 v3)');
  
  // Cold start data check
  await coldStartUnrateData();
  
  // Register routes
  await registerUnrateRoutes(fastify);
  
  console.log('[UNRATE] ✅ UNRATE Module registered successfully');
  console.log('[UNRATE] ═══════════════════════════════════════════════════════');
}

// Re-export for integration
export { getUnrateContext, getUnrateHistory } from './services/unrate.context.service.js';
export { computeUnrateAdjustment, combineAllMacroMultipliers } from './services/unrate.adjustment.service.js';
export { checkUnrateIntegrity, getUnrateMeta } from './services/unrate.ingest.service.js';
export * from './unrate.types.js';
