/**
 * BLOCK 81 — Drift Intelligence Routes
 * 
 * API endpoints for institutional-grade drift analysis.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { driftIntelligenceService } from './drift-intelligence.service.js';
import { DriftIntelHistoryModel } from './drift-intel-history.model.js';

interface IntelQuery {
  symbol?: string;
  window?: string;
}

interface HistoryQuery {
  symbol?: string;
  days?: string;
}

export async function driftIntelligenceRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/drift/intelligence
   * 
   * Get full drift intelligence report (LIVE vs V2020 vs V2014)
   */
  fastify.get('/api/fractal/v2.1/admin/drift/intelligence', async (
    request: FastifyRequest<{ Querystring: IntelQuery }>
  ) => {
    const symbol = String(request.query.symbol ?? 'BTC');
    const windowDays = Number(request.query.window ?? 90);
    
    try {
      const result = await driftIntelligenceService.computeDriftIntelligence({
        symbol,
        windowDays,
      });
      
      return {
        ok: true,
        ...result,
      };
      
    } catch (err: any) {
      console.error('[DriftIntelligence] Error:', err.message);
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/drift/intelligence/history
   * 
   * Get drift intelligence timeline (for charts)
   */
  fastify.get('/api/fractal/v2.1/admin/drift/intelligence/history', async (
    request: FastifyRequest<{ Querystring: HistoryQuery }>
  ) => {
    const symbol = String(request.query.symbol ?? 'BTC');
    const days = Number(request.query.days ?? 30);
    
    try {
      const fromDate = new Date();
      fromDate.setUTCDate(fromDate.getUTCDate() - days);
      const fromDateStr = fromDate.toISOString().split('T')[0];
      
      const series = await DriftIntelHistoryModel.find({
        symbol,
        source: 'LIVE',
        date: { $gte: fromDateStr },
      })
        .sort({ date: 1 })
        .lean();
      
      // Compute stats
      const totalDays = series.length;
      const driftCounts = { OK: 0, WATCH: 0, WARN: 0, CRITICAL: 0 };
      let sumSharpe = 0;
      let sumHitRate = 0;
      
      for (const s of series) {
        const sev = s.severity as keyof typeof driftCounts;
        if (driftCounts[sev] !== undefined) {
          driftCounts[sev]++;
        }
        sumSharpe += s.dSharpe || 0;
        sumHitRate += s.dHitRate_pp || 0;
      }
      
      // 7-day trend
      let trend7d: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
      if (series.length >= 7) {
        const last7 = series.slice(-7);
        const firstSharpe = last7[0]?.dSharpe || 0;
        const lastSharpe = last7[last7.length - 1]?.dSharpe || 0;
        const diff = lastSharpe - firstSharpe;
        
        if (diff > 0.05) trend7d = 'UP';
        else if (diff < -0.05) trend7d = 'DOWN';
      }
      
      const stats = {
        totalDays,
        driftCounts,
        avgDeltaSharpe: totalDays > 0 ? sumSharpe / totalDays : 0,
        avgDeltaHitRate_pp: totalDays > 0 ? sumHitRate / totalDays : 0,
        trend7d,
      };
      
      return {
        ok: true,
        symbol,
        days,
        series: series.map(s => ({
          date: s.date,
          severity: s.severity,
          confidence: s.confidence,
          liveSamples: s.liveSamples,
          dHitRate_pp: s.dHitRate_pp,
          dSharpe: s.dSharpe,
          dCalibration_pp: s.dCalibration_pp,
          dMaxDD_pp: s.dMaxDD_pp,
          reasons: s.reasons || [],
        })),
        stats,
        latest: series.length > 0 ? series[series.length - 1] : null,
      };
      
    } catch (err: any) {
      console.error('[DriftIntelligence] History error:', err.message);
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/drift/intelligence/snapshot
   * 
   * Manually trigger drift intelligence snapshot write
   * (Also called from daily-run pipeline)
   */
  fastify.post('/api/fractal/v2.1/admin/drift/intelligence/snapshot', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ) => {
    const symbol = String(request.query.symbol ?? 'BTC');
    
    try {
      const intel = await driftIntelligenceService.computeDriftIntelligence({
        symbol,
        windowDays: 90,
      });
      
      const date = new Date().toISOString().split('T')[0];
      const delta = intel.deltas.LIVE_vs_V2020;
      
      await DriftIntelHistoryModel.updateOne(
        { symbol, date, source: 'LIVE' },
        {
          $set: {
            severity: intel.verdict.severity,
            confidence: intel.verdict.confidence,
            insufficientLiveTruth: intel.verdict.insufficientLiveTruth,
            liveSamples: intel.live.metrics.samples,
            dHitRate_pp: delta?.dHitRate_pp || 0,
            dSharpe: delta?.dSharpe || 0,
            dCalibration_pp: delta?.dCalibration_pp || 0,
            dMaxDD_pp: delta?.dMaxDD_pp || 0,
            baseline: 'V2020',
            reasons: intel.verdict.reasons,
            engineVersion: intel.meta.engineVersion,
          },
        },
        { upsert: true }
      );
      
      console.log(`[DriftIntelligence] Written snapshot for ${symbol} @ ${date}`);
      
      return {
        ok: true,
        written: true,
        date,
        severity: intel.verdict.severity,
        confidence: intel.verdict.confidence,
        liveSamples: intel.live.metrics.samples,
      };
      
    } catch (err: any) {
      console.error('[DriftIntelligence] Snapshot error:', err.message);
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 81: Drift Intelligence routes registered');
}

export default driftIntelligenceRoutes;
