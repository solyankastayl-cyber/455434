/**
 * P14: Analysis Routes
 * 
 * GET /api/analysis/regime-performance - Regime decomposition
 * GET /api/analysis/volatility-performance - Vol decomposition
 * GET /api/analysis/rolling - Rolling metrics
 * GET /api/analysis/performance-matrix - Full matrix with gates
 */

import { FastifyInstance } from 'fastify';
import { getRegimeDecompositionService } from '../services/regime_decomposition.service.js';
import { getVolatilityDecompositionService } from '../services/volatility_decomposition.service.js';
import { getPerformanceMatrixService } from '../services/performance_matrix.service.js';

export async function analysisRoutes(fastify: FastifyInstance): Promise<void> {
  const regimeService = getRegimeDecompositionService();
  const volService = getVolatilityDecompositionService();
  const matrixService = getPerformanceMatrixService();
  
  /**
   * GET /api/analysis/regime-performance
   * Decompose performance by Brain scenario (BASE/RISK/TAIL)
   */
  fastify.get('/api/analysis/regime-performance', async (request) => {
    const { backtestId } = request.query as { backtestId?: string };
    
    if (!backtestId) {
      return { ok: false, error: 'Missing backtestId parameter' };
    }
    
    const result = await regimeService.calculateRegimePerformance(backtestId);
    
    if (!result) {
      return { ok: false, error: 'Backtest not found or not complete' };
    }
    
    return { ok: true, ...result };
  });
  
  /**
   * GET /api/analysis/volatility-performance
   * Decompose performance by volatility regime (LOW/MID/HIGH)
   */
  fastify.get('/api/analysis/volatility-performance', async (request) => {
    const { 
      backtestId, 
      window = '30', 
      ql = '0.3', 
      qh = '0.7' 
    } = request.query as { 
      backtestId?: string; 
      window?: string; 
      ql?: string; 
      qh?: string;
    };
    
    if (!backtestId) {
      return { ok: false, error: 'Missing backtestId parameter' };
    }
    
    const result = await volService.calculateVolPerformance(
      backtestId,
      parseInt(window),
      parseFloat(ql),
      parseFloat(qh)
    );
    
    if (!result) {
      return { ok: false, error: 'Backtest not found or not complete' };
    }
    
    return { ok: true, ...result };
  });
  
  /**
   * GET /api/analysis/rolling
   * Calculate rolling metrics (6m or 12m window)
   */
  fastify.get('/api/analysis/rolling', async (request) => {
    const { backtestId, window = '12m' } = request.query as { 
      backtestId?: string; 
      window?: '6m' | '12m';
    };
    
    if (!backtestId) {
      return { ok: false, error: 'Missing backtestId parameter' };
    }
    
    const result = await matrixService.calculateRolling(backtestId, window);
    
    if (!result) {
      return { ok: false, error: 'Backtest not found or not complete' };
    }
    
    return { ok: true, ...result };
  });
  
  /**
   * GET /api/analysis/performance-matrix
   * Full performance matrix with institutional gates
   */
  fastify.get('/api/analysis/performance-matrix', async (request) => {
    const { backtestId } = request.query as { backtestId?: string };
    
    if (!backtestId) {
      return { ok: false, error: 'Missing backtestId parameter' };
    }
    
    const result = await matrixService.calculateMatrix(backtestId);
    
    if (!result) {
      return { ok: false, error: 'Backtest not found or not complete' };
    }
    
    return { ok: true, ...result };
  });
  
  console.log('[P14] Analysis routes registered');
}
