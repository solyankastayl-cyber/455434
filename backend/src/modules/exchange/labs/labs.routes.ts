/**
 * S10.LABS — Research & Analytics API Routes
 * 
 * Read-only research endpoints.
 * NO signals, NO predictions — statistics only.
 */

import { FastifyInstance } from 'fastify';
import {
  calculateRegimeForward,
  ensureLabsIndexes,
} from './regime-forward.service.js';
import {
  calculateRegimeAttribution,
} from './regime-attribution.service.js';
import {
  calculatePatternRisk,
} from './pattern-risk.service.js';
import {
  getInteractionSummary,
  getInteractionMatrix,
  getFailureAnalysis,
} from './sentiment-interaction.service.js';
import {
  getWhaleRiskSummary,
  getWhaleRiskCases,
  getWhaleRiskMatrix,
} from './whale-risk.service.js';
import {
  Horizon,
  Window,
  RegimeSource,
  StressMetric,
} from './labs.types.js';
import { RegimeType } from '../observation/observation.types.js';
import { IndicatorCategory } from '../indicators/indicator.types.js';

export async function labsRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Ensure indexes on startup
  await ensureLabsIndexes();
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/regime-forward
  // LABS-01: Regime → Forward Outcome
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizon?: string;
      window?: string;
      regimeSource?: string;
      minStabilityTicks?: string;
      stressMetric?: string;
      bucketSize?: string;
    };
  }>(
    '/api/v10/exchange/labs/regime-forward',
    async (request) => {
      const {
        symbol = 'BTCUSDT',
        horizon = '1h',
        window = '7d',
        regimeSource = 'indicator',
        minStabilityTicks = '5',
        stressMetric = 'marketStress',
        bucketSize = '10',
      } = request.query;
      
      // Validate horizon
      const validHorizons: Horizon[] = ['5m', '15m', '1h', '4h', '24h'];
      if (!validHorizons.includes(horizon as Horizon)) {
        return {
          ok: false,
          error: `Invalid horizon. Valid: ${validHorizons.join(', ')}`,
        };
      }
      
      // Validate window
      const validWindows: Window[] = ['24h', '7d', '30d'];
      if (!validWindows.includes(window as Window)) {
        return {
          ok: false,
          error: `Invalid window. Valid: ${validWindows.join(', ')}`,
        };
      }
      
      // Validate regimeSource
      const validSources: RegimeSource[] = ['indicator', 'legacy', 'dual'];
      if (!validSources.includes(regimeSource as RegimeSource)) {
        return {
          ok: false,
          error: `Invalid regimeSource. Valid: ${validSources.join(', ')}`,
        };
      }
      
      // Validate stressMetric
      const validMetrics: StressMetric[] = ['marketStress', 'orderbookPressure', 'positionCrowding'];
      if (!validMetrics.includes(stressMetric as StressMetric)) {
        return {
          ok: false,
          error: `Invalid stressMetric. Valid: ${validMetrics.join(', ')}`,
        };
      }
      
      const result = await calculateRegimeForward({
        symbol: symbol.toUpperCase(),
        horizon: horizon as Horizon,
        window: window as Window,
        regimeSource: regimeSource as RegimeSource,
        minStabilityTicks: parseInt(minStabilityTicks) || 5,
        stressMetric: stressMetric as StressMetric,
        bucketSize: parseInt(bucketSize) || 10,
      });
      
      return result;
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/health
  // Health check for LABS module
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/labs/health', async () => {
    return {
      ok: true,
      module: 'S10.LABS',
      version: '1.0',
      features: ['regime-forward', 'regime-attribution', 'pattern-risk', 'sentiment-interaction'],
      status: 'active',
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/regime-attribution
  // LABS-02: Indicator → Regime Attribution
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      fromRegime?: string;
      toRegime?: string;
      horizon?: string;
      window?: string;
      indicatorCategory?: string;
      minSamples?: string;
    };
  }>(
    '/api/v10/exchange/labs/regime-attribution',
    async (request) => {
      const {
        symbol = 'BTCUSDT',
        fromRegime,
        toRegime,
        horizon = '1h',
        window = '7d',
        indicatorCategory,
        minSamples = '5',
      } = request.query;
      
      // Validate horizon
      const validHorizons: Horizon[] = ['5m', '15m', '1h', '4h', '24h'];
      if (!validHorizons.includes(horizon as Horizon)) {
        return {
          ok: false,
          error: `Invalid horizon. Valid: ${validHorizons.join(', ')}`,
        };
      }
      
      // Validate window
      const validWindows: Window[] = ['24h', '7d', '30d'];
      if (!validWindows.includes(window as Window)) {
        return {
          ok: false,
          error: `Invalid window. Valid: ${validWindows.join(', ')}`,
        };
      }
      
      // Validate indicator category if provided
      const validCategories: IndicatorCategory[] = ['PRICE_STRUCTURE', 'MOMENTUM', 'VOLUME', 'ORDER_BOOK', 'POSITIONING'];
      if (indicatorCategory && !validCategories.includes(indicatorCategory as IndicatorCategory)) {
        return {
          ok: false,
          error: `Invalid indicatorCategory. Valid: ${validCategories.join(', ')}`,
        };
      }
      
      const result = await calculateRegimeAttribution({
        symbol: symbol.toUpperCase(),
        fromRegime: fromRegime as RegimeType | undefined,
        toRegime: toRegime as RegimeType | undefined,
        horizon: horizon as Horizon,
        window: window as Window,
        indicatorCategory: indicatorCategory as IndicatorCategory | undefined,
        minSamples: parseInt(minSamples) || 5,
      });
      
      return result;
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/pattern-risk
  // LABS-03: Pattern → Cascade Risk
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      pattern?: string;
      horizon?: string;
      window?: string;
      regimeFilter?: string;
      minSamples?: string;
    };
  }>(
    '/api/v10/exchange/labs/pattern-risk',
    async (request) => {
      const {
        symbol = 'BTCUSDT',
        pattern,
        horizon = '1h',
        window = '7d',
        regimeFilter,
        minSamples = '5',
      } = request.query;
      
      // Validate horizon
      const validHorizons: Horizon[] = ['5m', '15m', '1h', '4h', '24h'];
      if (!validHorizons.includes(horizon as Horizon)) {
        return {
          ok: false,
          error: `Invalid horizon. Valid: ${validHorizons.join(', ')}`,
        };
      }
      
      // Validate window
      const validWindows: Window[] = ['24h', '7d', '30d'];
      if (!validWindows.includes(window as Window)) {
        return {
          ok: false,
          error: `Invalid window. Valid: ${validWindows.join(', ')}`,
        };
      }
      
      const result = await calculatePatternRisk({
        symbol: symbol.toUpperCase(),
        pattern,
        horizon: horizon as Horizon,
        window: window as Window,
        regimeFilter: regimeFilter as RegimeType | undefined,
        minSamples: parseInt(minSamples) || 5,
      });
      
      return result;
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/sentiment-interaction/summary
  // LABS-04: Exchange × Sentiment Interaction Summary
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizon?: string;
      window?: string;
      regimeFilter?: string;
      sentimentLabel?: string;
    };
  }>(
    '/api/v10/exchange/labs/sentiment-interaction/summary',
    async (request) => {
      const {
        symbol = 'BTCUSDT',
        horizon = '1h',
        window = '7d',
        regimeFilter,
        sentimentLabel,
      } = request.query;
      
      const validHorizons: Horizon[] = ['5m', '15m', '1h', '4h', '24h'];
      if (!validHorizons.includes(horizon as Horizon)) {
        return { ok: false, error: `Invalid horizon` };
      }
      
      const validWindows: Window[] = ['24h', '7d', '30d'];
      if (!validWindows.includes(window as Window)) {
        return { ok: false, error: `Invalid window` };
      }
      
      return getInteractionSummary({
        symbol: symbol.toUpperCase(),
        horizon: horizon as Horizon,
        window: window as Window,
        regimeFilter: regimeFilter as RegimeType | undefined,
        sentimentLabel: sentimentLabel as any,
      });
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/sentiment-interaction/matrix
  // LABS-04: Regime × Sentiment Interaction Matrix
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizon?: string;
      window?: string;
    };
  }>(
    '/api/v10/exchange/labs/sentiment-interaction/matrix',
    async (request) => {
      const {
        symbol = 'BTCUSDT',
        horizon = '1h',
        window = '7d',
      } = request.query;
      
      return getInteractionMatrix({
        symbol: symbol.toUpperCase(),
        horizon: horizon as Horizon,
        window: window as Window,
      });
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/sentiment-interaction/failures
  // LABS-04: Where Sentiment Fails Analysis
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizon?: string;
      window?: string;
    };
  }>(
    '/api/v10/exchange/labs/sentiment-interaction/failures',
    async (request) => {
      const {
        symbol = 'BTCUSDT',
        horizon = '1h',
        window = '7d',
      } = request.query;
      
      return getFailureAnalysis({
        symbol: symbol.toUpperCase(),
        horizon: horizon as Horizon,
        window: window as Window,
      });
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/whale-risk/summary
  // LABS-05: Whale Risk Analysis Summary
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizon?: string;
      window?: string;
      pattern?: string;
      riskThreshold?: string;
      regimeFilter?: string;
    };
  }>(
    '/api/v10/exchange/labs/whale-risk/summary',
    async (request) => {
      const {
        symbol,
        horizon = '15m',
        window = '2000',
        pattern = 'ALL',
        riskThreshold = '0.7',
        regimeFilter,
      } = request.query;
      
      const validHorizons = ['5m', '15m', '1h', '4h'];
      if (!validHorizons.includes(horizon)) {
        return { ok: false, error: `Invalid horizon. Valid: ${validHorizons.join(', ')}` };
      }
      
      const result = await getWhaleRiskSummary({
        symbol: symbol?.toUpperCase(),
        horizon: horizon as '5m' | '15m' | '1h' | '4h',
        window: parseInt(window),
        pattern: pattern as any,
        riskThreshold: parseFloat(riskThreshold),
        regimeFilter,
      });
      
      return { ok: true, ...result };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/whale-risk/cases
  // LABS-05: Whale Risk Cases (examples)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizon?: string;
      window?: string;
      pattern?: string;
      bucket?: string;
      limit?: string;
    };
  }>(
    '/api/v10/exchange/labs/whale-risk/cases',
    async (request) => {
      const {
        symbol,
        horizon = '15m',
        window = '500',
        pattern = 'ALL',
        bucket = 'HIGH',
        limit = '20',
      } = request.query;
      
      const result = await getWhaleRiskCases({
        symbol: symbol?.toUpperCase(),
        horizon: horizon as '5m' | '15m' | '1h' | '4h',
        window: parseInt(window),
        pattern: pattern as any,
        bucket: bucket as 'LOW' | 'MID' | 'HIGH',
        limit: parseInt(limit),
      });
      
      return { ok: true, ...result };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/labs/whale-risk/matrix
  // LABS-05: Whale Risk Matrix (heatmap)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      symbol?: string;
      horizons?: string;
      window?: string;
      pattern?: string;
    };
  }>(
    '/api/v10/exchange/labs/whale-risk/matrix',
    async (request) => {
      const {
        symbol,
        horizons = '5m,15m,1h,4h',
        window = '2000',
        pattern = 'ALL',
      } = request.query;
      
      const result = await getWhaleRiskMatrix({
        symbol: symbol?.toUpperCase(),
        horizons: horizons.split(','),
        window: parseInt(window),
        pattern: pattern as any,
      });
      
      return { ok: true, matrix: result };
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // LABS v3 CANONICAL API
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/exchange/labs/v3/all - Get all 18 Labs snapshot
  fastify.get<{
    Querystring: {
      symbol?: string;
      timeframe?: string;
    };
  }>(
    '/api/v10/exchange/labs/v3/all',
    async (request) => {
      const { symbol = 'BTCUSDT', timeframe = '15m' } = request.query;
      
      const { calculateAllLabs, summarizeLabs } = await import('./labs-canonical.service.js');
      const snapshot = await calculateAllLabs(symbol.toUpperCase(), timeframe);
      const summary = summarizeLabs(snapshot);
      
      return {
        ok: true,
        snapshot,
        summary,
      };
    }
  );
  
  // GET /api/v10/exchange/labs/v3/:labName - Get single Lab
  fastify.get<{
    Params: { labName: string };
    Querystring: {
      symbol?: string;
      timeframe?: string;
    };
  }>(
    '/api/v10/exchange/labs/v3/:labName',
    async (request) => {
      const { labName } = request.params;
      const { symbol = 'BTCUSDT', timeframe = '15m' } = request.query;
      
      const service = await import('./labs-canonical.service.js');
      
      const labMap: Record<string, Function> = {
        'regime': service.calculateRegimeLab,
        'volatility': service.calculateVolatilityLab,
        'liquidity': service.calculateLiquidityLab,
        'marketStress': service.calculateMarketStressLab,
        'volume': service.calculateVolumeLab,
        'flow': service.calculateFlowLab,
        'momentum': service.calculateMomentumLab,
        'participation': service.calculateParticipationLab,
        'whale': service.calculateWhaleLab,
        'accumulation': service.calculateAccumulationLab,
        'manipulation': service.calculateManipulationLab,
        'liquidation': service.calculateLiquidationLab,
        'corridor': service.calculateCorridorLab,
        'supportResistance': service.calculateSupportResistanceLab,
        'priceAcceptance': service.calculatePriceAcceptanceLab,
        'dataQuality': service.calculateDataQualityLab,
        'stability': service.calculateStabilityLab,
      };
      
      const calculator = labMap[labName];
      if (!calculator) {
        return {
          ok: false,
          error: `Unknown lab: ${labName}. Valid labs: ${Object.keys(labMap).join(', ')}`,
        };
      }
      
      const result = await calculator(symbol.toUpperCase(), timeframe);
      return { ok: true, data: result };
    }
  );
  
  // GET /api/v10/exchange/labs/v3/groups - Get labs grouped by category
  fastify.get('/api/v10/exchange/labs/v3/groups', async () => {
    const { LAB_GROUPS, LAB_GROUP_NAMES } = await import('./labs-canonical.types.js');
    return {
      ok: true,
      groups: LAB_GROUPS,
      names: LAB_GROUP_NAMES,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // LABS ALERTING API
  // ═══════════════════════════════════════════════════════════════

  // GET /api/v10/exchange/labs/v3/alerts - Get active alerts
  fastify.get<{
    Querystring: { symbol?: string };
  }>(
    '/api/v10/exchange/labs/v3/alerts',
    async (request) => {
      const { symbol } = request.query;
      const { getActiveAlerts, getAlertCounts } = await import('./labs-alerting.service.js');
      
      const alerts = getActiveAlerts(symbol);
      const counts = getAlertCounts(symbol);
      
      return {
        ok: true,
        alerts,
        counts,
        total: alerts.length,
      };
    }
  );

  // POST /api/v10/exchange/labs/v3/alerts/check - Check Labs and generate alerts
  fastify.post<{
    Querystring: { symbol?: string };
  }>(
    '/api/v10/exchange/labs/v3/alerts/check',
    async (request) => {
      const { symbol = 'BTCUSDT' } = request.query;
      
      const { calculateAllLabs } = await import('./labs-canonical.service.js');
      const { processLabsForAlerts, getActiveAlerts, getAlertCounts } = await import('./labs-alerting.service.js');
      
      // Calculate all Labs
      const snapshot = await calculateAllLabs(symbol.toUpperCase());
      
      // Process for alerts
      const newAlerts = processLabsForAlerts(snapshot);
      const allAlerts = getActiveAlerts(symbol);
      const counts = getAlertCounts(symbol);
      
      return {
        ok: true,
        newAlerts,
        activeAlerts: allAlerts,
        counts,
        snapshot: snapshot.timestamp,
      };
    }
  );

  // POST /api/v10/exchange/labs/v3/alerts/:alertId/ack - Acknowledge alert
  fastify.post<{
    Params: { alertId: string };
  }>(
    '/api/v10/exchange/labs/v3/alerts/:alertId/ack',
    async (request) => {
      const { alertId } = request.params;
      const { acknowledgeAlert } = await import('./labs-alerting.service.js');
      
      const success = acknowledgeAlert(alertId);
      return { ok: success };
    }
  );

  // GET /api/v10/exchange/labs/v3/alerts/history - Get alert history
  fastify.get<{
    Querystring: { symbol?: string; limit?: string };
  }>(
    '/api/v10/exchange/labs/v3/alerts/history',
    async (request) => {
      const { symbol, limit = '50' } = request.query;
      const { getAlertHistory } = await import('./labs-alerting.service.js');
      
      const history = getAlertHistory(symbol, parseInt(limit));
      return { ok: true, history };
    }
  );

  // GET /api/v10/exchange/labs/v3/historical - Get historical stats
  fastify.get<{
    Querystring: { symbol?: string; period?: string };
  }>(
    '/api/v10/exchange/labs/v3/historical',
    async (request) => {
      const { symbol = 'BTCUSDT', period = '24h' } = request.query;
      const { getHistoricalStats } = await import('./labs-historical.service.js');
      
      const stats = await getHistoricalStats(symbol.toUpperCase(), period as any);
      return { ok: !!stats, stats };
    }
  );
  
  console.log('[S10.LABS] API routes registered: /api/v10/exchange/labs/* (including v3 canonical + alerting)');
}

export default labsRoutes;
