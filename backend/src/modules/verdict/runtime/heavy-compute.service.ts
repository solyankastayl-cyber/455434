/**
 * HEAVY COMPUTE SERVICE
 * =====================
 * 
 * P3: Smart Caching Layer - Block 1
 * Encapsulates all heavy ML computations that should be cached.
 * 
 * This service wraps the existing Verdict Engine pipeline:
 * - Feature extraction
 * - ML model inference (1D, 7D, 30D)
 * - Verdict Engine evaluation (Rules + MetaBrain + Calibration + Health)
 * 
 * The output is a HeavyVerdictPayload that can be cached and reused.
 */

import type { HeavyVerdictPayload, ForecastHorizon } from './heavy-verdict.types.js';
import type { VerdictContext, Verdict, Horizon, ModelOutput, MarketSnapshot } from '../contracts/verdict.types.js';
import { VerdictEngineImpl } from './verdict.engine.impl.js';
import { IntelligenceMetaBrainAdapter } from './intelligence.meta.adapter.js';
import { ShadowHealthAdapter } from '../adapters/shadow-health.adapter.js';
import { CredibilityService } from '../../evolution/runtime/credibility.service.js';
import { Model1D } from '../../ml/runtime/model.1d.js';
import { Model7D } from '../../ml/runtime/model.7d.js';
import { Model30D } from '../../ml/runtime/model.30d.js';
import { getPriceChartData } from '../../chart/services/price.service.js';

// Initialize ML models (singleton)
const model1d = new Model1D();
const model7d = new Model7D();
const model30d = new Model30D();

// Initialize services (singleton)
let verdictEngine: VerdictEngineImpl | null = null;

function getVerdictEngine(): VerdictEngineImpl {
  if (!verdictEngine) {
    const metaBrain = new IntelligenceMetaBrainAdapter();
    const credibilityService = new CredibilityService();
    const healthPort = new ShadowHealthAdapter();
    
    verdictEngine = new VerdictEngineImpl(
      metaBrain,
      { getConfidenceModifier: (args) => credibilityService.getConfidenceModifier(args) },
      healthPort
    );
  }
  return verdictEngine;
}

/**
 * Build features from price data for ML models
 */
function buildFeatures(pricePoints: Array<{ ts: number; price: number; volume?: number }>): Record<string, number> {
  if (!pricePoints || pricePoints.length < 10) {
    return { momentum_1d: 0, volatility_1d: 0.02, rsi: 50, volume_change: 0 };
  }
  
  const prices = pricePoints.map(p => p.price);
  const volumes = pricePoints.map(p => p.volume || 0);
  
  // Calculate momentum (24h price change)
  const recent = prices.slice(-24);
  const momentum = recent.length >= 2 
    ? (recent[recent.length - 1] - recent[0]) / recent[0]
    : 0;
  
  // Calculate volatility (std dev of returns)
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    returns.push((recent[i] - recent[i-1]) / recent[i-1]);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 0 
    ? returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length
    : 0;
  const volatility = Math.sqrt(variance) || 0.02;
  
  // Simple RSI approximation
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i-1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const rs = losses > 0 ? gains / losses : 100;
  const rsi = 100 - (100 / (1 + rs));
  
  // Volume change
  const recentVol = volumes.slice(-24);
  const prevVol = volumes.slice(-48, -24);
  const avgRecentVol = recentVol.length > 0 ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length : 1;
  const avgPrevVol = prevVol.length > 0 ? prevVol.reduce((a, b) => a + b, 0) / prevVol.length : avgRecentVol;
  const volumeChange = avgPrevVol > 0 ? (avgRecentVol - avgPrevVol) / avgPrevVol : 0;
  
  // Long-term features
  const prices7d = prices.slice(-168);
  const momentum7d = prices7d.length >= 2 
    ? (prices7d[prices7d.length - 1] - prices7d[0]) / prices7d[0]
    : momentum;
  
  const prices30d = prices.slice(-720);
  const momentum30d = prices30d.length >= 2 
    ? (prices30d[prices30d.length - 1] - prices30d[0]) / prices30d[0]
    : momentum7d;
  
  // Volume growth over 7 days
  const vol7d = volumes.slice(-168);
  const vol7dFirst = vol7d.slice(0, 84).reduce((a, b) => a + b, 0) / 84 || 1;
  const vol7dLast = vol7d.slice(-84).reduce((a, b) => a + b, 0) / 84 || vol7dFirst;
  const volumeGrowth7d = vol7dFirst > 0 ? (vol7dLast - vol7dFirst) / vol7dFirst : 0;
  
  // Fear & Greed proxy
  const fearGreed = Math.max(0, Math.min(100, 50 + rsi - 50 + momentum * 100));
  
  return {
    momentum_1d: momentum,
    volatility_1d: volatility,
    rsi,
    volume_change: volumeChange,
    momentum_7d: momentum7d,
    trend_7d: momentum7d,
    volume_growth_7d: volumeGrowth7d,
    macd: momentum - momentum7d * 0.5,
    regime_score: Math.abs(momentum7d) > 0.05 ? 0.7 : 0.3,
    momentum_30d: momentum30d,
    trend_30d: momentum30d,
    macro_bias: momentum30d > 0.1 ? 0.5 : momentum30d < -0.1 ? -0.5 : 0,
    btc_dominance: 50,
    fear_greed: fearGreed,
    trend_strength: Math.abs(momentum) * 10,
    mean_reversion: rsi > 70 ? -0.02 : rsi < 30 ? 0.02 : 0,
  };
}

