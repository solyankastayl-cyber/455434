/**
 * DXY MACRO CORE MODULE — B1
 * 
 * Macro Data Platform for DXY.
 * Handles macro data ingestion, context computation, and composite scoring.
 * 
 * ISOLATION RULE:
 * - MUST NOT import from /modules/btc
 * - MUST NOT import from /modules/spx
 * - MUST NOT import from /modules/dxy (fractal)
 * - This is a standalone macro data layer
 */

import { FastifyInstance } from 'fastify';
import { registerMacroRoutes } from './api/macro.routes.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER MODULE
// ═══════════════════════════════════════════════════════════════

export async function registerDxyMacroCoreModule(fastify: FastifyInstance): Promise<void> {
  console.log('[Macro] ═══════════════════════════════════════════════════════');
  console.log('[Macro] Registering DXY Macro Core Module B1.0.0');
  
  await registerMacroRoutes(fastify);
  
  console.log('[Macro] ✅ DXY Macro Core Module registered');
  console.log('[Macro] ═══════════════════════════════════════════════════════');
}

// Re-export types and services
export * from './contracts/macro.contracts.js';
export * from './data/macro_sources.registry.js';
export { buildMacroContext, buildAllMacroContexts } from './services/macro_context.service.js';
export { computeMacroScore } from './services/macro_score.service.js';
export { ingestAllMacroSeries, ingestMacroSeries } from './ingest/macro.ingest.service.js';
