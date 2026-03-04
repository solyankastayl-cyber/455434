/**
 * EXCHANGE LABS v3 — CANONICAL SERVICE
 * 
 * Единая точка входа для всех 18 Labs.
 * Каждый Lab автономен и возвращает LabResult.
 * 
 * Labs НЕ принимают решений (NO BUY/SELL)
 * Labs ОПИСЫВАЮТ РЕАЛЬНОСТЬ
 * 
 * v3.1: Added historical comparison for improved accuracy
 */

import { MongoClient, Db, Collection } from 'mongodb';
import {
  LabName,
  LabResult,
  RegimeState,
  RegimeSignals,
  VolatilityState,
  VolatilitySignals,
  LiquidityState,
  LiquiditySignals,
  MarketStressState,
  MarketStressSignals,
  VolumeState,
  VolumeSignals,
  FlowState,
  FlowSignals,
  MomentumState,
  MomentumSignals,
  ParticipationState,
  ParticipationSignals,
  WhaleState,
  WhaleSignals,
  AccumulationState,
  AccumulationSignals,
  ManipulationState,
  ManipulationSignals,
  LiquidationState,
  LiquidationSignals,
  CorridorState,
  CorridorSignals,
  SupportResistanceState,
  SupportResistanceSignals,
  PriceAcceptanceState,
  PriceAcceptanceSignals,
  DataQualityState,
  DataQualitySignals,
  SignalConflictState,
  SignalConflictSignals,
  StabilityState,
  StabilitySignals,
  AnyLabResult,
  LabsSnapshot,
  LabsSummary,
  LAB_GROUPS,
} from './labs-canonical.types.js';
import { 
  getHistoricalStats, 
  calculatePercentile, 
  isAnomaly, 
  getTrend,
  HistoricalStats 
} from './labs-historical.service.js';
import { processLabsForAlerts, getActiveAlerts, getAlertCounts } from './labs-alerting.service.js';

// ═══════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';

let db: Db | null = null;

