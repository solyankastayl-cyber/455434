/**
 * PHASE 1.3 — Backfill Service
 * =============================
 * Historical data backfill with rate limiting
 */

import { randomUUID } from 'crypto';
import { BackfillRequest, BackfillProgress, BackfillState, BackfillCandle } from './backfill.types.js';
import { schedule, RATE_LIMITS } from '../../network/rateLimiter.js';
import { createBybitClient, createBinanceClient } from '../../network/httpClient.factory.js';
import { AxiosInstance } from 'axios';
import { timelineService } from '../../observability/services/timeline.service.js';
import { truthAnalyticsService } from '../../observability/services/truth.analytics.service.js';
import { mlDatasetBuilder } from '../../ml/services/ml.dataset.builder.js';

// In-memory storage for backfill runs
const runs = new Map<string, BackfillProgress>();

// Abort controllers for cancellation
const abortControllers = new Map<string, AbortController>();

const nowIso = () => new Date().toISOString();

// ═══════════════════════════════════════════════════════════════
// CANDLE FETCHERS (with rate limiting)
// ═══════════════════════════════════════════════════════════════

async function fetchBybitCandles(
  client: AxiosInstance,
  symbol: string,
  interval: string,
  start: number,
  end: number
): Promise<BackfillCandle[]> {
  // Bybit interval mapping
  const intervalMap: Record<string, string> = {
    '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D',
  };
  const bybitInterval = intervalMap[interval] || '5';
  
  const response = await schedule('BYBIT', () =>
    client.get('/v5/market/kline', {
      params: {
        category: 'linear',
        symbol,
        interval: bybitInterval,
        start,
        end,
        limit: 200,
      },
    })
  );
  
  const data = response.data;
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  
  const list = data?.result?.list ?? [];
  
  // Bybit returns DESC, we need ASC
  return list
    .map((row: string[]) => ({
      ts: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .sort((a: BackfillCandle, b: BackfillCandle) => a.ts - b.ts);
}

async function fetchBinanceCandles(
  client: AxiosInstance,
  symbol: string,
  interval: string,
  start: number,
  end: number
): Promise<BackfillCandle[]> {
  const response = await schedule('BINANCE', () =>
    client.get('/fapi/v1/klines', {
      params: {
        symbol,
        interval,
        startTime: start,
        endTime: end,
        limit: 500,
      },
    })
  );
  
  return response.data.map((row: any[]) => ({
    ts: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

// ═══════════════════════════════════════════════════════════════
// BACKFILL SERVICE
// ═══════════════════════════════════════════════════════════════

class BackfillService {
  
  async start(request: BackfillRequest): Promise<{ runId: string }> {
    const runId = randomUUID();
    
    const timeframeMs = request.timeframe === '1m' ? 60_000 :
                        request.timeframe === '5m' ? 300_000 : 900_000;
    
    const barsPerDay = (24 * 60 * 60 * 1000) / timeframeMs;
    const barsTotal = request.symbols.length * request.days * barsPerDay;
    
    const progress: BackfillProgress = {
      runId,
      state: 'QUEUED',
      request,
      startedAt: nowIso(),
      progress: {
        symbolsTotal: request.symbols.length,
        symbolsDone: 0,
        barsTotal: Math.floor(barsTotal),
        barsProcessed: 0,
        observationsCreated: 0,
        truthsCreated: 0,
        errors: 0,
      },
    };
    
    runs.set(runId, progress);
    
    // Create abort controller
    const controller = new AbortController();
    abortControllers.set(runId, controller);
    
    // Emit start event
    timelineService.emit({
      type: 'BACKFILL_STARTED',
      severity: 'INFO',
      message: `Backfill started: ${request.symbols.join(',')} | ${request.days}d | ${request.timeframe}`,
      data: { runId, ...request },
    });
    
    // Fire and forget
    void this.runBackfill(runId, controller.signal).catch((err) => {
      console.error(`[Backfill] Run ${runId} failed:`, err.message);
    });
    
    return { runId };
  }
  
  async cancel(runId: string): Promise<BackfillProgress | null> {
    const controller = abortControllers.get(runId);
    if (controller) {
      controller.abort();
      abortControllers.delete(runId);
    }
    
    const progress = runs.get(runId);
    if (progress) {
      progress.state = 'CANCELLED';
      progress.finishedAt = nowIso();
    }
    
    return progress ?? null;
  }
  
  getStatus(runId: string): BackfillProgress | null {
    return runs.get(runId) ?? null;
  }
  
  listRuns(): BackfillProgress[] {
    return Array.from(runs.values()).sort((a, b) => 
      (b.startedAt ?? '').localeCompare(a.startedAt ?? '')
    );
  }
  
  // ─────────────────────────────────────────────────────────────
  // MAIN BACKFILL LOOP
  // ─────────────────────────────────────────────────────────────
  
  private async runBackfill(runId: string, signal: AbortSignal): Promise<void> {
    const progress = runs.get(runId);
    if (!progress) return;
    
    const { request } = progress;
    
    try {
      progress.state = 'RUNNING';
      
      // Create HTTP client based on provider
      const provider = request.provider ?? 'BYBIT';
      const client = provider === 'BINANCE'
        ? await createBinanceClient()
        : await createBybitClient();
      
      const fetchCandles = provider === 'BINANCE'
        ? fetchBinanceCandles
        : fetchBybitCandles;
      
      const timeframeMs = request.timeframe === '1m' ? 60_000 :
                          request.timeframe === '5m' ? 300_000 : 900_000;
      
      const horizonBars = request.horizonBars ?? 6;
      const now = Date.now();
      const startTime = now - request.days * 24 * 60 * 60 * 1000;
      
      console.log(`[Backfill] Starting ${runId}: ${request.symbols.join(',')} | ${request.days}d | ${request.timeframe}`);
      
      for (const symbol of request.symbols) {
        if (signal.aborted) break;
        
        progress.progress.currentSymbol = symbol;
        console.log(`[Backfill] Processing ${symbol}...`);
        
        // Collect all candles for this symbol
        const allCandles: BackfillCandle[] = [];
        
        // Fetch in chunks (200 bars per request)
        const chunkSize = 200 * timeframeMs;
        
        for (let t = startTime; t < now; t += chunkSize) {
          if (signal.aborted) break;
          
          try {
            const candles = await fetchCandles(
              client,
              symbol,
              request.timeframe,
              t,
              Math.min(t + chunkSize, now)
            );
            
            allCandles.push(...candles);
            progress.progress.barsProcessed += candles.length;
            progress.progress.lastBarTs = candles[candles.length - 1]?.ts;
            
            // Calculate ETA
            const elapsed = Date.now() - new Date(progress.startedAt!).getTime();
            const rate = progress.progress.barsProcessed / elapsed;
            const remaining = progress.progress.barsTotal - progress.progress.barsProcessed;
            if (rate > 0) {
              const etaMs = remaining / rate;
              progress.progress.eta = new Date(Date.now() + etaMs).toISOString();
            }
            
          } catch (err: any) {
            console.error(`[Backfill] Fetch error for ${symbol}:`, err.message);
            progress.progress.errors++;
            
            // Wait and retry on rate limit
            if (err.response?.status === 429) {
              console.log('[Backfill] Rate limited, waiting 5s...');
              await this.sleep(5000);
            }
          }
        }
        
        // Process candles into observations
        if (!request.dryRun && allCandles.length > 0) {
          await this.processCandles(runId, symbol, allCandles, horizonBars);
        }
        
        progress.progress.symbolsDone++;
      }
      
      progress.state = signal.aborted ? 'CANCELLED' : 'DONE';
      progress.finishedAt = nowIso();
      
      // Emit finished event
      timelineService.emit({
        type: 'BACKFILL_FINISHED',
        severity: 'INFO',
        message: `Backfill ${progress.state}: ${progress.progress.observationsCreated} obs, ${progress.progress.truthsCreated} truths`,
        data: {
          runId,
          state: progress.state,
          ...progress.progress,
        },
      });
      
      console.log(`[Backfill] Completed ${runId}: ${progress.progress.observationsCreated} observations, ${progress.progress.truthsCreated} truths`);
      
    } catch (err: any) {
      progress.state = 'FAILED';
      progress.finishedAt = nowIso();
      progress.lastError = err.message;
      console.error(`[Backfill] Failed ${runId}:`, err.message);
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // PROCESS CANDLES → OBSERVATIONS + TRUTH
  // ─────────────────────────────────────────────────────────────
  
  private async processCandles(
    runId: string,
    symbol: string,
    candles: BackfillCandle[],
    horizonBars: number
  ): Promise<void> {
    const progress = runs.get(runId);
    if (!progress) return;
    
    console.log(`[Backfill] Processing ${candles.length} candles for ${symbol}...`);
    
    // Minimum window for indicators
    const minWindow = 50;
    
    for (let i = minWindow; i < candles.length; i++) {
      const bar = candles[i];
      const window = candles.slice(Math.max(0, i - 200), i + 1);
      
      // Create observation (simplified for backfill)
      const observation = {
        symbol,
        timeframe: progress.request.timeframe,
        t0: bar.ts,
        price: {
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
        sourceMeta: {
          dataMode: 'BACKFILL' as const,
          providersUsed: [progress.request.provider ?? 'BYBIT'],
          backfill: true,
        },
        // Simplified indicators from candle data
        indicators: this.computeSimpleIndicators(window),
      };
      
      progress.progress.observationsCreated++;
      
      // Create truth if we have future data
      const futureIndex = i + horizonBars;
      if (futureIndex < candles.length) {
        const futureBar = candles[futureIndex];
        const priceChange = ((futureBar.close - bar.close) / bar.close) * 100;
        
        // Determine if prediction would be confirmed
        const actualDirection = priceChange > 0.5 ? 'BULLISH' : priceChange < -0.5 ? 'BEARISH' : 'NEUTRAL';
        const confirmed = actualDirection !== 'NEUTRAL' ? 1 : 0;
        
        // Record truth for analytics
        truthAnalyticsService.recordTruth({
          symbol,
          t0: bar.ts,
          t1: futureBar.ts,
          horizonBars,
          price0: bar.close,
          price1: futureBar.close,
        });
        
        // Save to ML dataset
        await mlDatasetBuilder.saveRow({
          symbol,
          t0: bar.ts,
          t1: futureBar.ts,
          horizonBars,
          features: observation.indicators,
          y: confirmed as 0 | 1,
          sourceMeta: {
            dataMode: 'LIVE',
            providers: [progress.request.provider ?? 'BYBIT'],
          },
        });
        
        progress.progress.truthsCreated++;
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // SIMPLE INDICATORS (for backfill)
  // ─────────────────────────────────────────────────────────────
  
  private computeSimpleIndicators(candles: BackfillCandle[]): Record<string, number> {
    if (candles.length < 20) return {};
    
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const last = closes[closes.length - 1];
    
    // Simple moving averages
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.length >= 50 
      ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 
      : sma20;
    
    // RSI (simplified)
    const changes = closes.slice(-15).map((c, i, arr) => 
      i > 0 ? c - arr[i - 1] : 0
    ).slice(1);
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / 14 : 0.001;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    // Volatility
    const returns = closes.slice(-20).map((c, i, arr) => 
      i > 0 ? (c - arr[i - 1]) / arr[i - 1] : 0
    ).slice(1);
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + r * r, 0) / returns.length
    ) * 100;
    
    // Volume ratio
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volumeRatio = volumes[volumes.length - 1] / avgVolume;
    
    return {
      sma20,
      sma50,
      rsi,
      volatility,
      volumeRatio,
      priceVsSma20: ((last - sma20) / sma20) * 100,
      priceVsSma50: ((last - sma50) / sma50) * 100,
      trend: sma20 > sma50 ? 1 : -1,
    };
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const backfillService = new BackfillService();

console.log('[Phase 1.3] Backfill Service loaded');
