/**
 * Paper Trading Routes (Phase 13.3)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './paper.service.js';
import { z } from 'zod';

const CreatePortfolioBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  mode: z.enum(['copy_actor', 'copy_strategy', 'copy_token', 'custom']),
  targets: z.array(z.string()).min(1),
  rules: z.object({
    maxPositions: z.number().min(1).max(50).optional(),
    riskCap: z.number().min(0).max(100).optional(),
    positionSizeUSD: z.number().min(1).optional(),
    slippageAssumption: z.number().min(0).max(10).optional(),
    entrySignalTypes: z.array(z.string()).optional(),
    entryMinSeverity: z.number().min(0).max(100).optional(),
    entryMinConfidence: z.number().min(0).max(1).optional(),
    timeStopHours: z.number().optional(),
    profitTargetPct: z.number().optional(),
    stopLossPct: z.number().optional(),
    exitOnRiskSpike: z.boolean().optional(),
    exitOnSignalReversal: z.boolean().optional(),
  }).optional(),
});

const OpenPositionBody = z.object({
  assetAddress: z.string(),
  assetSymbol: z.string().optional(),
  entryPrice: z.number().positive(),
  sizeUSD: z.number().positive(),
  entrySignalId: z.string().optional(),
  entryReason: z.string(),
});

const ClosePositionBody = z.object({
  exitPrice: z.number().positive(),
  exitSignalId: z.string().optional(),
  exitReason: z.string(),
});

export async function paperRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/paper/portfolio
   * Create a paper portfolio
   */
  app.post('/portfolio', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = CreatePortfolioBody.parse(request.body);
    
    const portfolio = await service.createPortfolio(userId, body);
    return { ok: true, data: portfolio };
  });
  
  /**
   * GET /api/paper/portfolio
   * Get user's portfolios
   */
  app.get('/portfolio', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const query = request.query as { enabled?: string };
    
    const portfolios = await service.getPortfolios(userId, {
      enabled: query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined,
    });
    
    return { ok: true, data: portfolios, count: portfolios.length };
  });
  
  /**
   * GET /api/paper/portfolio/:id
   * Get portfolio by ID
   */
  app.get('/portfolio/:id', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    
    const portfolio = await service.getPortfolioById(id, userId);
    if (!portfolio) {
      return { ok: false, error: 'Portfolio not found' };
    }
    
    return { ok: true, data: portfolio };
  });
  
  /**
   * PUT /api/paper/portfolio/:id
   * Update portfolio
   */
  app.put('/portfolio/:id', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    const body = CreatePortfolioBody.partial().parse(request.body);
    
    const portfolio = await service.updatePortfolio(id, userId, body);
    if (!portfolio) {
      return { ok: false, error: 'Portfolio not found' };
    }
    
    return { ok: true, data: portfolio };
  });
  
  /**
   * GET /api/paper/portfolio/:id/performance
   * Get portfolio performance
   */
  app.get('/portfolio/:id/performance', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const performance = await service.getPortfolioPerformance(id);
    if (!performance) {
      return { ok: false, error: 'Portfolio not found' };
    }
    
    return { ok: true, data: performance };
  });
  
  /**
   * GET /api/paper/positions
   * Get positions
   */
  app.get('/positions', async (request: FastifyRequest) => {
    const query = request.query as { portfolioId: string; status?: string };
    
    if (!query.portfolioId) {
      return { ok: false, error: 'portfolioId required' };
    }
    
    const positions = await service.getPositions(query.portfolioId, {
      status: query.status as any,
    });
    
    return { ok: true, data: positions, count: positions.length };
  });
  
  /**
   * POST /api/paper/portfolio/:id/position
   * Open a new position
   */
  app.post('/portfolio/:id/position', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    const body = OpenPositionBody.parse(request.body);
    
    try {
      const position = await service.openPosition(id, userId, body);
      if (!position) {
        return { ok: false, error: 'Portfolio not found' };
      }
      return { ok: true, data: position };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  /**
   * POST /api/paper/position/:id/close
   * Close a position
   */
  app.post('/position/:id/close', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    const body = ClosePositionBody.parse(request.body);
    
    const position = await service.closePosition(id, userId, body);
    if (!position) {
      return { ok: false, error: 'Position not found or already closed' };
    }
    
    return { ok: true, data: position };
  });
  
  app.log.info('Paper Trading routes registered');
}
