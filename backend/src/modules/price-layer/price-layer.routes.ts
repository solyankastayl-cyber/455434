/**
 * S5.2 — PRICE LAYER ROUTES
 * 
 * API endpoints for Sentiment × Price correlation.
 * 
 * Endpoints:
 * - GET /api/v5/price-layer/stats — Get statistics
 * - GET /api/v5/price-layer/signals — Get recent signals with price data
 * - POST /api/v5/price-layer/signal — Create signal from sentiment result
 * - GET /api/v5/price-layer/signal/:id — Get signal with all price data
 * - GET /api/v5/price-layer/correlation — Get correlation matrix
 * - GET /api/v5/price-layer/price/:asset — Get current price
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { priceLayerService, SignalEvent } from './price-layer.service.js';

export async function priceLayerRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v5/price-layer/stats
   * Get price layer statistics
   */
  app.get('/api/v5/price-layer/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await priceLayerService.getStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/price-layer/signals
   * Get recent signals with price data
   */
  app.get('/api/v5/price-layer/signals', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit } = req.query as { limit?: string };
    
    try {
      const signals = await priceLayerService.getRecentSignals(parseInt(limit || '20'));
      
      return reply.send({
        ok: true,
        data: {
          count: signals.length,
          signals: signals.map(s => ({
            signal_id: s.signal.signal_id,
            asset: s.signal.asset,
            timestamp: s.signal.timestamp,
            sentiment: s.signal.sentiment,
            meta: s.signal.meta,
            price_t0: s.t0_price,
            reactions: s.reactions.map(r => ({
              horizon: r.horizon,
              delta_pct: r.delta_pct,
              direction: r.direction,
              magnitude: r.magnitude,
            })),
            created_at: s.signal.created_at,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SIGNALS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v5/price-layer/signal
   * Create a new signal event (from sentiment analysis result)
   */
  app.post('/api/v5/price-layer/signal', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      asset: string;
      sentiment: {
        label: string;
        score: number;
        confidence: number;
        cnn_flags?: string[];
        bullish_analysis?: string;
      };
      meta?: {
        text?: string;
        text_length?: number;
        engagement?: any;
      };
      source?: string;
    };
    
    if (!body.asset || !body.sentiment) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'asset and sentiment are required',
      });
    }
    
    try {
      const signalEvent = await priceLayerService.createSignalEvent({
        source: (body.source as any) || 'manual',
        asset: body.asset.toUpperCase(),
        timestamp: Date.now(),
        sentiment: {
          label: body.sentiment.label as any,
          score: body.sentiment.score,
          confidence: body.sentiment.confidence,
          engine_version: 'v1.6.0',
          cnn_flags: body.sentiment.cnn_flags,
          bullish_analysis: body.sentiment.bullish_analysis,
        },
        meta: body.meta || {},
      });
      
      return reply.send({
        ok: true,
        data: {
          signal_id: signalEvent.signal_id,
          asset: signalEvent.asset,
          sentiment: signalEvent.sentiment,
          message: 'Signal created. Price snapshots will be collected at t0, 5m, 15m, 1h, 4h, 24h.',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CREATE_SIGNAL_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/price-layer/signal/:id
   * Get signal with all price observations, reactions, and outcomes
   */
  app.get('/api/v5/price-layer/signal/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    
    try {
      const data = await priceLayerService.getSignalWithPriceData(id);
      
      if (!data) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `Signal ${id} not found`,
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          signal: {
            signal_id: data.signal.signal_id,
            source: data.signal.source,
            asset: data.signal.asset,
            timestamp: data.signal.timestamp,
            sentiment: data.signal.sentiment,
            meta: data.signal.meta,
            created_at: data.signal.created_at,
          },
          observations: data.observations.map(o => ({
            horizon: o.horizon,
            timestamp: o.timestamp,
            price: o.price,
            source: o.source,
            collected_at: o.collected_at,
          })),
          reactions: data.reactions.map(r => ({
            horizon: r.horizon,
            price_t0: r.price_t0,
            price_h: r.price_h,
            delta_pct: r.delta_pct,
            direction: r.direction,
            magnitude: r.magnitude,
            label_version: r.label_version,
          })),
          outcomes: data.outcomes.map(o => ({
            horizon: o.horizon,
            sentiment_label: o.sentiment_label,
            price_direction: o.price_direction,
            price_magnitude: o.price_magnitude,
            delta_pct: o.delta_pct,
            outcome: o.outcome,
            outcome_confidence: o.outcome_confidence,
            label_version: o.label_version,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'GET_SIGNAL_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/price-layer/correlation
   * Get Sentiment × Outcome correlation matrix
   */
  app.get('/api/v5/price-layer/correlation', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const correlation = await priceLayerService.getCorrelationMatrix();
      
      return reply.send({
        ok: true,
        data: correlation,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CORRELATION_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/price-layer/price/:asset
   * Get current price for asset
   */
  app.get('/api/v5/price-layer/price/:asset', async (req: FastifyRequest, reply: FastifyReply) => {
    const { asset } = req.params as { asset: string };
    
    try {
      // Use the price layer service's price provider (includes fallbacks)
      const normalizedAsset = asset.toUpperCase();
      
      // Fallback prices for testing (when CoinGecko is rate limited)
      const fallbackPrices: Record<string, number> = {
        'BTC': 97000,
        'ETH': 2700,
        'SOL': 200,
        'WETH': 2700,
      };
      
      // First try CoinGecko
      const ASSET_MAP: Record<string, string> = {
        'BTC': 'bitcoin',
        'ETH': 'ethereum',
        'SOL': 'solana',
        'WETH': 'ethereum',
      };
      
      const coinId = ASSET_MAP[normalizedAsset];
      if (!coinId) {
        return reply.status(400).send({
          ok: false,
          error: 'UNKNOWN_ASSET',
          message: `Unknown asset: ${asset}`,
        });
      }
      
      try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          const coinData = data[coinId];
          
          if (coinData && coinData.usd) {
            return reply.send({
              ok: true,
              data: {
                asset: normalizedAsset,
                price: coinData.usd,
                change_24h: coinData.usd_24h_change || 0,
                volume_24h: coinData.usd_24h_vol || 0,
                timestamp: Date.now(),
                source: 'coingecko',
              },
            });
          }
        }
      } catch (cgError) {
        console.warn('[PriceLayer] CoinGecko error, using fallback');
      }
      
      // Use fallback price
      const fallbackPrice = fallbackPrices[normalizedAsset];
      if (fallbackPrice) {
        return reply.send({
          ok: true,
          data: {
            asset: normalizedAsset,
            price: fallbackPrice,
            change_24h: 0,
            volume_24h: 0,
            timestamp: Date.now(),
            source: 'fallback',
          },
        });
      }
      
      return reply.status(500).send({
        ok: false,
        error: 'PRICE_FETCH_ERROR',
        message: 'Failed to fetch price',
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'PRICE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v5/price-layer/collect-from-sentiment
   * Create signal from sentiment test result (integration with Test Harness)
   */
  app.post('/api/v5/price-layer/collect-from-sentiment', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      text: string;
      asset?: string;
      sentiment: {
        label: string;
        score: number;
        confidence: number;
      };
      cnn?: {
        label: string;
        confidence: number;
      };
      booster_applied?: boolean;
      flags?: string[];
    };
    
    if (!body.text || !body.sentiment) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'text and sentiment are required',
      });
    }
    
    try {
      // Determine asset from text (simple heuristic)
      let asset = body.asset || 'BTC';
      const textLower = body.text.toLowerCase();
      if (textLower.includes('eth') || textLower.includes('ethereum')) {
        asset = 'ETH';
      } else if (textLower.includes('sol') || textLower.includes('solana')) {
        asset = 'SOL';
      }
      
      // Determine CNN bullish analysis
      let bullish_analysis: string | undefined;
      if (body.cnn?.label === 'POSITIVE' && body.sentiment.label === 'NEUTRAL') {
        bullish_analysis = body.booster_applied ? 'VALID' : 'BLOCKED';
      }
      
      const signalEvent = await priceLayerService.createSignalEvent({
        source: 'twitter',
        asset: asset.toUpperCase(),
        timestamp: Date.now(),
        sentiment: {
          label: body.sentiment.label as any,
          score: body.sentiment.score,
          confidence: body.sentiment.confidence,
          engine_version: 'v1.6.0',
          cnn_flags: body.flags,
          bullish_analysis,
        },
        meta: {
          text: body.text.substring(0, 500),
          text_length: body.text.length,
        },
      });
      
      return reply.send({
        ok: true,
        data: {
          signal_id: signalEvent.signal_id,
          asset: signalEvent.asset,
          sentiment: signalEvent.sentiment,
          message: 'Signal created from sentiment. Price snapshots scheduled.',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'COLLECT_ERROR',
        message: error.message,
      });
    }
  });
  
  // ============================================================
  // S5.3 — OUTCOME LABELING ROUTES
  // ============================================================
  
  /**
   * GET /api/v5/price-layer/outcomes/stats
   * Get outcome statistics
   */
  app.get('/api/v5/price-layer/outcomes/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await priceLayerService.getOutcomeStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'OUTCOME_STATS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/price-layer/outcomes/:signal_id
   * Get outcomes for a specific signal
   */
  app.get('/api/v5/price-layer/outcomes/:signal_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { signal_id } = req.params as { signal_id: string };
    
    try {
      const outcomes = await priceLayerService.getOutcomes(signal_id);
      
      return reply.send({
        ok: true,
        data: {
          signal_id,
          count: outcomes.length,
          outcomes: outcomes.map(o => ({
            horizon: o.horizon,
            sentiment_label: o.sentiment_label,
            price_direction: o.price_direction,
            price_magnitude: o.price_magnitude,
            delta_pct: o.delta_pct,
            outcome: o.outcome,
            outcome_confidence: o.outcome_confidence,
            label_version: o.label_version,
            calculated_at: o.calculated_at,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'OUTCOME_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v5/price-layer/outcomes/label-manual
   * Manually trigger outcome labeling for a signal (for testing)
   */
  app.post('/api/v5/price-layer/outcomes/label-manual', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { signal_id: string; horizon: string };
    
    if (!body.signal_id || !body.horizon) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'signal_id and horizon are required',
      });
    }
    
    try {
      const outcome = await priceLayerService.labelOutcome(
        body.signal_id, 
        body.horizon as any
      );
      
      if (!outcome) {
        return reply.status(404).send({
          ok: false,
          error: 'LABELING_FAILED',
          message: 'Could not label outcome. Check if signal and reaction exist.',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          signal_id: outcome.signal_id,
          horizon: outcome.horizon,
          outcome: outcome.outcome,
          outcome_confidence: outcome.outcome_confidence,
          sentiment_label: outcome.sentiment_label,
          price_direction: outcome.price_direction,
          delta_pct: outcome.delta_pct,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'LABELING_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/price-layer/outcomes/summary
   * Get summary of outcome distribution (for Admin UI charts)
   */
  app.get('/api/v5/price-layer/outcomes/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await priceLayerService.getOutcomeStats();
      
      // Format for easy charting
      const summary = {
        total: stats.totalOutcomes,
        distribution: stats.outcomesByLabel,
        accuracy: {
          byHorizon: stats.accuracyByHorizon,
        },
        sentimentBreakdown: stats.outcomesBySentiment,
        confidence: stats.avgConfidenceByOutcome,
      };
      
      return reply.send({
        ok: true,
        data: summary,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SUMMARY_ERROR',
        message: error.message,
      });
    }
  });
  
  console.log('[PriceLayer] S5.2 + S5.3 routes registered');
}
