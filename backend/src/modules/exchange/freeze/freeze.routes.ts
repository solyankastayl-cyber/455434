/**
 * PHASE 1.4 — Exchange Freeze Routes
 * ====================================
 * Admin endpoints for freeze status and guardrails
 */

import { FastifyInstance } from 'fastify';
import { getExchangeVersionString, getExchangeVersionObject } from './exchange.version.js';
import { SLA_THRESHOLDS } from './exchange.sla.js';

export async function registerFreezeRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/freeze/status — Freeze status
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/freeze/status', async () => {
    return {
      ok: true,
      exchangeVersion: getExchangeVersionString(),
      versions: getExchangeVersionObject(),
      slaThresholds: SLA_THRESHOLDS,
      message: 'Exchange freeze guardrails active',
      frozen: true,
      frozenAt: '2026-02-08T18:00:00Z',
      rules: {
        indicatorsLocked: true,
        regimesLocked: true,
        patternsLocked: true,
        verdictLocked: true,
        allowedChanges: ['optimization', 'bugfixes', 'data_providers'],
      },
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/freeze/sla — SLA configuration
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/freeze/sla', async () => {
    return {
      ok: true,
      thresholds: SLA_THRESHOLDS,
      description: {
        minCompleteness: 'Minimum data completeness score (0-1)',
        maxStalenessMs: 'Maximum age of data in milliseconds',
        minProvidersUp: 'Minimum number of live providers required',
        criticalFields: 'Fields that must be present for LIVE mode',
      },
    };
  });
  
  console.log('[Phase 1.4] Freeze Routes registered');
}
