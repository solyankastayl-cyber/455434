/**
 * Signals Routes
 * API endpoints for signals (event layer)
 * 
 * Base path: /api/signals
 * 
 * Key endpoints:
 * - GET /latest           - Get latest signals
 * - GET /address/:addr    - Get signals for address
 * - GET /corridor/:a/:b   - Get signals for corridor
 * - GET /stats            - Get signal statistics
 * - POST /:id/acknowledge - Acknowledge signal
 */
import type { FastifyInstance } from 'fastify';
import { signalsService, formatSignal } from './signals.service.js';
import type { SignalType, SignalSeverity } from './signals.model.js';
import { getSignalReaction, getSignalValidation } from '../signal_reactions/signal_reaction.service.js';

/**
 * Signals Routes
 */
export async function signalsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /latest - Get latest signals
   */
  app.get<{
    Querystring: {
      limit?: string;
      signalType?: string;
      severity?: string;
      minSeverityScore?: string;
      window?: string;
      acknowledged?: string;
      since?: string;
    };
  }>('/latest', async (request) => {
    const {
      limit = '50',
      signalType,
      severity,
      minSeverityScore,
      window,
      acknowledged,
      since,
    } = request.query;

    const signals = await signalsService.getLatest({
      limit: parseInt(limit, 10),
      signalType: signalType as SignalType,
      severity: severity as SignalSeverity,
      minSeverityScore: minSeverityScore ? parseInt(minSeverityScore, 10) : undefined,
      window,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
      since: since ? new Date(since) : undefined,
    });

    return {
      ok: true,
      data: signals.map(formatSignal),
    };
  });

  /**
   * GET /stats - Get signal statistics
   */
  app.get('/stats', async () => {
    const stats = await signalsService.getStats();
    return {
      ok: true,
      data: stats,
    };
  });

  /**
   * GET /address/:address - Get signals for address
   */
  app.get<{
    Params: { address: string };
    Querystring: {
      limit?: string;
      signalType?: string;
      severity?: string;
      since?: string;
    };
  }>('/address/:address', async (request, reply) => {
    const { address } = request.params;
    const { limit = '50', signalType, severity, since } = request.query;

    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const result = await signalsService.getForAddress(address, {
      limit: parseInt(limit, 10),
      signalType: signalType as SignalType,
      severity: severity as SignalSeverity,
      since: since ? new Date(since) : undefined,
    });

    return {
      ok: true,
      data: {
        signals: result.signals.map(formatSignal),
        summary: result.summary,
      },
    };
  });

  /**
   * GET /corridor/:from/:to - Get signals for corridor
   */
  app.get<{
    Params: { from: string; to: string };
    Querystring: { limit?: string; signalType?: string; since?: string };
  }>('/corridor/:from/:to', async (request, reply) => {
    const { from, to } = request.params;
    const { limit = '50', signalType, since } = request.query;

    // Validate addresses
    if (!/^0x[a-fA-F0-9]{40}$/.test(from) || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const signals = await signalsService.getForCorridor(from, to, {
      limit: parseInt(limit, 10),
      signalType: signalType as SignalType,
      since: since ? new Date(since) : undefined,
    });

    return {
      ok: true,
      data: signals.map(formatSignal),
    };
  });

  /**
   * POST /:id/acknowledge - Acknowledge signal
   */
  app.post<{ Params: { id: string } }>('/:id/acknowledge', async (request, reply) => {
    const { id } = request.params;
    const signal = await signalsService.acknowledge(id);

    if (!signal) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Signal not found',
      });
    }

    return {
      ok: true,
      data: formatSignal(signal),
    };
  });

  /**
   * POST /acknowledge - Bulk acknowledge signals
   */
  app.post<{ Body: { ids: string[] } }>('/acknowledge', async (request) => {
    const { ids } = request.body;
    const count = await signalsService.bulkAcknowledge(ids);

    return {
      ok: true,
      data: { acknowledged: count },
    };
  });

  /**
   * GET /:id - Get signal by ID
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const signal = await signalsService.getById(id);

    if (!signal) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Signal not found',
      });
    }

    return {
      ok: true,
      data: formatSignal(signal),
    };
  });

  /**
   * GET /:id/reaction - Get market reaction for signal (Phase 14B)
   */
  app.get<{ Params: { id: string }; Querystring: { window?: string } }>(
    '/:id/reaction',
    async (request, reply) => {
      const { id } = request.params;
      const { window } = request.query;
      
      const reaction = await getSignalReaction(id, window as any);
      
      if (!reaction || (Array.isArray(reaction) && reaction.length === 0)) {
        return {
          ok: false,
          error: 'No reactions yet',
          hint: 'Reactions are computed after the signal window passes (5m-4h)',
        };
      }
      
      return {
        ok: true,
        data: reaction,
      };
    }
  );

  /**
   * GET /:id/validation - Get validation summary for signal (Phase 14B)
   */
  app.get<{ Params: { id: string } }>('/:id/validation', async (request) => {
    const { id } = request.params;
    
    const validation = await getSignalValidation(id);
    
    return {
      ok: true,
      data: validation,
    };
  });

  app.log.info('Signals routes registered');
}

// Export as 'routes' for consistency
export { signalsRoutes as routes };
