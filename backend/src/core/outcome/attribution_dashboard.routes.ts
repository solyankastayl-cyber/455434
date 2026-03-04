/**
 * Attribution Dashboard Routes (Block F3.5)
 * 
 * API endpoints for the Attribution Analytics Dashboard
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getAttributionDashboard,
  getSignalEffectiveness,
  getConfidenceCalibration,
  getBucketPerformanceTimeline,
  verifyMLReadyChecklist,
} from './attribution_dashboard.service.js';
import {
  runOutcomeSimulation,
  getSimulationStats,
  clearSimulatedData,
  generateSyntheticBuySamples,
} from './outcome_simulator.service.js';

export async function attributionDashboardRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/attribution/dashboard
   * Get complete attribution dashboard data
   */
  app.get('/attribution/dashboard', async () => {
    try {
      const data = await getAttributionDashboard();
      
      return {
        ok: true,
        data,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get attribution dashboard',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/attribution/signals/effectiveness
   * Get signal effectiveness metrics
   */
  app.get('/attribution/signals/effectiveness', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    
    try {
      const windowDays = parseInt(query.days || '30');
      const data = await getSignalEffectiveness(windowDays);
      
      return {
        ok: true,
        data: {
          signals: data,
          windowDays,
          count: data.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get signal effectiveness',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/attribution/confidence/calibration
   * Get confidence calibration analysis
   */
  app.get('/attribution/confidence/calibration', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    
    try {
      const windowDays = parseInt(query.days || '30');
      const data = await getConfidenceCalibration(windowDays);
      
      return {
        ok: true,
        data: {
          calibration: data,
          windowDays,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get confidence calibration',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/attribution/performance/timeline
   * Get bucket performance over time
   */
  app.get('/attribution/performance/timeline', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    
    try {
      const windowDays = parseInt(query.days || '14');
      const data = await getBucketPerformanceTimeline(windowDays);
      
      return {
        ok: true,
        data: {
          timeline: data,
          windowDays,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get performance timeline',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/attribution/ml-ready
   * Verify ML READY checklist
   */
  app.get('/attribution/ml-ready', async () => {
    try {
      const checklist = await verifyMLReadyChecklist();
      
      return {
        ok: true,
        data: checklist,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to verify ML ready checklist',
        details: err.message,
      };
    }
  });
  
  // ============================================================
  // BLOCK S - SIMULATION API
  // ============================================================
  
  /**
   * POST /api/simulation/run
   * Run outcome simulation to generate data quickly
   */
  app.post('/simulation/run', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    try {
      const windowHours = parseInt(query.window || '24') as 24 | 72 | 168;
      if (![24, 72, 168].includes(windowHours)) {
        return {
          ok: false,
          error: 'Invalid window. Use 24, 72, or 168',
        };
      }
      
      const stats = await runOutcomeSimulation(windowHours);
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Simulation failed',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/simulation/stats
   * Get simulation vs live data statistics
   */
  app.get('/simulation/stats', async () => {
    try {
      const stats = await getSimulationStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get simulation stats',
        details: err.message,
      };
    }
  });
  
  /**
   * DELETE /api/simulation/clear
   * Clear all simulated data (reset)
   */
  app.delete('/simulation/clear', async () => {
    try {
      const result = await clearSimulatedData();
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to clear simulated data',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/simulation/synthetic-buy
   * Generate synthetic BUY samples for ML training diversity
   * 
   * Problem: Real system rarely produces BUY bucket (conservative thresholds)
   * Solution: Create realistic synthetic BUY samples
   */
  app.post('/simulation/synthetic-buy', async (request: FastifyRequest) => {
    const query = request.query as { count?: string; successRate?: string };
    
    try {
      const count = Math.min(500, Math.max(50, parseInt(query.count || '200')));
      const successRate = Math.min(0.8, Math.max(0.4, parseFloat(query.successRate || '0.6')));
      
      const result = await generateSyntheticBuySamples(count, successRate);
      
      return {
        ok: true,
        data: result,
        message: `Generated ${result.created} synthetic BUY samples for ML training diversity`,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to generate synthetic BUY samples',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Attribution Dashboard] F3.5 + Block S routes registered');
}
