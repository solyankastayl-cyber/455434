/**
 * QA Scenarios API Routes
 * 
 * Endpoints for running QA validation scenarios:
 * - GET /api/qa/run - Run all QA scenarios
 * - GET /api/qa/run/:id - Run specific scenario
 * - GET /api/qa/status - Get last QA run status
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  runAllQAScenarios,
  runQAScenario,
  QAScenarioId,
  QAReport,
} from './qa_scenarios.service.js';

// Store last QA report in memory (could be persisted to DB)
let lastQAReport: QAReport | null = null;

export async function qaRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/qa/run
   * Run all QA scenarios
   */
  app.get('/qa/run', async () => {
    try {
      const report = await runAllQAScenarios();
      lastQAReport = report;
      
      return {
        ok: true,
        data: report,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to run QA scenarios',
        details: err.message,
      };
    }
  });

  /**
   * GET /api/qa/run/:id
   * Run specific QA scenario
   */
  app.get('/qa/run/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const validIds: QAScenarioId[] = ['QA-1', 'QA-2', 'QA-3', 'QA-4'];
    if (!validIds.includes(id as QAScenarioId)) {
      return {
        ok: false,
        error: `Invalid scenario ID. Valid IDs: ${validIds.join(', ')}`,
      };
    }
    
    try {
      const result = await runQAScenario(id as QAScenarioId);
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: `Failed to run QA scenario ${id}`,
        details: err.message,
      };
    }
  });

  /**
   * GET /api/qa/status
   * Get last QA run status
   */
  app.get('/qa/status', async () => {
    if (!lastQAReport) {
      return {
        ok: true,
        data: {
          hasRun: false,
          message: 'No QA run yet. Use GET /api/qa/run to run scenarios.',
        },
      };
    }
    
    return {
      ok: true,
      data: {
        hasRun: true,
        lastRun: lastQAReport.runAt,
        overall: lastQAReport.overall,
        overallScore: lastQAReport.overallScore,
        summary: lastQAReport.summary,
        scenarioStatuses: lastQAReport.scenarios.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          score: s.score,
        })),
      },
    };
  });

  /**
   * GET /api/qa/baseline
   * Get current signal weights baseline (for Signal Reweighting v1.1)
   */
  app.get('/qa/baseline', async () => {
    // Return current signal configuration baseline
    const baseline = {
      rankingWeights: {
        marketCap: 0.20,
        volume: 0.15,
        momentum: 0.15,
        engineConfidence: 0.30,
        actorSignals: 0.20,
      },
      caps: {
        engineInfluence: 15,
        actorInfluence: 20,
      },
      decay: {
        engineHalfLife: 720,  // minutes
        actorHalfLife: 360,   // minutes
      },
      signalImpacts: {
        dexStrongInflow: { evidence: 15, direction: 10, risk: 0, threshold: 250000 },
        dexModerateInflow: { evidence: 8, direction: 5, risk: 0, threshold: 100000 },
        dexOutflow: { evidence: 0, direction: -10, risk: 5, threshold: -150000 },
        liquidityDrain: { evidence: -15, direction: 0, risk: 20, threshold: -15 },
        whaleAccumulation: { evidence: 20, direction: 15, risk: 0, confidence: 10 },
        whaleExit: { evidence: 0, direction: -20, risk: 15, confidence: 0 },
        repeatedWhaleExit: { evidence: 0, direction: 0, risk: 25, confidence: -20 },
        conflictMedium: { evidence: 0, direction: 0, risk: 0, confidence: -15, threshold: 0.4 },
        conflictHigh: { evidence: 0, direction: 0, risk: 20, confidence: -30, threshold: 0.6 },
        conflictCritical: { evidence: 0, direction: 0, risk: 30, confidence: -50, threshold: 0.7, forceNeutral: true },
      },
      bucketThresholds: {
        buy: { minScore: 70, minConfidence: 60, maxRisk: 40 },
        sell: { maxScore: 40, maxRisk: 60 },
      },
    };
    
    return {
      ok: true,
      data: baseline,
    };
  });

  app.log.info('[QA] Routes registered');
}