/**
 * Run all ML models and get predictions
 */
async function getModelOutputs(
  symbol: string, 
  features: Record<string, number>,
  ts: string
): Promise<ModelOutput[]> {
  const [pred1d, pred7d, pred30d] = await Promise.all([
    model1d.predict({ symbol, features, ts }),
    model7d.predict({ symbol, features, ts }),
    model30d.predict({ symbol, features, ts }),
  ]);
  
  return [
    {
      horizon: '1D' as Horizon,
      expectedReturn: pred1d.expectedReturn,
      confidenceRaw: pred1d.confidence,
      modelId: pred1d.modelId,
    },
    {
      horizon: '7D' as Horizon,
      expectedReturn: pred7d.expectedReturn,
      confidenceRaw: pred7d.confidence,
      modelId: pred7d.modelId,
    },
    {
      horizon: '30D' as Horizon,
      expectedReturn: pred30d.expectedReturn,
      confidenceRaw: pred30d.confidence,
      modelId: pred30d.modelId,
    },
  ];
}

export class HeavyComputeService {
  /**
   * Compute heavy verdict for a symbol and horizon
   * This is the expensive operation that gets cached
   */
  async compute(
    symbol: string, 
    horizon: ForecastHorizon
  ): Promise<HeavyVerdictPayload> {
    const t0 = Date.now();
    const symbolNorm = symbol.toUpperCase();
    const symbolFull = symbolNorm.includes('USDT') ? symbolNorm : `${symbolNorm}USDT`;
    
    console.log(`[HeavyCompute] Starting compute for ${symbolNorm}/${horizon}...`);
    
    try {
      // 1. Fetch price data (use 30d range for comprehensive features)
      const priceData = await getPriceChartData(symbolFull, '30d', '1h');
      const lastPrice = priceData.points?.[priceData.points.length - 1]?.price || 0;
      const nowIso = new Date().toISOString();
      
      // 2. Build features from price history
      const features = buildFeatures(priceData.points);
      
      // 3. Get model predictions for all horizons
      const modelOutputs = await getModelOutputs(symbolFull, features, nowIso);
      
      // 4. Build market snapshot
      const snapshot: MarketSnapshot = {
        symbol: symbolFull,
        ts: nowIso,
        price: lastPrice,
        volatility: features.volatility_1d,
        regime: features.momentum_1d > 0.02 ? 'TREND_UP' : 
                features.momentum_1d < -0.02 ? 'TREND_DOWN' : 'RANGE',
      };
      
      // 5. Build verdict context
      const verdictCtx: VerdictContext = {
        snapshot,
        outputs: modelOutputs,
        metaBrain: { invariantsEnabled: true },
      };
      
      // 6. Evaluate verdict using the engine (HEAVY PART)
      const engine = getVerdictEngine();
      const verdict = await engine.evaluate(verdictCtx);
      
      const computeMs = Date.now() - t0;
      
      // Build all horizon candidates for UI
      const candidates = modelOutputs.map(out => {
        const candDirection = out.expectedReturn > 0 ? 'UP' : out.expectedReturn < 0 ? 'DOWN' : 'FLAT';
        const candAction = out.expectedReturn > 0 && out.confidenceRaw > 0.5 ? 'BUY' :
                          out.expectedReturn < 0 && out.confidenceRaw > 0.5 ? 'SELL' : 'HOLD';
        return {
          horizon: out.horizon,
          modelId: out.modelId,
          direction: candDirection,
          expectedReturn: out.expectedReturn,
          confidence: out.confidenceRaw,
          action: candAction,
          isSelected: out.horizon === verdict.horizon,
        };
      });
      
      const payload: HeavyVerdictPayload = {
        symbol: symbolNorm,
        horizon,
        verdict,
        candidates,
        layers: {
          features,
          snapshot,
        },
        computedAt: nowIso,
        computeMs,
      };
      
      console.log(`[HeavyCompute] Done ${symbolNorm}/${horizon} in ${computeMs}ms, action=${verdict.action}`);
      
      return payload;
    } catch (error: any) {
      const computeMs = Date.now() - t0;
      console.error(`[HeavyCompute] Error for ${symbolNorm}/${horizon}: ${error.message}`);
      
      // Return a minimal error payload
      return {
        symbol: symbolNorm,
        horizon,
        verdict: {
          action: 'HOLD',
          confidence: 0,
          expectedReturn: 0,
          risk: 'HIGH',
          error: error.message,
        },
        computedAt: new Date().toISOString(),
        computeMs,
      };
    }
  }
}

// Singleton instance
export const heavyComputeService = new HeavyComputeService();

console.log('[HeavyComputeService] Module loaded');
