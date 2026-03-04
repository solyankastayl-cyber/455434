/**
 * Signal Reactions Routes (Phase 14B.4)
 * 
 * API endpoints for signal market reactions and validation.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './signal_reaction.service.js';

export async function signalReactionsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/signal-reactions/:signalId/reaction
   * Get market reaction for a signal
   */
  app.get('/:signalId/reaction', async (request: FastifyRequest) => {
    const { signalId } = request.params as { signalId: string };
    const query = request.query as { window?: string };
    
    const reactions = await service.getSignalReaction(
      signalId,
      query.window as any
    );
    
    if (!reactions || (Array.isArray(reactions) && reactions.length === 0)) {
      return { ok: false, error: 'No reactions found', hint: 'Reactions are computed after signal window passes' };
    }
    
    return {
      ok: true,
      data: Array.isArray(reactions)
        ? reactions.map(formatReaction)
        : formatReaction(reactions),
    };
  });
  
  /**
   * GET /api/signal-reactions/:signalId/validation
   * Get validation summary for a signal
   */
  app.get('/:signalId/validation', async (request: FastifyRequest) => {
    const { signalId } = request.params as { signalId: string };
    
    const validation = await service.getSignalValidation(signalId);
    
    return {
      ok: true,
      data: validation,
    };
  });
  
  /**
   * GET /api/signal-reactions/stats/validated
   * Get validation statistics
   */
  app.get('/stats/validated', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    const stats = await service.getValidationStats(days);
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  app.log.info('Signal Reactions routes registered');
}

function formatReaction(r: any) {
  return {
    signalId: r.signalId,
    assetAddress: r.assetAddress,
    chain: r.chain,
    window: r.reactionWindow,
    priceBefore: r.priceBefore,
    priceAfter: r.priceAfter,
    priceDeltaPct: r.priceDeltaPct,
    reactionType: r.reactionType,
    directionMatched: r.directionMatched,
    magnitudeSignificant: r.magnitudeSignificant,
    confidenceImpact: r.confidenceImpact,
    volatilityBefore: r.volatilityBefore,
    volatilityAfter: r.volatilityAfter,
    computedAt: r.computedAt,
  };
}
