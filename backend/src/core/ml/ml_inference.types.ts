/**
 * P3 ML Types
 * 
 * Type definitions for ML inference layer
 */

// ============================================
// ACTOR ML TYPES
// ============================================

export interface ActorFeatures {
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  roleScore: number;
  exchangeExposure: number;
  corridorDensity: number;
  corridorPersistence: number;
  volatility: number;
}

export type ActorClass = 'SMART' | 'NEUTRAL' | 'NOISY';

export interface ActorPrediction {
  actorId: string;
  network: string;
  prediction: {
    class: ActorClass;
    score: number;
    confidence: number;
    probs: number[];
  };
  featuresUsed: ActorFeatures;
  modelVersion: string;
}

// ============================================
// MARKET ML TYPES
// ============================================

export interface MarketFeatures {
  exchangePressure: number;
  accZoneStrength: number;
  distZoneStrength: number;
  corridorsEntropy: number;
  marketRegime: string;
}

export type MarketPriceLabel = 'STRONG_UP' | 'UP' | 'FLAT' | 'DOWN' | 'STRONG_DOWN';

export interface MarketPrediction {
  network: string;
  timeBucket: number;
  pUp: number;
  pDown: number;
  confidence: number;
  mlSignal: 'BUY' | 'SELL' | 'NEUTRAL';
  modelVersion: string;
}

// ============================================
// SIGNAL ENSEMBLE TYPES
// ============================================

export type SignalSide = 'BUY' | 'SELL' | 'NEUTRAL';
export type SignalStrength = 'WEAK' | 'MEDIUM' | 'STRONG';

export interface SignalComponent {
  value: number;
  weight: number;
  contribution: number;
  modelVersion?: string;
}

export interface MarketSignal {
  network: string;
  window: '1h' | '4h' | '24h' | '7d';
  side: SignalSide;
  strength: SignalStrength;
  score: number;
  confidence: number;
  components: {
    exchangePressure: SignalComponent;
    zones: SignalComponent;
    mlMarket: SignalComponent;
    smartMoney?: SignalComponent;
  };
  reasons: string[];
  createdAtTs: number;
}

// ============================================
// MODEL ARTIFACTS
// ============================================

export interface LoadedModel {
  version: string;
  weights: number[];
  bias: number;
  classes: string[];
}

export interface MarketModelArtifacts {
  modelPath: string;
  featureColumns: string[];
  version: string;
}
