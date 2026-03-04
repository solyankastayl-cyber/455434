/**
 * CANDLES API — TradingView-like OHLC data
 * 
 * Endpoint: GET /api/market/candles
 * 
 * Returns OHLC candlestick data with dynamic resolution based on time range.
 * This enables TradingView-like chart behavior with proper scaling.
 * 
 * Resolution mapping:
 *   1d  → 5m candles  (~288 bars)
 *   7d  → 15m candles (~672 bars)
 *   30d → 1h candles  (~720 bars)
 *   90d → 4h candles  (~540 bars)
 *   1y  → 1d candles  (~365 bars)
 */

import { FastifyInstance } from 'fastify';
import { getPriceHistory } from './price.service.js';

// ═══════════════════════════════════════════════════════════════
// RANGE → RESOLUTION MAPPING
// ═══════════════════════════════════════════════════════════════

type ChartRange = '1d' | '24h' | '7d' | '30d' | '90d' | '1y';
type Resolution = '5m' | '15m' | '1h' | '4h' | '1d';

const RANGE_TO_RESOLUTION: Record<ChartRange, Resolution> = {
  '1d': '5m',
  '24h': '5m',
  '7d': '15m',
  '30d': '1h',
  '90d': '4h',
  '1y': '1d',
};

const RANGE_TO_MS: Record<ChartRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

const RANGE_TO_LIMIT: Record<ChartRange, number> = {
  '1d': 300,   // ~288 bars for 5m
  '24h': 300,
  '7d': 700,   // ~672 bars for 15m
  '30d': 750,  // ~720 bars for 1h
  '90d': 600,  // ~540 bars for 4h
  '1y': 400,   // ~365 bars for 1d
};

// ═══════════════════════════════════════════════════════════════
// CANDLES ENDPOINT
// ═══════════════════════════════════════════════════════════════

export async function registerCandlesRoutes(app: FastifyInstance) {
  
  app.get('/api/market/candles', async (request, reply) => {
    const query = request.query as {
      symbol?: string;
      asset?: string;
      range?: string;
    };
    
    // Parse params
    const rawSymbol = query.symbol || query.asset || 'BTC';
    const symbol = rawSymbol.toUpperCase().replace('USDT', '') + 'USDT';
    const range = (query.range?.toLowerCase() || '7d') as ChartRange;
    
    // Validate range
    const validRanges: ChartRange[] = ['1d', '24h', '7d', '30d', '90d', '1y'];
    const chartRange: ChartRange = validRanges.includes(range as ChartRange) ? range as ChartRange : '7d';
    
    // Get resolution and time window
    const resolution = RANGE_TO_RESOLUTION[chartRange];
    const rangeMs = RANGE_TO_MS[chartRange];
    const limit = RANGE_TO_LIMIT[chartRange];
    
    const toTs = Date.now();
    const fromTs = toTs - rangeMs;
    
    console.log(`[Candles API] ${symbol} range=${chartRange} resolution=${resolution} limit=${limit}`);
    
    try {
      // Fetch OHLC data from price service
      const { bars, provider, dataMode } = await getPriceHistory({
        symbol,
        timeframe: resolution,
        from: fromTs,
        to: toTs,
        limit,
      });
      
      // Transform to lightweight-charts format (time in UNIX seconds)
      const candles = bars.map(bar => ({
        time: Math.floor(bar.ts / 1000),  // UNIX seconds (required by lightweight-charts)
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v || 0,
      }));
      
      // Prepare volume series (separate from candles for histogram)
      const volume = bars.map(bar => ({
        time: Math.floor(bar.ts / 1000),
        value: bar.v || 0,
        color: bar.c >= bar.o ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      }));
      
      return reply.send({
        ok: true,
        symbol: symbol.replace('USDT', ''),
        range: chartRange,
        resolution,
        provider,
        dataMode,
        candleCount: candles.length,
        candles,
        volume,
        meta: {
          fromTs,
          toTs,
          tz: 'UTC',
        },
      });
      
    } catch (error: any) {
      console.error(`[Candles API] Error:`, error.message);
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Failed to fetch candles',
      });
    }
  });
  
  console.log('[Candles API] Routes registered');
}

export default registerCandlesRoutes;
