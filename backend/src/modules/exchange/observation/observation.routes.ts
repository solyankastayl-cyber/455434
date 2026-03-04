/**
 * S10.6 — Observation API Routes (User-facing)
 * 
 * Read-only endpoints for observation dataset.
 * NO signals, NO predictions — just historical data.
 */

import { FastifyInstance } from 'fastify';
import * as observationService from './observation.service.js';
import { detectPatterns } from '../patterns/pattern.detector.js';
import { generateMockPatternInput } from '../patterns/pattern.service.js';
import { 
  startExchangeObservationJob, 
  stopExchangeObservationJob, 
  getExchangeObservationJobStatus,
  triggerManualCollection
} from '../../../jobs/exchange_observation.job.js';
import {
  startOutcomeTracker,
  stopOutcomeTracker,
  getOutcomeTrackerStatus,
  triggerOutcomeTracking
} from '../../../jobs/outcome_tracker.job.js';

export async function observationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/observation — List observations
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ 
    Querystring: { 
      symbol?: string;
      limit?: string;
      regime?: string;
      hasPatterns?: string;
      hasConflict?: string;
    } 
  }>('/api/v10/exchange/observation', async (request) => {
    const { symbol, limit, regime, hasPatterns, hasConflict } = request.query;
    
    const observations = await observationService.getObservations({
      symbol,
      limit: limit ? parseInt(limit) : 50,
      regime: regime as any,
      hasPatterns: hasPatterns === 'true' ? true : hasPatterns === 'false' ? false : undefined,
      hasConflict: hasConflict === 'true' ? true : hasConflict === 'false' ? false : undefined,
    });
    
    return {
      ok: true,
      count: observations.length,
      data: observations.map(o => ({
        id: o.id,
        symbol: o.symbol,
        timestamp: o.timestamp,
        regime: o.regime.type,
        regimeConfidence: o.regime.confidence,
        patternCount: o.patternCount,
        hasConflict: o.hasConflict,
        patterns: o.patterns.map(p => p.name),
        market: {
          price: o.market.price,
          priceChange5m: o.market.priceChange5m,
        },
        volume: o.volume,
        openInterest: o.openInterest,
        orderFlow: o.orderFlow.aggressorBias,
        cascadeActive: o.liquidations.cascadeActive,
      })),
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/observation/:symbol — Symbol observations
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/v10/exchange/observation/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const limit = parseInt(request.query.limit || '50');
      
      const observations = await observationService.getRecentObservations(symbol, limit);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        count: observations.length,
        data: observations,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/observation/stats — Dataset statistics
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/observation/stats', async () => {
    const stats = await observationService.getStats();
    
    return {
      ok: true,
      ...stats,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/observation/matrix — Regime × Pattern Matrix
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/observation/matrix', async () => {
    const matrix = await observationService.getRegimePatternMatrix();
    
    return {
      ok: true,
      ...matrix,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/observation/tick — Manual tick (for testing)
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string } }>(
    '/api/v10/exchange/observation/tick',
    async (request) => {
      const symbol = request.body?.symbol || 'BTCUSDT';
      
      // Generate mock market state
      const marketInput = observationService.generateMockObservationInput(symbol);
      
      // Detect patterns
      const patternInput = generateMockPatternInput(symbol);
      const patterns = detectPatterns(patternInput);
      
      // Create observation
      const observation = await observationService.createObservation({
        ...marketInput,
        patterns,
      });
      
      return {
        ok: true,
        message: 'Observation created',
        observation: {
          id: observation.id,
          symbol: observation.symbol,
          regime: observation.regime.type,
          patternCount: observation.patternCount,
          hasConflict: observation.hasConflict,
          patterns: observation.patterns.map(p => p.name),
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // S10.6I.6 — POST /api/v10/exchange/observation/tick/full — With indicators
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string } }>(
    '/api/v10/exchange/observation/tick/full',
    async (request) => {
      const symbol = request.body?.symbol || 'BTCUSDT';
      
      // Generate mock market state
      const marketInput = observationService.generateMockObservationInput(symbol);
      
      // Detect patterns
      const patternInput = generateMockPatternInput(symbol);
      const patterns = detectPatterns(patternInput);
      
      // Create observation with indicators
      const observation = await observationService.createObservationWithIndicators({
        ...marketInput,
        patterns,
        forceReason: 'manual_tick',
      });
      
      if (!observation) {
        return {
          ok: false,
          error: 'Rate limited',
        };
      }
      
      return {
        ok: true,
        message: 'Observation created with indicators',
        observation: {
          id: observation.id,
          symbol: observation.symbol,
          regime: observation.regime.type,
          patternCount: observation.patternCount,
          hasConflict: observation.hasConflict,
          patterns: observation.patterns.map(p => p.name),
          indicatorsMeta: observation.indicatorsMeta,
          indicatorCount: Object.keys(observation.indicators).length,
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // PHASE 1.1 — POST /api/v10/exchange/observation/tick/live — With LIVE data
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string } }>(
    '/api/v10/exchange/observation/tick/live',
    async (request) => {
      const symbol = (request.body?.symbol || 'BTCUSDT').toUpperCase();
      
      // Import real data service
      const { fetchLiveData, liveSnapshotToObservationInput, isDataSufficient } = await import('../data/realdata.service.js');
      
      // Fetch live data from providers
      const liveSnapshot = await fetchLiveData(symbol);
      
      if (!liveSnapshot) {
        // Fallback to mock if live data unavailable
        const mockInput = observationService.generateMockObservationInput(symbol);
        const patternInput = generateMockPatternInput(symbol);
        const patterns = detectPatterns(patternInput);
        
        const observation = await observationService.createObservationWithIndicators({
          ...mockInput,
          patterns,
          forceReason: 'live_fallback_to_mock',
          sourceMeta: {
            dataMode: 'MOCK',
            providersUsed: ['MOCK'],
            missing: ['all'],
            timestamp: Date.now(),
          },
        });
        
        return {
          ok: true,
          warning: 'Live data unavailable, used mock fallback',
          dataMode: 'MOCK',
          observation: observation ? {
            id: observation.id,
            symbol: observation.symbol,
            regime: observation.regime.type,
            patternCount: observation.patternCount,
          } : null,
        };
      }
      
      // Convert live snapshot to observation input
      const marketInput = liveSnapshotToObservationInput(liveSnapshot);
      
      // Detect patterns based on live data
      const patternInput = generateMockPatternInput(symbol); // TODO: Generate from live data
      const patterns = detectPatterns(patternInput);
      
      // Create observation with live data
      const observation = await observationService.createObservationWithIndicators({
        ...marketInput,
        patterns,
        forceReason: 'live_tick',
      });
      
      if (!observation) {
        return {
          ok: false,
          error: 'Rate limited',
          sourceMeta: liveSnapshot.sourceMeta,
        };
      }
      
      const sufficiency = isDataSufficient(liveSnapshot.sourceMeta);
      
      return {
        ok: true,
        message: 'Observation created with LIVE data',
        dataMode: liveSnapshot.sourceMeta.dataMode,
        sourceMeta: liveSnapshot.sourceMeta,
        dataQuality: {
          sufficient: sufficiency.sufficient,
          degraded: sufficiency.degraded,
          reason: sufficiency.reason,
        },
        liveData: {
          price: liveSnapshot.price,
          priceChange5m: liveSnapshot.priceChange5m,
          openInterest: liveSnapshot.openInterest,
          fundingRate: liveSnapshot.fundingRate,
        },
        observation: {
          id: observation.id,
          symbol: observation.symbol,
          regime: observation.regime.type,
          regimeConfidence: observation.regime.confidence,
          patternCount: observation.patternCount,
          hasConflict: observation.hasConflict,
          patterns: observation.patterns.map(p => p.name),
          indicatorsMeta: observation.indicatorsMeta,
          indicatorCount: Object.keys(observation.indicators).length,
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // S10.6I.6 — GET /api/v10/exchange/observation/:symbol/latest — Latest observation
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/observation/:symbol/latest',
    async (request) => {
      const { symbol } = request.params;
      
      const observation = await observationService.getLatestObservation(symbol);
      
      if (!observation) {
        return {
          ok: false,
          error: `No observations found for ${symbol.toUpperCase()}`,
        };
      }
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        observation,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // S10.6I.6 — GET /api/v10/exchange/observation/indicators/coverage — Indicator coverage
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/v10/exchange/observation/indicators/coverage',
    async (request) => {
      const { symbol } = request.query;
      
      const stats = await observationService.getIndicatorCoverageStats(symbol);
      
      return {
        ok: true,
        symbol: symbol?.toUpperCase() || 'ALL',
        stats,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // S10.6I.6 — POST /api/v10/exchange/observation/backfill — Backfill observations
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string; count?: number } }>(
    '/api/v10/exchange/observation/backfill',
    async (request) => {
      const symbol = request.body?.symbol || 'BTCUSDT';
      const count = Math.min(request.body?.count || 10, 100);
      
      const results = await observationService.backfillObservations(symbol, count);
      
      return {
        ok: true,
        message: `Backfilled ${results.length} observations for ${symbol}`,
        count: results.length,
        observations: results.map(o => ({
          id: o.id,
          timestamp: o.timestamp,
          indicatorCount: Object.keys(o.indicators).length,
          completeness: o.indicatorsMeta.completeness,
        })),
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // Collection Job Management APIs
  // ─────────────────────────────────────────────────────────────
  
  /**
   * GET /api/v10/exchange/observation/job/status
   * Get the status of the observation collection job
   */
  fastify.get('/api/v10/exchange/observation/job/status', async () => {
    const status = getExchangeObservationJobStatus();
    return { ok: true, ...status };
  });
  
  /**
   * POST /api/v10/exchange/observation/job/start
   * Start the observation collection job
   */
  fastify.post('/api/v10/exchange/observation/job/start', async () => {
    const result = startExchangeObservationJob();
    return { ok: result.success, message: result.message };
  });
  
  /**
   * POST /api/v10/exchange/observation/job/stop
   * Stop the observation collection job
   */
  fastify.post('/api/v10/exchange/observation/job/stop', async () => {
    const result = stopExchangeObservationJob();
    return { ok: result.success, message: result.message };
  });
  
  /**
   * POST /api/v10/exchange/observation/job/trigger
   * Trigger a manual collection run
   */
  fastify.post('/api/v10/exchange/observation/job/trigger', async () => {
    const result = await triggerManualCollection();
    return { 
      ok: result.success, 
      collected: result.collected,
      errors: result.errors,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // Outcome Tracker Job APIs
  // ─────────────────────────────────────────────────────────────
  
  /**
   * GET /api/v10/exchange/outcome/job/status
   * Get outcome tracker status
   */
  fastify.get('/api/v10/exchange/outcome/job/status', async () => {
    const status = getOutcomeTrackerStatus();
    return { ok: true, ...status };
  });
  
  /**
   * POST /api/v10/exchange/outcome/job/start
   * Start outcome tracking
   */
  fastify.post('/api/v10/exchange/outcome/job/start', async () => {
    const result = startOutcomeTracker();
    return { ok: result.success, message: result.message };
  });
  
  /**
   * POST /api/v10/exchange/outcome/job/stop
   * Stop outcome tracking
   */
  fastify.post('/api/v10/exchange/outcome/job/stop', async () => {
    const result = stopOutcomeTracker();
    return { ok: result.success, message: result.message };
  });
  
  /**
   * POST /api/v10/exchange/outcome/job/trigger
   * Trigger manual outcome processing
   */
  fastify.post('/api/v10/exchange/outcome/job/trigger', async () => {
    const result = await triggerOutcomeTracking();
    return { 
      ok: true, 
      processed: result.processed,
      created: result.created,
      errors: result.errors,
    };
  });

  console.log('[S10.6] Observation API routes registered: /api/v10/exchange/observation/* (S10.6I.6 enabled)');
}

export default observationRoutes;
