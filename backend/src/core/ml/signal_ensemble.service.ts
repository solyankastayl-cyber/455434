/**
 * P3.2 Signal Ensemble Service
 * 
 * Combines Exchange Pressure + Zones + ML into final signal
 * ML enhances but doesn't replace rule-based signals
 */

import { SIGNAL_ENSEMBLE_CONFIG as C } from './signal_ensemble.config.js';
import { MarketPredictService } from './market_predict.service.js';
import { FeatureMarketModel } from '../features/feature.models.js';
import type { MarketSignal, SignalSide, SignalStrength, SignalComponent } from './ml_inference.types.js';

/**
 * Clamp value to 0-1 range
 */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Get exchange pressure component
 */
async function getExchangePressure(
  network: string, 
  window: string
): Promise<{ value: number; confidence: number }> {
  const feature = await FeatureMarketModel
    .findOne({ network })
    .sort({ bucketTs: -1 })
    .lean();
  
  if (!feature) {
    return { value: 0, confidence: C.defaultConfidence };
  }
  
  // Exchange pressure: negative = buy pressure, positive = sell pressure
  // We invert it so positive = bullish signal
  const pressure = -(feature.cexPressure?.pressure?.w24h || 0);
  
  // Confidence based on volume (more data = more confident)
  const totalFlow = (feature.cexPressure?.cexInUsd?.w24h || 0) + 
                    (feature.cexPressure?.cexOutUsd?.w24h || 0);
  const confidence = clamp01(Math.log1p(totalFlow) / 10);
  
  return { value: pressure, confidence };
}

/**
 * Get zones signal component
 */
async function getZonesSignal(
  network: string, 
  window: string
): Promise<{ value: number; confidence: number }> {
  const feature = await FeatureMarketModel
    .findOne({ network })
    .sort({ bucketTs: -1 })
    .lean();
  
  if (!feature) {
    return { value: 0, confidence: C.defaultConfidence };
  }
  
  // Zone signal: accStrength - distStrength, normalized to [-1, 1]
  const acc = feature.zones?.accumulationStrength?.w7d || 0.5;
  const dist = feature.zones?.distributionStrength?.w7d || 0.5;
  
  // Value: positive = accumulation dominates (bullish)
  const value = (acc - dist) * 2; // scale to ~[-1, 1]
  
  // Confidence based on strength difference
  const confidence = clamp01(0.5 + Math.abs(acc - dist));
  
  return { value, confidence };
}

/**
 * Get ML market signal component
 */
async function getMlMarketSignal(
  network: string, 
  window: string
): Promise<{ value: number; confidence: number; modelVersion: string }> {
  const prediction = await MarketPredictService.predict(network);
  
  // Convert probability to [-1, 1] signal
  // pUp = 0.5 -> value = 0
  // pUp = 1.0 -> value = 1
  // pUp = 0.0 -> value = -1
  const value = (prediction.pUp - 0.5) * 2;
  
  return {
    value,
    confidence: prediction.confidence,
    modelVersion: prediction.modelVersion,
  };
}

export class SignalEnsembleService {
  
  /**
   * Build combined market signal
   */
  static async build(
    network: string, 
    window: MarketSignal['window'] = '24h'
  ): Promise<MarketSignal> {
    // Fetch all components in parallel
    const [ex, zn, ml] = await Promise.all([
      getExchangePressure(network, window),
      getZonesSignal(network, window),
      getMlMarketSignal(network, window),
    ]);
    
    const w = C.weights;
    
    // Build components with contributions
    const components = {
      exchangePressure: { 
        value: ex.value, 
        weight: w.exchangePressure, 
        contribution: ex.value * w.exchangePressure 
      } as SignalComponent,
      zones: { 
        value: zn.value, 
        weight: w.zones, 
        contribution: zn.value * w.zones 
      } as SignalComponent,
      mlMarket: { 
        value: ml.value, 
        weight: w.mlMarket, 
        contribution: ml.value * w.mlMarket,
        modelVersion: ml.modelVersion,
      } as SignalComponent,
    };
    
    // Calculate ensemble score
    const score = 
      components.exchangePressure.contribution +
      components.zones.contribution +
      components.mlMarket.contribution;
    
    // Calculate ensemble confidence
    const avgCompConf = (ex.confidence + zn.confidence + ml.confidence) / 3;
    const confidence = clamp01(0.5 * Math.abs(score) + 0.5 * avgCompConf);
    
    // Determine signal side
    const side: SignalSide = 
      score >= C.thresholds.side.buy ? 'BUY' :
      score <= C.thresholds.side.sell ? 'SELL' :
      'NEUTRAL';
    
    // Determine signal strength
    const absScore = Math.abs(score);
    const strength: SignalStrength = 
      absScore >= C.thresholds.strength.strong ? 'STRONG' :
      absScore >= C.thresholds.strength.medium ? 'MEDIUM' :
      'WEAK';
    
    // Build reasons
    const reasons = this.buildReasons(components, score);
    
    return {
      network,
      window,
      side,
      strength,
      score: Math.round(score * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      components,
      reasons,
      createdAtTs: Math.floor(Date.now() / 1000),
    };
  }
  
  /**
   * Build human-readable reasons for signal
   */
  private static buildReasons(
    components: MarketSignal['components'], 
    score: number
  ): string[] {
    const reasons: string[] = [];
    const cfg = C.interpretation;
    
    // Find dominant contributor
    const sorted = Object.entries(components)
      .sort((a, b) => Math.abs(b[1].contribution) - Math.abs(a[1].contribution));
    
    const [topKey, topVal] = sorted[0];
    reasons.push(`Top driver: ${topKey} (contribution=${topVal.contribution.toFixed(3)})`);
    
    // Exchange pressure interpretation
    if (Math.abs(components.exchangePressure.value) > cfg.exchangePressure.strong) {
      reasons.push(
        components.exchangePressure.value > 0 
          ? cfg.exchangePressure.description.negative  // inverted: positive value = buy signal
          : cfg.exchangePressure.description.positive
      );
    }
    
    // Zones interpretation
    if (Math.abs(components.zones.value) > cfg.zones.strong) {
      reasons.push(
        components.zones.value > 0 
          ? cfg.zones.description.positive 
          : cfg.zones.description.negative
      );
    }
    
    // ML interpretation
    if (Math.abs(components.mlMarket.value) > cfg.mlMarket.strong) {
      reasons.push(
        components.mlMarket.value > 0 
          ? cfg.mlMarket.description.positive 
          : cfg.mlMarket.description.negative
      );
    }
    
    reasons.push(`Ensemble score=${score.toFixed(3)}`);
    
    return reasons;
  }
  
  /**
   * Get signals for all networks
   */
  static async buildAll(
    window: MarketSignal['window'] = '24h'
  ): Promise<Record<string, MarketSignal>> {
    const networks = [
      'ethereum', 'arbitrum', 'optimism', 'base', 
      'polygon', 'bnb', 'zksync', 'scroll'
    ];
    
    const results: Record<string, MarketSignal> = {};
    
    for (const network of networks) {
      results[network] = await this.build(network, window);
    }
    
    return results;
  }
}

export default SignalEnsembleService;
