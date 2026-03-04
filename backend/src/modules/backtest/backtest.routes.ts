/**
 * BACKTEST ROUTES (P0 Updated)
 * 
 * API endpoints for backtest runner:
 * - POST /api/backtest/macro-score/v3/run-async
 * - GET /api/backtest/macro-score/v3/status/:id
 * - GET /api/backtest/macro-score/v3/report/:id
 * 
 * P0 Changes:
 * - dataMode parameter (mock/mongo)
 * - coveragePct/missingSeries/dataModeUsed in meta
 * - Integration with MacroDataProvider
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  buildAsOfTimeline,
  createReport,
  finalizeReport,
  saveReport,
  getReport,
  listReports,
  BacktestConfig,
  BacktestPoint,
} from './backtest_runner.service.js';
import {
  computeMacroScoreV3,
  SeriesData,
} from '../macro-score-v3/macro_score.service.js';
import { getMacroDataProvider, DataMode, DataProviderMeta } from '../macro-score-v3/data/macro_data_provider.js';

// ═══════════════════════════════════════════════════════════════
// EXTENDED CONTRACTS
// ═══════════════════════════════════════════════════════════════

interface BacktestConfigExtended extends BacktestConfig {
  dataMode?: DataMode;
  windowDays?: number;
}

interface BacktestMeta {
  dataMode: DataMode;
  coveragePct: number;
  missingSeries: string[];
  totalAsOfPoints: number;
  avgCoveragePerPoint: number;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerBacktestRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * Start async backtest run
   */
  app.post('/api/backtest/macro-score/v3/run-async', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      startDate?: string;
      endDate?: string;
      step?: 'daily' | 'weekly' | 'monthly';
      horizons?: number[];
      asset?: string;
      dataMode?: DataMode;
      windowDays?: number;
    };
    
    const config: BacktestConfigExtended = {
      startDate: body.startDate || '2020-01-01',
      endDate: body.endDate || '2024-12-31',
      step: body.step || 'weekly',
      horizons: body.horizons || [30, 90, 180],
      asset: body.asset || 'DXY',
      dataMode: body.dataMode || (process.env.MACRO_DATA_MODE as DataMode) || 'mock',
      windowDays: body.windowDays || 365,
    };
    
    // Create report
    const report = createReport(config);
    saveReport(report);
    
    // Start async processing (non-blocking)
    runBacktestAsync(report.id, config).catch(err => {
      console.error('[Backtest] Error:', err);
      const failedReport = getReport(report.id);
      if (failedReport) {
        failedReport.status = 'failed';
        failedReport.error = err.message;
        saveReport(failedReport);
      }
    });
    
    return reply.send({
      ok: true,
      id: report.id,
      message: 'Backtest started',
      totalPoints: report.totalPoints,
      dataMode: config.dataMode,
    });
  });
  
  /**
   * Get backtest status
   */
  app.get('/api/backtest/macro-score/v3/status/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const report = getReport(id);
    
    if (!report) {
      return reply.status(404).send({ ok: false, error: 'Backtest not found' });
    }
    
    return reply.send({
      ok: true,
      id: report.id,
      status: report.status,
      progress: report.progress,
      pointsProcessed: report.pointsProcessed,
      totalPoints: report.totalPoints,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    });
  });
  
  /**
   * Get backtest report
   */
  app.get('/api/backtest/macro-score/v3/report/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { includeTimeline = 'false' } = request.query as { includeTimeline?: string };
    const report = getReport(id);
    
    if (!report) {
      return reply.status(404).send({ ok: false, error: 'Backtest not found' });
    }
    
    if (report.status !== 'completed') {
      return reply.send({
        ok: true,
        id: report.id,
        status: report.status,
        message: 'Backtest not yet completed',
      });
    }
    
    // Optionally exclude timeline for smaller response
    const response: any = {
      ok: true,
      id: report.id,
      status: report.status,
      config: report.config,
      metrics: report.metrics,
      meta: (report as any).meta, // P0: Include meta
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      pointsProcessed: report.pointsProcessed,
    };
    
    if (includeTimeline === 'true') {
      response.timeline = report.timeline;
    }
    
    return reply.send(response);
  });
  
  /**
   * List all backtests
   */
  app.get('/api/backtest/macro-score/v3/list', async (_request: FastifyRequest, reply: FastifyReply) => {
    const reports = listReports();
    
    return reply.send({
      ok: true,
      count: reports.length,
      reports: reports.map(r => ({
        id: r.id,
        status: r.status,
        progress: r.progress,
        config: r.config,
        meta: (r as any).meta,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  });
  
  console.log('[Backtest] Routes registered at /api/backtest/macro-score/v3/*');
  console.log('[Backtest] P0: dataMode parameter enabled (mock/mongo)');
}

// ═══════════════════════════════════════════════════════════════
// ASYNC RUNNER (P0 Updated)
// ═══════════════════════════════════════════════════════════════

async function runBacktestAsync(
  reportId: string, 
  config: BacktestConfigExtended
): Promise<void> {
  const timeline = buildAsOfTimeline(config.startDate, config.endDate, config.step);
  const points: BacktestPoint[] = [];
  
  // P0: Use MacroDataProvider instead of direct mock
  const dataProvider = getMacroDataProvider();
  const dataMode = config.dataMode || 'mock';
  const windowDays = config.windowDays || 365;
  
  // Track coverage across all asOf points
  let totalCoverageSum = 0;
  const allMissingSeries = new Set<string>();
  
  console.log(`[Backtest ${reportId}] Starting with dataMode=${dataMode}, points=${timeline.length}`);
  
  for (let i = 0; i < timeline.length; i++) {
    const asOf = timeline[i];
    
    try {
      // P0: Get data through provider (respects dataMode)
      const { seriesData, meta } = await dataProvider.getData(asOf, { 
        dataMode, 
        windowDays 
      });
      
      // Track coverage
      totalCoverageSum += meta.coveragePct;
      meta.missingSeries.forEach(s => allMissingSeries.add(s));
      
      // Compute MacroScore for this asOf
      const result = await computeMacroScoreV3(
        seriesData,
        asOf,
        config.asset,
        90 // Default horizon for score computation
      );
      
      // Determine scenario from score
      let scenario = 'NEUTRAL';
      if (result.score > 0.2) scenario = 'BULLISH';
      else if (result.score < -0.2) scenario = 'BEARISH';
      else if (result.confidence < 0.3) scenario = 'UNCERTAIN';
      
      // Build predictions (simplified: use score as proxy)
      const predictions: Record<number, number> = {};
      for (const h of config.horizons) {
        predictions[h] = result.score * (h / 90); // Scale by horizon
      }
      
      points.push({
        asOf,
        macroScore: result.score,
        macroConfidence: result.confidence,
        drivers: result.drivers.map(d => d.name),
        scenario,
        predictions,
      });
    } catch (e) {
      // Skip failed points but continue
      console.warn(`[Backtest ${reportId}] Failed for ${asOf}:`, e);
    }
    
    // Update progress
    const report = getReport(reportId);
    if (report) {
      report.progress = Math.round((i + 1) / timeline.length * 100);
      report.pointsProcessed = i + 1;
      saveReport(report);
    }
    
    // Log progress every 50 points
    if ((i + 1) % 50 === 0) {
      console.log(`[Backtest ${reportId}] Progress: ${i + 1}/${timeline.length}`);
    }
  }
  
  // P0: Build meta with coverage info
  const backtestMeta: BacktestMeta = {
    dataMode,
    coveragePct: totalCoverageSum / timeline.length,
    missingSeries: Array.from(allMissingSeries),
    totalAsOfPoints: timeline.length,
    avgCoveragePerPoint: totalCoverageSum / timeline.length,
  };
  
  // Finalize report
  const report = getReport(reportId);
  if (report) {
    const finalReport = finalizeReport(report, points);
    (finalReport as any).meta = backtestMeta; // P0: Attach meta
    saveReport(finalReport);
    
    console.log(`[Backtest ${reportId}] Completed. Coverage: ${(backtestMeta.coveragePct * 100).toFixed(1)}%`);
  }
}

export default registerBacktestRoutes;
