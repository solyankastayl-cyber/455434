/**
 * DXY MACRO ROUTES — D6 v1 + v2 + v3
 * 
 * API endpoints for DXY Macro Layer.
 * 
 * ISOLATION:
 * - Does NOT modify DXY fractal core
 * - Does NOT import from /modules/btc or /modules/spx
 * - Only reads DXY fractal output and applies macro adjustment
 * 
 * Endpoints:
 * - GET  /api/fractal/dxy/macro — Main macro-adjusted signal (Fed Funds + CPI + UNRATE)
 * - GET  /api/dxy-macro/rate-context — Current rate context
 * - GET  /api/dxy-macro/rate-history — Rate history
 * - POST /api/dxy-macro/admin/ingest — Ingest Fed Funds data
 * - GET  /api/dxy-macro/admin/meta — Fed Funds data meta
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRateContext, getRateHistory } from '../services/rate-context.service.js';
import { computeMacroAdjustment, applyMacroAdjustment } from '../services/macro-adjustment.service.js';
import { ingestFedFundsFromCsv, fetchAndIngestFromFred, getFedFundsMeta, checkFedFundsIntegrity } from '../services/fed-funds-ingest.service.js';
import { buildDxyFocusPack, buildDxySyntheticPack } from '../../dxy/services/dxy-focus-pack.service.js';
import { getDxyLatestPrice } from '../../dxy/services/dxy-chart.service.js';
// D6 v2: CPI Integration
import { getCpiContext, computeCpiAdjustment, combineMacroMultipliers, checkCpiIntegrity } from '../../dxy-macro-cpi/index.js';
// D6 v3: UNRATE Integration
import { getUnrateContext, computeUnrateAdjustment, combineAllMacroMultipliers, checkUnrateIntegrity } from '../../dxy-macro-unrate/index.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyMacroRoutes(fastify: FastifyInstance) {
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN ENDPOINT: GET /api/fractal/dxy/macro
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/fractal/dxy/macro', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const query = req.query as { asOf?: string; horizon?: string };
    const horizon = query.horizon || '30d';
    
    try {
      // Check Fed Funds data availability
      const fedIntegrity = await checkFedFundsIntegrity();
      if (!fedIntegrity.ok) {
        return reply.code(503).send({
          ok: false,
          error: 'INSUFFICIENT_FED_DATA',
          message: fedIntegrity.warning,
          hint: 'Run POST /api/dxy-macro/admin/ingest to load Fed Funds data',
        });
      }
      
      // 1. Get DXY Fractal output (unchanged core)
      const focusPack = await buildDxyFocusPack(horizon);
      const synthetic = await buildDxySyntheticPack(horizon);
      const latest = await getDxyLatestPrice();
      
      if (!focusPack || !synthetic) {
        return reply.code(500).send({
          ok: false,
          error: 'Failed to build DXY fractal data',
        });
      }
      
      // Extract fractal forecast
      const fractalForecastReturn = synthetic.forecast.base;
      const entropy = focusPack.diagnostics.entropy;
      const similarity = focusPack.diagnostics.similarity;
      
      // Determine action from fractal
      let fractalAction = 'HOLD';
      if (fractalForecastReturn > 0.01) fractalAction = 'LONG';
      if (fractalForecastReturn < -0.01) fractalAction = 'SHORT';
      
      // 2. Get Rate Context
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      const rateContext = await getRateContext(asOf);
      
      // 3. Compute Fed Funds Macro Adjustment
      const fedAdjustment = computeMacroAdjustment(fractalForecastReturn, rateContext);
      
      // 4. Get CPI Context and Adjustment (D6 v2)
      let cpiContext = null;
      let cpiAdjustment = null;
      let cpiMultiplier = 1;
      
      const cpiIntegrity = await checkCpiIntegrity();
      if (cpiIntegrity.ok) {
        try {
          cpiContext = await getCpiContext(asOf);
          cpiAdjustment = computeCpiAdjustment(cpiContext);
          cpiMultiplier = cpiAdjustment.multiplier;
        } catch (cpiError: any) {
          console.warn('[DXY Macro] CPI context error (continuing without CPI):', cpiError.message);
        }
      }
      
      // 5. Get UNRATE Context and Adjustment (D6 v3)
      let unrateContext = null;
      let unrateAdjustment = null;
      let unrateMultiplier = 1;
      
      const unrateIntegrity = await checkUnrateIntegrity();
      if (unrateIntegrity.ok) {
        try {
          unrateContext = await getUnrateContext(asOf);
          unrateAdjustment = computeUnrateAdjustment(unrateContext);
          unrateMultiplier = unrateAdjustment.multiplier;
        } catch (unrateError: any) {
          console.warn('[DXY Macro] UNRATE context error (continuing without UNRATE):', unrateError.message);
        }
      }
      
      // 6. Compute Combined Multiplier (Fed × CPI × UNRATE)
      const macroMultiplierTotal = combineAllMacroMultipliers(
        fedAdjustment.multiplier,
        cpiMultiplier,
        unrateMultiplier
      );
      
      // 7. Apply Combined Adjustment
      const macroAdjustedReturn = Math.round(fractalForecastReturn * macroMultiplierTotal * 10000) / 10000;
      
      // 8. Build response with all layers
      const response = {
        ok: true,
        fractal: {
          forecastReturn: Math.round(fractalForecastReturn * 10000) / 10000,
          entropy: Math.round(entropy * 10000) / 10000,
          similarity: Math.round(similarity * 10000) / 10000,
          hybridReturn: synthetic.forecast.base,
          action: fractalAction,
        },
        macroContext: {
          fedFunds: rateContext,
          cpi: cpiContext,
          unrate: unrateContext,
        },
        adjustments: {
          fedFunds: fedAdjustment,
          cpi: cpiAdjustment,
          unrate: unrateAdjustment,
        },
        macroMultiplierTotal,
        macroAdjustedReturn,
        processingTimeMs: Date.now() - start,
      };
      
      return response;
      
    } catch (error: any) {
      console.error('[DXY Macro] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/fractal/dxy/macro/validate — D6.VAL1 Validation
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/fractal/dxy/macro/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const query = req.query as { from?: string; to?: string; focus?: string };
    
    const from = query.from || '1973-01-01';
    const to = query.to || new Date().toISOString().split('T')[0];
    const focus = query.focus || '30d';
    
    try {
      const { runMacroValidation } = await import('../services/macro-validation.service.js');
      const result = await runMacroValidation(from, to, focus);
      
      // Add PASS/FAIL verdict
      // Critical criteria: macro should NOT create noise in signal direction
      const verdict = {
        // CRITICAL: Sign flips must be rare (<2%)
        pctSignFlips: result.impact.pctSignFlips <= 0.02 ? 'PASS' : 'FAIL',
        // CRITICAL: Action changes must be rare (<5%)  
        pctActionChanges: result.impact.pctActionChanges <= 0.05 ? 'PASS' : 'FAIL',
        // WARNING: Multiplier spread (informational, not blocking)
        multiplierSpread: result.multiplierTotal.std <= 0.15 ? 'PASS' : 'WARN',
        // CRITICAL: No high-frequency noise (crossings/year at 1% threshold)
        noiseLevel: result.multiplierTotal.thresholdCrossingsPerYear.pct1 < 50 ? 'PASS' : 'FAIL',
      };
      
      // Overall passes if critical criteria pass (ignoring WARN)
      const criticalPass = verdict.pctSignFlips === 'PASS' && 
                          verdict.pctActionChanges === 'PASS' && 
                          verdict.noiseLevel === 'PASS';
      
      return {
        ...result,
        verdict: {
          ...verdict,
          overall: criticalPass ? 'PASS' : 'FAIL',
          note: criticalPass 
            ? 'Macro layer scales amplitude without creating directional noise'
            : 'Macro layer introduces noise in signal direction',
        },
        processingTimeMs: Date.now() - start,
      };
      
    } catch (error: any) {
      console.error('[DXY Macro Validate] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/rate-context
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/rate-context', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { asOf?: string };
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      
      const rateContext = await getRateContext(asOf);
      
      return {
        ok: true,
        ...rateContext,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/rate-history
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/rate-history', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { months?: string };
      const months = query.months ? parseInt(query.months) : 24;
      
      const history = await getRateHistory(months);
      
      return {
        ok: true,
        months,
        dataPoints: history.length,
        history,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: POST /api/dxy-macro/admin/ingest
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post('/api/dxy-macro/admin/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { source?: string };
      const source = query.source || 'fred';
      
      let result;
      
      if (source === 'csv') {
        // Ingest from local CSV
        const body = req.body as { path?: string };
        const csvPath = body?.path || '/app/data/fed_funds.csv';
        result = await ingestFedFundsFromCsv(csvPath);
      } else {
        // Fetch from FRED API
        result = await fetchAndIngestFromFred();
      }
      
      return {
        ok: true,
        source,
        ...result,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: GET /api/dxy-macro/admin/meta
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/admin/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const meta = await getFedFundsMeta();
      const integrity = await checkFedFundsIntegrity();
      
      return {
        ok: true,
        ...meta,
        integrity,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  console.log('[DXY Macro] Routes registered at /api/fractal/dxy/macro, /api/dxy-macro/*');
}

export default registerDxyMacroRoutes;
