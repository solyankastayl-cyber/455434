/**
 * Exchange Monitor Routes
 * =======================
 * 
 * v4.8.0 - Read-only monitoring endpoints for Capital Monitor widget.
 * 
 * Endpoints:
 * - GET /api/admin/exchange-ml/monitor/summary - Capital metrics + exposure + lifecycle
 * - GET /api/admin/exchange-ml/monitor/equity - Equity curve data
 * - GET /api/admin/exchange-ml/monitor/risk - Risk status alert
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Db } from 'mongodb';
import { EXCHANGE_CONFIG_SNAPSHOT_V1, getFreezeStatus, EXCHANGE_FROZEN } from '../config/exchange_freeze_config.js';
import { tagRegimeFromHistory } from './regime_tagger.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface MonitorSummary {
  capital: {
    equity: number;
    peak: number;
    maxDrawdownPct: number;
    sharpeLike: number;
    expectancyPct: number;
    tradeWinRate: number;
  };
  exposure: {
    activePositions: number;
    maxAllowed: number;
    cooldownActive: boolean;
    lastEntryAt: string | null;
  };
  lifecycle: {
    rollbacks365d: number;
    promotions365d: number;
    lastRollbackAt: string | null;
    lastPromotionAt: string | null;
  };
  regime: {
    current: 'BULL' | 'BEAR' | 'CHOP' | 'UNKNOWN';
    confidence: number;
  };
  freeze: {
    frozen: boolean;
    version: string;
  };
}

interface EquityPoint {
  date: string;
  equity: number;
  drawdownPct: number;
}

interface RiskStatus {
  status: 'OK' | 'WARNING' | 'CRITICAL';
  reasons: string[];
}

// ═══════════════════════════════════════════════════════════════
// ROUTES REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerExchangeMonitorRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/admin/exchange-ml/monitor/summary
   * 
   * Returns comprehensive monitoring summary for Capital Monitor widget.
   */
  app.get('/api/admin/exchange-ml/monitor/summary', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Load latest simulation report
      const fs = await import('fs/promises');
      const path = await import('path');
      
      let reportData: any = null;
      const reportsDir = '/app/reports/exchange-sim';
      
      try {
        const files = await fs.readdir(reportsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
        if (jsonFiles.length > 0) {
          const latestReport = path.join(reportsDir, jsonFiles[0]);
          const content = await fs.readFile(latestReport, 'utf-8');
          reportData = JSON.parse(content);
        }
      } catch (e) {
        // Reports dir may not exist yet
      }
      
      // Extract capital metrics from report
      const cm = reportData?.capitalMetrics || {};
      const agg = cm.aggregate || {};
      
      const summary: MonitorSummary = {
        capital: {
          equity: 1 + (agg.expectancy || 0) * (cm.totalTrades || 0),
          peak: 1 + Math.max(0, (agg.expectancy || 0) * (cm.totalTrades || 0)),
          maxDrawdownPct: (agg.maxDD || 0) * 100,
          sharpeLike: agg.sharpeLike || 0,
          expectancyPct: (agg.expectancy || 0) * 100,
          tradeWinRate: (agg.winRate || 0) * 100,
        },
        exposure: {
          activePositions: 0, // Would need real-time tracking in production
          maxAllowed: EXCHANGE_CONFIG_SNAPSHOT_V1.concurrency.maxActive['30D'],
          cooldownActive: false,
          lastEntryAt: null,
        },
        lifecycle: {
          rollbacks365d: reportData?.metrics?.lifecycle?.rollbackCount || 0,
          promotions365d: reportData?.metrics?.lifecycle?.promotionCount || 0,
          lastRollbackAt: null,
          lastPromotionAt: null,
        },
        regime: {
          current: 'UNKNOWN',
          confidence: 0,
        },
        freeze: {
          frozen: EXCHANGE_FROZEN,
          version: EXCHANGE_CONFIG_SNAPSHOT_V1.version,
        },
      };
      
      return {
        ok: true,
        data: summary,
        reportFile: reportData ? 'loaded' : 'not_found',
      };
    } catch (error: any) {
      console.error('[ExchangeMonitor] Error getting summary:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/exchange-ml/monitor/equity
   * 
   * Returns equity curve data for mini chart.
   */
  app.get('/api/admin/exchange-ml/monitor/equity', async (
    req: FastifyRequest<{ Querystring: { days?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const days = Number(req.query.days || 365);
      
      // Load latest simulation report
      const fs = await import('fs/promises');
      const path = await import('path');
      
      let dailyMetrics: any[] = [];
      const reportsDir = '/app/reports/exchange-sim';
      
      try {
        const files = await fs.readdir(reportsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
        if (jsonFiles.length > 0) {
          const latestReport = path.join(reportsDir, jsonFiles[0]);
          const content = await fs.readFile(latestReport, 'utf-8');
          const reportData = JSON.parse(content);
          dailyMetrics = reportData.dailyMetrics || [];
        }
      } catch (e) {
        // Reports dir may not exist
      }
      
      // Build equity curve from daily metrics
      const equityCurve: EquityPoint[] = [];
      let equity = 1.0;
      let peak = 1.0;
      
      for (const day of dailyMetrics.slice(-days)) {
        // Estimate daily PnL from wins/losses
        const dailyPnl = (day.wins - day.losses) * 0.002; // Simplified
        equity *= (1 + dailyPnl);
        peak = Math.max(peak, equity);
        const dd = (peak - equity) / peak;
        
        equityCurve.push({
          date: day.date,
          equity: Number((equity * 10000).toFixed(2)), // Scale to $10k base
          drawdownPct: Number((dd * 100).toFixed(2)),
        });
      }
      
      return {
        ok: true,
        data: equityCurve,
        meta: {
          days: equityCurve.length,
          startEquity: 10000,
          endEquity: equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000,
          maxDD: Math.max(...equityCurve.map(p => p.drawdownPct), 0),
        },
      };
    } catch (error: any) {
      console.error('[ExchangeMonitor] Error getting equity:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/exchange-ml/monitor/risk
   * 
   * Returns current risk status for alerts.
   */
  app.get('/api/admin/exchange-ml/monitor/risk', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Load latest simulation report
      const fs = await import('fs/promises');
      const path = await import('path');
      
      let capitalMetrics: any = null;
      const reportsDir = '/app/reports/exchange-sim';
      
      try {
        const files = await fs.readdir(reportsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
        if (jsonFiles.length > 0) {
          const latestReport = path.join(reportsDir, jsonFiles[0]);
          const content = await fs.readFile(latestReport, 'utf-8');
          const reportData = JSON.parse(content);
          capitalMetrics = reportData.capitalMetrics;
        }
      } catch (e) {
        // Reports dir may not exist
      }
      
      const reasons: string[] = [];
      let status: RiskStatus['status'] = 'OK';
      
      if (capitalMetrics) {
        const maxDD = capitalMetrics.aggregate?.maxDD || 0;
        
        // Check MaxDD
        if (maxDD > 0.35) {
          status = 'CRITICAL';
          reasons.push(`MaxDD=${(maxDD * 100).toFixed(1)}% > 35% threshold`);
        } else if (maxDD > 0.25) {
          status = 'WARNING';
          reasons.push(`MaxDD=${(maxDD * 100).toFixed(1)}% > 25% target`);
        }
        
        // Check win rate
        const winRate = capitalMetrics.aggregate?.winRate || 0;
        if (winRate < 0.45) {
          if (status !== 'CRITICAL') status = 'WARNING';
          reasons.push(`WinRate=${(winRate * 100).toFixed(1)}% < 45%`);
        }
        
        // Check Sharpe
        const sharpe = capitalMetrics.aggregate?.sharpeLike || 0;
        if (sharpe < 0) {
          if (status !== 'CRITICAL') status = 'WARNING';
          reasons.push(`Sharpe=${sharpe.toFixed(2)} < 0`);
        }
      } else {
        status = 'WARNING';
        reasons.push('No simulation data available');
      }
      
      if (reasons.length === 0) {
        reasons.push('All metrics within acceptable range');
      }
      
      const response: RiskStatus = { status, reasons };
      
      return {
        ok: true,
        data: response,
      };
    } catch (error: any) {
      console.error('[ExchangeMonitor] Error getting risk:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/exchange-ml/monitor/config
   * 
   * Returns frozen configuration snapshot.
   */
  app.get('/api/admin/exchange-ml/monitor/config', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      return {
        ok: true,
        data: {
          ...getFreezeStatus(),
          config: EXCHANGE_CONFIG_SNAPSHOT_V1,
        },
      };
    } catch (error: any) {
      console.error('[ExchangeMonitor] Error getting config:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  console.log('[ExchangeMonitor] Monitor routes registered');
}