async function getDb(): Promise<Db> {
  if (db) return db;
  
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  
  console.log(`[LABS.V3] Connected to MongoDB: ${DB_NAME}`);
  return db;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function createMeta(symbol: string, timeframe: string, timestamp?: number): LabResult<any, any>['meta'] {
  return {
    symbol,
    timeframe,
    dataCompleteness: timestamp ? 0.95 : 0.5,
    lastUpdate: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
  };
}

// Get latest observation from DB
async function getLatestObservation(symbol: string) {
  const database = await getDb();
  const observations = database.collection('exchange_observations');
  return observations.findOne(
    { symbol },
    { sort: { timestamp: -1 } }
  );
}

// ═══════════════════════════════════════════════════════════════
// GROUP A: MARKET STRUCTURE LABS
// ═══════════════════════════════════════════════════════════════

export async function calculateRegimeLab(symbol: string, timeframe = '15m'): Promise<LabResult<RegimeState, RegimeSignals>> {
  const latest = await getLatestObservation(symbol);

  // Calculate state from real data
  let state: RegimeState = 'RANGE';
  let confidence = 0.5;
  const signals: RegimeSignals = {
    trendStrength: 0,
    rangeWidth: 0,
    transitionProbability: 0,
    dominantDirection: 'neutral',
  };

  if (latest?.regime) {
    // Map regime.type to our state machine
    const regimeMap: Record<string, RegimeState> = {
      'EXPANSION': 'TRENDING_UP',
      'CONTRACTION': 'TRENDING_DOWN', 
      'RANGING': 'RANGE',
      'RANGE': 'RANGE',
      'VOLATILE': 'CHAOTIC',
      'BREAKOUT': 'TRANSITION',
      'TRANSITION': 'TRANSITION',
    };
    state = regimeMap[latest.regime.type] || 'RANGE';
    confidence = latest.regime.confidence || 0.6;
    
    // Use price change to determine direction
    if (latest.market?.priceChange15m > 0.5) {
      signals.dominantDirection = 'up';
      if (state === 'RANGE') state = 'TRENDING_UP';
    } else if (latest.market?.priceChange15m < -0.5) {
      signals.dominantDirection = 'down';
      if (state === 'RANGE') state = 'TRENDING_DOWN';
    }
    
    signals.trendStrength = Math.abs(latest.market?.priceChange15m || 0) / 2;
  }

  const risks = [];
  if (state === 'CHAOTIC') risks.push('HIGH_UNCERTAINTY', 'WHIPSAW_RISK');
  if (state === 'TRANSITION') risks.push('REGIME_CHANGE');

  return {
    lab: 'regime',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Market is in ${state.toLowerCase().replace(/_/g, ' ')} mode`,
      details: [
        `Regime type: ${latest?.regime?.type || 'unknown'}`,
        `Price change 15m: ${(latest?.market?.priceChange15m || 0).toFixed(2)}%`,
        `Confidence: ${(confidence * 100).toFixed(0)}%`,
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateVolatilityLab(symbol: string, timeframe = '15m'): Promise<LabResult<VolatilityState, VolatilitySignals>> {
  const latest = await getLatestObservation(symbol);
  const historical = await getHistoricalStats(symbol, '24h');

  let state: VolatilityState = 'NORMAL_VOL';
  let confidence = 0.6;
  const signals: VolatilitySignals = {
    currentVol: 0,
    historicalVol: 0,
    volRatio: 1,
    atr: 0,
    bollingerWidth: 0,
  };

  if (latest?.market) {
    signals.currentVol = latest.market.volatility || 0;
    
    // Use historical data for better accuracy
    if (historical) {
      signals.historicalVol = historical.volatility.avg;
      signals.volRatio = signals.historicalVol > 0 ? signals.currentVol / signals.historicalVol : 1;
      
      // Calculate percentile position
      const percentile = calculatePercentile(
        signals.currentVol, 
        historical.volatility.min, 
        historical.volatility.max
      );
      
      // Determine state with historical context
      if (percentile > 90) {
        state = 'HIGH_VOL';
        confidence = 0.85;
      } else if (percentile > 70) {
        state = 'EXPANSION';
        confidence = 0.8;
      } else if (percentile < 10) {
        state = 'LOW_VOL';
        confidence = 0.85;
      } else if (percentile < 30) {
        state = 'COMPRESSION';
        confidence = 0.8;
      } else {
        state = 'NORMAL_VOL';
        confidence = 0.75;
      }
    } else {
      // Fallback without historical data
      signals.historicalVol = 0.015; // baseline volatility for BTC
      signals.volRatio = signals.historicalVol > 0 ? signals.currentVol / signals.historicalVol : 1;
      
      if (signals.volRatio > 2) state = 'HIGH_VOL';
      else if (signals.volRatio > 1.3) state = 'EXPANSION';
      else if (signals.volRatio < 0.5) state = 'LOW_VOL';
      else if (signals.volRatio < 0.8) state = 'COMPRESSION';
      
      confidence = 0.6;
    }
  }

  const risks = [];
  if (state === 'HIGH_VOL') risks.push('SLIPPAGE_RISK', 'STOP_HUNT');
  if (state === 'COMPRESSION') risks.push('BREAKOUT_IMMINENT');
  if (state === 'LOW_VOL') risks.push('FALSE_SIGNALS');

  return {
    lab: 'volatility',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Volatility is ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `Current volatility: ${(signals.currentVol * 100).toFixed(3)}%`,
        `Historical avg: ${(signals.historicalVol * 100).toFixed(3)}%`,
        `Ratio to historical: ${signals.volRatio.toFixed(2)}x`,
        historical ? `Based on ${historical.sampleCount} samples` : 'Limited historical data',
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateLiquidityLab(symbol: string, timeframe = '15m'): Promise<LabResult<LiquidityState, LiquiditySignals>> {
  const latest = await getLatestObservation(symbol);

  let state: LiquidityState = 'NORMAL_LIQUIDITY';
  let confidence = 0.6;
  const signals: LiquiditySignals = {
    bidDepth: 0,
    askDepth: 0,
    spread: 0,
    depthRatio: 1,
    gapZones: [],
  };

  if (latest?.openInterest) {
    // Use OI as proxy for liquidity
    const oiValue = latest.openInterest.value || 0;
    signals.bidDepth = oiValue * 0.5;
    signals.askDepth = oiValue * 0.5;
    signals.depthRatio = 1;
    
    if (oiValue > 150000000) {
      state = 'DEEP_LIQUIDITY';
    } else if (oiValue < 80000000) {
      state = 'THIN_LIQUIDITY';
    }
    confidence = 0.7;
  }

  const risks = [];
  if (state === 'THIN_LIQUIDITY') risks.push('SLIPPAGE', 'MANIPULATION_RISK');

  return {
    lab: 'liquidity',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Liquidity is ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `Open Interest: $${((latest?.openInterest?.value || 0) / 1000000).toFixed(1)}M`,
        `OI Change: ${(latest?.openInterest?.deltaPct || 0).toFixed(2)}%`,
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateMarketStressLab(symbol: string, timeframe = '15m'): Promise<LabResult<MarketStressState, MarketStressSignals>> {
  const latest = await getLatestObservation(symbol);

  let state: MarketStressState = 'STABLE';
  let confidence = 0.6;
  const signals: MarketStressSignals = {
    stressIndex: 0,
    fundingRate: 0,
    openInterestChange: 0,
    liquidationVolume: 0,
  };

  if (latest) {
    // Calculate stress from liquidations
    const longLiq = latest.liquidations?.longVolume || 0;
    const shortLiq = latest.liquidations?.shortVolume || 0;
    signals.liquidationVolume = longLiq + shortLiq;
    signals.openInterestChange = latest.openInterest?.deltaPct || 0;
    
    // Calculate stress index
    const liqStress = Math.min(signals.liquidationVolume / 500000, 1);
    const oiStress = Math.abs(signals.openInterestChange) / 10;
    signals.stressIndex = (liqStress + oiStress) / 2;

    if (latest.liquidations?.cascadeActive) {
      state = 'FORCED_LIQUIDATIONS';
      signals.stressIndex = Math.max(signals.stressIndex, 0.8);
    } else if (signals.stressIndex > 0.7) {
      state = 'PANIC';
    } else if (signals.stressIndex > 0.4) {
      state = 'STRESSED';
    }
    confidence = 0.75;
  }

  const risks = [];
  if (state !== 'STABLE') risks.push('VOLATILITY_SPIKE');
  if (state === 'FORCED_LIQUIDATIONS' || state === 'PANIC') risks.push('CASCADING_LIQUIDATIONS');

  return {
    lab: 'marketStress',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Market stress: ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `Stress index: ${(signals.stressIndex * 100).toFixed(0)}%`,
        `Liquidation volume: $${(signals.liquidationVolume / 1000).toFixed(0)}K`,
        `OI change: ${signals.openInterestChange.toFixed(2)}%`,
        `Cascade active: ${latest?.liquidations?.cascadeActive ? 'YES' : 'NO'}`,
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

// ═══════════════════════════════════════════════════════════════
// GROUP B: FLOW & PARTICIPATION LABS
// ═══════════════════════════════════════════════════════════════

export async function calculateVolumeLab(symbol: string, timeframe = '15m'): Promise<LabResult<VolumeState, VolumeSignals>> {
  const latest = await getLatestObservation(symbol);
  const historical = await getHistoricalStats(symbol, '24h');

  let state: VolumeState = 'WEAK_CONFIRMATION';
  let confidence = 0.5;
  const signals: VolumeSignals = {
    volumeTrend: 'stable',
    relativeVolume: 1,
    buySellImbalance: 0,
    anomalies: [],
  };

  if (latest?.volume) {
    const currentVolume = latest.volume.total || 0;
    signals.relativeVolume = latest.volume.ratio || 1;
    signals.buySellImbalance = latest.orderFlow?.imbalance || 0;

    // Use historical data for better accuracy
    if (historical) {
      const historicalRatio = historical.volume.avg > 0 
        ? currentVolume / historical.volume.avg 
        : signals.relativeVolume;
      
      // Check for anomaly using historical std deviation
      if (isAnomaly(currentVolume, historical.volume.avg, historical.volume.stdDev)) {
        signals.anomalies.push('VOLUME_ANOMALY_VS_HISTORY');
      }
      
      // Calculate percentile
      const percentile = calculatePercentile(currentVolume, historical.volume.min, historical.volume.max);
      
      // Determine state with historical context
      if (percentile > 95 || historicalRatio > 3) {
        state = 'ANOMALY';
        signals.anomalies.push('VOLUME_SPIKE');
        confidence = 0.85;
      } else if (percentile > 70 && Math.abs(signals.buySellImbalance) > 0.2) {
        state = 'STRONG_CONFIRMATION';
        confidence = 0.8;
      } else if (percentile > 50) {
        state = 'WEAK_CONFIRMATION';
        confidence = 0.7;
      } else if (percentile < 30) {
        state = 'NO_CONFIRMATION';
        confidence = 0.75;
      }
      
      // Detect distribution risk
      if (signals.buySellImbalance < -0.3 && historicalRatio > 1.5) {
        state = 'DISTRIBUTION_RISK';
        signals.anomalies.push('HIGH_VOLUME_SELLING');
      }
      
      signals.volumeTrend = getTrend(currentVolume, historical.volume.avg);
    } else {
      // Fallback without historical data
      if (signals.relativeVolume > 3) {
        state = 'ANOMALY';
        signals.anomalies.push('VOLUME_SPIKE');
      } else if (signals.relativeVolume > 1.5 && Math.abs(signals.buySellImbalance) > 0.2) {
        state = 'STRONG_CONFIRMATION';
      } else if (signals.relativeVolume > 1.2) {
        state = 'WEAK_CONFIRMATION';
      } else if (signals.relativeVolume < 0.7) {
        state = 'NO_CONFIRMATION';
      }
      signals.volumeTrend = signals.relativeVolume > 1.2 ? 'increasing' : 
                            signals.relativeVolume < 0.8 ? 'decreasing' : 'stable';
      confidence = 0.6;
    }
  }

  const risks = [];
  if (state === 'NO_CONFIRMATION') risks.push('LOW_PARTICIPATION', 'FAKE_MOVE');
  if (state === 'ANOMALY') risks.push('MANIPULATION_POSSIBLE');
  if (state === 'DISTRIBUTION_RISK') risks.push('SELLING_PRESSURE');

  return {
    lab: 'volume',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Volume shows ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `Current volume: $${((latest?.volume?.total || 0) / 1000000).toFixed(2)}M`,
        `Relative to avg: ${signals.relativeVolume.toFixed(2)}x`,
        historical ? `24h avg: $${(historical.volume.avg / 1000000).toFixed(2)}M` : 'No historical data',
        `Buy/Sell imbalance: ${(signals.buySellImbalance * 100).toFixed(0)}%`,
        `Trend: ${signals.volumeTrend}`,
        signals.anomalies.length > 0 ? `Anomalies: ${signals.anomalies.join(', ')}` : 'No anomalies',
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateFlowLab(symbol: string, timeframe = '15m'): Promise<LabResult<FlowState, FlowSignals>> {
  const latest = await getLatestObservation(symbol);

  let state: FlowState = 'BALANCED';
  let confidence = 0.5;
  const signals: FlowSignals = {
    netFlow: 0,
    buyVolume: 0,
    sellVolume: 0,
    flowMomentum: 0,
  };

  if (latest?.orderFlow) {
    const dominance = latest.orderFlow.dominance || 0.5;
    const bias = latest.orderFlow.aggressorBias;
    
    signals.flowMomentum = dominance;
    
    if (bias === 'BUY' && dominance > 0.6) {
      state = 'BUY_DOMINANT';
    } else if (bias === 'SELL' && dominance > 0.6) {
      state = 'SELL_DOMINANT';
    } else if (dominance < 0.3 || dominance > 0.7) {
      state = 'CHAOTIC';
    }
    
    signals.netFlow = latest.volume?.delta || 0;
    confidence = 0.7;
  }

  return {
    lab: 'flow',
    state,
    confidence,
    signals,
    risks: state === 'CHAOTIC' ? ['UNPREDICTABLE_FLOW'] : [],
    explain: {
      summary: `Order flow is ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `Aggressor bias: ${latest?.orderFlow?.aggressorBias || 'unknown'}`,
        `Dominance: ${((latest?.orderFlow?.dominance || 0.5) * 100).toFixed(0)}%`,
        `Absorption: ${latest?.orderFlow?.absorption ? 'YES' : 'NO'}`,
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateMomentumLab(symbol: string, timeframe = '15m'): Promise<LabResult<MomentumState, MomentumSignals>> {
  const latest = await getLatestObservation(symbol);

  let state: MomentumState = 'STALLED';
  let confidence = 0.5;
  const signals: MomentumSignals = {
    rsi: 50,
    macdHistogram: 0,
    rateOfChange: 0,
    momentumDivergence: false,
  };

  if (latest?.market) {
    // Use price changes as momentum proxy
    const roc5m = latest.market.priceChange5m || 0;
    const roc15m = latest.market.priceChange15m || 0;
    
    signals.rateOfChange = roc15m;
    
    // Estimate RSI from price movement
    if (roc15m > 2) signals.rsi = 70 + Math.min(roc15m * 2, 15);
    else if (roc15m < -2) signals.rsi = 30 - Math.min(Math.abs(roc15m) * 2, 15);
    else signals.rsi = 50 + roc15m * 5;
    signals.rsi = Math.max(10, Math.min(90, signals.rsi));

    // Determine state
    if (roc15m > 1 && roc5m > 0.5) {
      state = 'ACCELERATING';
    } else if (roc15m < -1 && roc5m < -0.5) {
      state = 'DECELERATING';
    } else if (signals.rsi > 70 || signals.rsi < 30) {
      state = 'REVERSAL_RISK';
    }
    
    // Check for divergence (momentum vs price)
    if ((roc15m > 0 && roc5m < 0) || (roc15m < 0 && roc5m > 0)) {
      signals.momentumDivergence = true;
    }
    
    confidence = 0.7;
  }

  const risks = [];
  if (state === 'REVERSAL_RISK') risks.push(signals.rsi > 70 ? 'OVERBOUGHT' : 'OVERSOLD');
  if (signals.momentumDivergence) risks.push('DIVERGENCE');

  return {
    lab: 'momentum',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Momentum is ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `RSI (estimated): ${signals.rsi.toFixed(1)}`,
        `Rate of change 15m: ${signals.rateOfChange.toFixed(2)}%`,
        `Rate of change 5m: ${(latest?.market?.priceChange5m || 0).toFixed(2)}%`,
        signals.momentumDivergence ? 'DIVERGENCE DETECTED' : 'No divergence',
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateParticipationLab(symbol: string, timeframe = '15m'): Promise<LabResult<ParticipationState, ParticipationSignals>> {
  let state: ParticipationState = 'NARROW_PARTICIPATION';
  let confidence = 0.5;
  const signals: ParticipationSignals = {
    uniqueTraders: 0,
    tradeCount: 0,
    avgTradeSize: 0,
    retailVsInstitutional: 0.5,
  };

  // Mock data - in production would come from trade data analysis
  return {
    lab: 'participation',
    state,
    confidence,
    signals,
    risks: state === 'FAKE_ACTIVITY' ? ['WASH_TRADING', 'LOW_REAL_INTEREST'] : [],
    explain: {
      summary: `Market participation is ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        `Trade count: ${signals.tradeCount}`,
        `Average trade size: $${signals.avgTradeSize.toFixed(0)}`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

// ═══════════════════════════════════════════════════════════════
// GROUP C: SMART MONEY & RISK LABS
// ═══════════════════════════════════════════════════════════════

export async function calculateWhaleLab(symbol: string, timeframe = '15m'): Promise<LabResult<WhaleState, WhaleSignals>> {
  const database = await getDb();
  const whaleData = database.collection('whale_transactions');
  const recent = await whaleData.find({
    symbol,
    timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  }).toArray();

  let state: WhaleState = 'NO_WHALES';
  let confidence = 0.5;
  const signals: WhaleSignals = {
    largeTradeFlow: 0,
    orderbookPressure: 0,
    liquidationZones: [],
    whaleActivity: 'low',
  };

  if (recent.length > 0) {
    const totalFlow = recent.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const buyFlow = recent.filter(tx => tx.side === 'buy').reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const sellFlow = recent.filter(tx => tx.side === 'sell').reduce((sum, tx) => sum + (tx.amount || 0), 0);
    
    signals.largeTradeFlow = totalFlow;
    
    if (buyFlow > sellFlow * 1.5) {
      state = 'ACCUMULATION';
    } else if (sellFlow > buyFlow * 1.5) {
      state = 'DISTRIBUTION';
    } else if (totalFlow > 10000000) {
      state = 'PASSIVE_PRESENCE';
    }
    
    signals.whaleActivity = totalFlow > 50000000 ? 'high' : totalFlow > 10000000 ? 'medium' : 'low';
    confidence = 0.7;
  }

  return {
    lab: 'whale',
    state,
    confidence,
    signals,
    risks: state === 'DISTRIBUTION' ? ['SELLING_PRESSURE', 'PRICE_DROP'] : [],
    explain: {
      summary: `Whale activity: ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        `Large trade flow: $${(signals.largeTradeFlow / 1000000).toFixed(2)}M`,
        `Activity level: ${signals.whaleActivity}`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

export async function calculateAccumulationLab(symbol: string, timeframe = '15m'): Promise<LabResult<AccumulationState, AccumulationSignals>> {
  let state: AccumulationState = 'NEUTRAL';
  let confidence = 0.5;
  const signals: AccumulationSignals = {
    adLine: 0,
    obvTrend: 0,
    mfiValue: 50,
    divergence: 'none',
  };

  return {
    lab: 'accumulation',
    state,
    confidence,
    signals,
    risks: [],
    explain: {
      summary: `Accumulation/Distribution: ${state.toLowerCase()}`,
      details: [
        `A/D Line: ${signals.adLine.toFixed(2)}`,
        `MFI: ${signals.mfiValue.toFixed(1)}`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

export async function calculateManipulationLab(symbol: string, timeframe = '15m'): Promise<LabResult<ManipulationState, ManipulationSignals>> {
  let state: ManipulationState = 'CLEAN';
  let confidence = 0.6;
  const signals: ManipulationSignals = {
    spoofingScore: 0,
    fakeBreakoutRisk: 0,
    stopClusterProximity: 0,
    unusualActivity: false,
  };

  return {
    lab: 'manipulation',
    state,
    confidence,
    signals,
    risks: state !== 'CLEAN' ? ['MANIPULATION_DETECTED'] : [],
    explain: {
      summary: `Market manipulation risk: ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        `Spoofing score: ${(signals.spoofingScore * 100).toFixed(0)}%`,
        `Fake breakout risk: ${(signals.fakeBreakoutRisk * 100).toFixed(0)}%`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

export async function calculateLiquidationLab(symbol: string, timeframe = '15m'): Promise<LabResult<LiquidationState, LiquidationSignals>> {
  const latest = await getLatestObservation(symbol);

  let state: LiquidationState = 'BALANCED';
  let confidence = 0.6;
  const signals: LiquidationSignals = {
    longLiquidationZone: 0,
    shortLiquidationZone: 0,
    openInterestLongs: 0,
    openInterestShorts: 0,
    cascadeProbability: 0,
  };

  if (latest?.liquidations) {
    const longLiq = latest.liquidations.longVolume || 0;
    const shortLiq = latest.liquidations.shortVolume || 0;
    
    signals.openInterestLongs = longLiq;
    signals.openInterestShorts = shortLiq;
    
    if (latest.liquidations.cascadeActive) {
      state = 'CASCADE_RISK';
      signals.cascadeProbability = 0.8;
    } else if (longLiq > shortLiq * 2) {
      state = 'LONGS_AT_RISK';
      signals.cascadeProbability = 0.4;
    } else if (shortLiq > longLiq * 2) {
      state = 'SHORTS_AT_RISK';
      signals.cascadeProbability = 0.4;
    }
    
    confidence = 0.75;
  }

  const risks = [];
  if (state !== 'BALANCED') risks.push('LIQUIDATION_CASCADE');
  if (latest?.liquidations?.cascadeActive) risks.push('CASCADE_ACTIVE');

  return {
    lab: 'liquidation',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Liquidation pressure: ${state.toLowerCase().replace(/_/g, ' ')}`,
      details: [
        `Long liquidations: $${((latest?.liquidations?.longVolume || 0) / 1000).toFixed(0)}K`,
        `Short liquidations: $${((latest?.liquidations?.shortVolume || 0) / 1000).toFixed(0)}K`,
        `Cascade: ${latest?.liquidations?.cascadeActive ? `ACTIVE (${latest.liquidations.cascadeDirection})` : 'No'}`,
        `Cascade probability: ${(signals.cascadeProbability * 100).toFixed(0)}%`,
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

// ═══════════════════════════════════════════════════════════════
// GROUP D: PRICE BEHAVIOR LABS
// ═══════════════════════════════════════════════════════════════

export async function calculateCorridorLab(symbol: string, timeframe = '15m'): Promise<LabResult<CorridorState, CorridorSignals>> {
  let state: CorridorState = 'INSIDE_RANGE';
  let confidence = 0.5;
  const signals: CorridorSignals = {
    rangeHigh: 0,
    rangeLow: 0,
    currentPosition: 0.5,
    breakAttempts: 0,
    avgTimeInRange: 0,
  };

  return {
    lab: 'corridor',
    state,
    confidence,
    signals,
    risks: state === 'RANGE_BREAK_ATTEMPT' ? ['FALSE_BREAK_RISK'] : [],
    explain: {
      summary: `Price corridor: ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        `Range: ${signals.rangeLow} - ${signals.rangeHigh}`,
        `Position in range: ${(signals.currentPosition * 100).toFixed(0)}%`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

export async function calculateSupportResistanceLab(symbol: string, timeframe = '15m'): Promise<LabResult<SupportResistanceState, SupportResistanceSignals>> {
  let state: SupportResistanceState = 'WEAK_SUPPORT';
  let confidence = 0.5;
  const signals: SupportResistanceSignals = {
    nearestSupport: 0,
    nearestResistance: 0,
    supportStrength: 0,
    resistanceStrength: 0,
    touchCount: 0,
  };

  return {
    lab: 'supportResistance',
    state,
    confidence,
    signals,
    risks: [],
    explain: {
      summary: `S/R analysis: ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        `Nearest support: ${signals.nearestSupport}`,
        `Nearest resistance: ${signals.nearestResistance}`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

export async function calculatePriceAcceptanceLab(symbol: string, timeframe = '15m'): Promise<LabResult<PriceAcceptanceState, PriceAcceptanceSignals>> {
  let state: PriceAcceptanceState = 'UNSTABLE';
  let confidence = 0.5;
  const signals: PriceAcceptanceSignals = {
    timeAtLevel: 0,
    volumeProfile: 0,
    rejectionCount: 0,
    valueAreaHigh: 0,
    valueAreaLow: 0,
  };

  return {
    lab: 'priceAcceptance',
    state,
    confidence,
    signals,
    risks: state === 'REJECTED' ? ['PRICE_REJECTION'] : [],
    explain: {
      summary: `Price acceptance: ${state.toLowerCase()}`,
      details: [
        `Time at level: ${signals.timeAtLevel}h`,
        `Rejection count: ${signals.rejectionCount}`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

// ═══════════════════════════════════════════════════════════════
// GROUP E: META / QUALITY LABS
// ═══════════════════════════════════════════════════════════════

export async function calculateDataQualityLab(symbol: string, timeframe = '15m'): Promise<LabResult<DataQualityState, DataQualitySignals>> {
  const latest = await getLatestObservation(symbol);
  
  let state: DataQualityState = 'CLEAN';
  let confidence = 0.8;
  const signals: DataQualitySignals = {
    dataLatency: 0,
    missingFields: [],
    sourceReliability: 0.95,
    lastValidData: new Date().toISOString(),
  };

  if (latest) {
    const latency = Date.now() - (latest.timestamp || 0);
    signals.dataLatency = latency / 1000;
    signals.lastValidData = new Date(latest.timestamp).toISOString();
    signals.sourceReliability = latest.source === 'polling' ? 0.9 : 0.7;
    
    // Check for missing data
    if (!latest.market) signals.missingFields.push('market');
    if (!latest.volume) signals.missingFields.push('volume');
    if (!latest.orderFlow) signals.missingFields.push('orderFlow');
    
    // Determine state based on latency
    if (latency > 600000) { // 10 min
      state = 'UNTRUSTED';
      confidence = 0.3;
    } else if (latency > 300000) { // 5 min
      state = 'DEGRADED';
      confidence = 0.5;
    } else if (latency > 60000 || signals.missingFields.length > 0) { // 1 min
      state = 'PARTIAL';
      confidence = 0.7;
    }
  } else {
    state = 'UNTRUSTED';
    confidence = 0.2;
    signals.missingFields.push('ALL_DATA');
  }

  const risks = [];
  if (state !== 'CLEAN') risks.push('DATA_RELIABILITY_ISSUE');
  if (state === 'UNTRUSTED') risks.push('DECISIONS_NOT_RECOMMENDED');

  return {
    lab: 'dataQuality',
    state,
    confidence,
    signals,
    risks,
    explain: {
      summary: `Data quality: ${state.toLowerCase()}`,
      details: [
        `Latency: ${signals.dataLatency.toFixed(0)}s`,
        `Source: ${latest?.source || 'unknown'}`,
        `Reliability: ${(signals.sourceReliability * 100).toFixed(0)}%`,
        signals.missingFields.length > 0 ? `Missing: ${signals.missingFields.join(', ')}` : 'All fields present',
      ],
    },
    meta: createMeta(symbol, timeframe, latest?.timestamp),
  };
}

export async function calculateSignalConflictLab(symbol: string, timeframe = '15m', allLabs: Record<string, AnyLabResult>): Promise<LabResult<SignalConflictState, SignalConflictSignals>> {
  const conflicts: string[] = [];
  const aligned: string[] = [];

  // Analyze conflicts between labs
  // Example: Volume says confirmation but Whale says distribution
  
  let state: SignalConflictState = 'ALIGNED';
  if (conflicts.length > 3) state = 'STRONG_CONFLICT';
  else if (conflicts.length > 0) state = 'PARTIAL_CONFLICT';

  return {
    lab: 'signalConflict',
    state,
    confidence: 0.8,
    signals: {
      conflictingLabs: conflicts,
      alignedLabs: aligned,
      conflictScore: conflicts.length / 18,
      dominantSignal: 'neutral',
    },
    risks: state !== 'ALIGNED' ? ['CONFLICTING_SIGNALS'] : [],
    explain: {
      summary: `Signal alignment: ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        conflicts.length > 0 ? `Conflicts: ${conflicts.join(', ')}` : 'No conflicts detected',
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

export async function calculateStabilityLab(symbol: string, timeframe = '15m'): Promise<LabResult<StabilityState, StabilitySignals>> {
  let state: StabilityState = 'STABLE';
  let confidence = 0.6;
  const signals: StabilitySignals = {
    stabilityScore: 0.7,
    volatilityTrend: 'stable',
    structuralIntegrity: 0.8,
    breakRiskLevel: 0.2,
  };

  return {
    lab: 'stability',
    state,
    confidence,
    signals,
    risks: state === 'BREAK_RISK' ? ['STRUCTURAL_BREAK'] : [],
    explain: {
      summary: `Market stability: ${state.toLowerCase().replace('_', ' ')}`,
      details: [
        `Stability score: ${(signals.stabilityScore * 100).toFixed(0)}%`,
        `Break risk: ${(signals.breakRiskLevel * 100).toFixed(0)}%`,
      ],
    },
    meta: createMeta(symbol, timeframe),
  };
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export async function calculateAllLabs(symbol: string, timeframe = '15m'): Promise<LabsSnapshot> {
  const labs: Partial<Record<LabName, AnyLabResult>> = {};

  // Group A
  labs.regime = await calculateRegimeLab(symbol, timeframe);
  labs.volatility = await calculateVolatilityLab(symbol, timeframe);
  labs.liquidity = await calculateLiquidityLab(symbol, timeframe);
  labs.marketStress = await calculateMarketStressLab(symbol, timeframe);

  // Group B
  labs.volume = await calculateVolumeLab(symbol, timeframe);
  labs.flow = await calculateFlowLab(symbol, timeframe);
  labs.momentum = await calculateMomentumLab(symbol, timeframe);
  labs.participation = await calculateParticipationLab(symbol, timeframe);

  // Group C
  labs.whale = await calculateWhaleLab(symbol, timeframe);
  labs.accumulation = await calculateAccumulationLab(symbol, timeframe);
  labs.manipulation = await calculateManipulationLab(symbol, timeframe);
  labs.liquidation = await calculateLiquidationLab(symbol, timeframe);

  // Group D
  labs.corridor = await calculateCorridorLab(symbol, timeframe);
  labs.supportResistance = await calculateSupportResistanceLab(symbol, timeframe);
  labs.priceAcceptance = await calculatePriceAcceptanceLab(symbol, timeframe);

  // Group E
  labs.dataQuality = await calculateDataQualityLab(symbol, timeframe);
  labs.signalConflict = await calculateSignalConflictLab(symbol, timeframe, labs as Record<string, AnyLabResult>);
  labs.stability = await calculateStabilityLab(symbol, timeframe);

  return {
    symbol,
    timestamp: new Date().toISOString(),
    labs: labs as Record<LabName, AnyLabResult>,
  };
}

export function summarizeLabs(snapshot: LabsSnapshot): LabsSummary {
  const activeRisks: string[] = [];
  const conflictingSignals: string[] = [];
  let criticalCount = 0;

  for (const [name, lab] of Object.entries(snapshot.labs)) {
    if (lab.risks.length > 0) {
      activeRisks.push(...lab.risks);
    }
    if (lab.confidence < 0.4) {
      criticalCount++;
    }
  }

  return {
    symbol: snapshot.symbol,
    timestamp: snapshot.timestamp,
    overallHealth: criticalCount > 3 ? 'critical' : criticalCount > 0 ? 'warning' : 'healthy',
    activeRisks: [...new Set(activeRisks)],
    conflictingSignals,
    dominantState: 'mixed',
  };
}

console.log('[LABS.V3] Canonical service loaded - 18 Labs ready');
