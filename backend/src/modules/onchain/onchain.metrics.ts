/**
 * C2.1.2 — On-chain Metrics Engine
 * =================================
 * 
 * Transform raw snapshots into normalized measurements.
 * 
 * FORMULAS (LOCKED v1):
 * - flowScore: net capital flow direction
 * - exchangePressure: sell vs withdraw pressure on exchanges
 * - whaleActivity: large holder participation
 * - networkHeat: network congestion/activity level
 * - velocity: capital movement speed
 * - distributionSkew: activity concentration
 * 
 * INVARIANTS:
 * - NO verdict, NO signals, NO predictions
 * - NO knowledge of Exchange or Sentiment
 * - Pure measurement layer
 */

import {
  OnchainSnapshot,
  OnchainMetrics,
  OnchainWindow,
  ONCHAIN_THRESHOLDS,
} from './onchain.contracts.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const EPS = 1e-10;  // Prevent division by zero

// Expected fields for completeness calculation
const EXPECTED_FIELDS = [
  'exchangeInflowUsd', 'exchangeOutflowUsd',
  'netInflowUsd', 'netOutflowUsd',
  'activeAddresses', 'txCount', 'feesUsd',
  'largeTransfersCount', 'largeTransfersVolumeUsd',
];

// Thresholds for driver detection
const DRIVER_THRESHOLDS = {
  highFlow: 0.5,
  highPressure: 0.4,
  highWhale: 0.6,
  highHeat: 0.7,
  highVelocity: 0.6,
  highSkew: 0.7,
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Clamp value to range [min, max]
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize ratio to [-1, +1]
 */
function normalizeRatio(a: number, b: number): number {
  const sum = Math.abs(a) + Math.abs(b) + EPS;
  return clamp((a - b) / sum, -1, 1);
}

/**
 * Normalize to [0, 1] using log scale
 */
function normalizeLog(value: number, maxValue: number): number {
  if (value <= 0) return 0;
  return clamp(Math.log(value + 1) / Math.log(maxValue + 1), 0, 1);
}

/**
 * Normalize to [0, 1] using linear scale
 */
function normalizeLinear(value: number, maxValue: number): number {
  if (maxValue <= 0) return 0;
  return clamp(value / maxValue, 0, 1);
}

// ═══════════════════════════════════════════════════════════════
// METRIC CALCULATIONS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate flowScore: net capital flow direction
 * 
 * Formula: (outflow - inflow) / (outflow + inflow + ε)
 * 
 * Interpretation:
 * - > 0: money leaving (distribution)
 * - < 0: money entering (accumulation)
 */
function calcFlowScore(snapshot: OnchainSnapshot): number {
  const inflow = snapshot.netInflowUsd || 0;
  const outflow = snapshot.netOutflowUsd || 0;
  
  // Positive flowScore = distribution (money leaving)
  // Negative flowScore = accumulation (money entering)
  return normalizeRatio(outflow, inflow);
}

/**
 * Calculate exchangePressure: sell vs withdraw pressure
 * 
 * Formula: (deposits - withdrawals) / (deposits + withdrawals + ε)
 * 
 * Interpretation:
 * - > 0: sell-side pressure (deposits to exchanges)
 * - < 0: withdrawal/hodl (outflows from exchanges)
 */
function calcExchangePressure(snapshot: OnchainSnapshot): number {
  const deposits = snapshot.exchangeInflowUsd || 0;
  const withdrawals = snapshot.exchangeOutflowUsd || 0;
  
  // Positive = sell pressure (deposits > withdrawals)
  // Negative = buy/hold pressure (withdrawals > deposits)
  return normalizeRatio(deposits, withdrawals);
}

/**
 * Calculate whaleActivity: large holder participation
 * 
 * Formula: log(largeTxVolume + 1) / log(maxLargeVolume + 1)
 * 
 * NOT bullish/bearish - just activity level
 */
function calcWhaleActivity(snapshot: OnchainSnapshot): number {
  const volume = snapshot.largeTransfersVolumeUsd || 0;
  const count = snapshot.largeTransfersCount || 0;
  
  // Max reference: $1B in large transfers (very high activity)
  const maxVolume = 1_000_000_000;
  
  // Combine volume and count for robustness
  const volumeScore = normalizeLog(volume, maxVolume);
  const countScore = normalizeLog(count * ONCHAIN_THRESHOLDS.LARGE_TRANSFER_USD, maxVolume);
  
  return clamp((volumeScore * 0.7 + countScore * 0.3), 0, 1);
}

/**
 * Calculate networkHeat: network congestion/activity
 * 
 * Formula: mean(norm(activeAddresses), norm(txCount), norm(fees))
 */
function calcNetworkHeat(snapshot: OnchainSnapshot): number {
  // Reference maximums (per 1h window, scale for other windows)
  const maxAddresses = 100_000;  // BTC has ~800k/day, so ~33k/hour
  const maxTxCount = 100_000;    // ETH has ~1.2M/day
  const maxFees = 500_000;       // High gas periods
  
  const addressScore = normalizeLog(snapshot.activeAddresses || 0, maxAddresses);
  const txScore = normalizeLog(snapshot.txCount || 0, maxTxCount);
  const feeScore = normalizeLog(snapshot.feesUsd || 0, maxFees);
  
  // Weighted average
  return clamp(addressScore * 0.3 + txScore * 0.4 + feeScore * 0.3, 0, 1);
}

/**
 * Calculate velocity: capital movement speed
 * 
 * Formula: transferVolume / estimatedSupply
 * 
 * Higher = money moving fast, lower = money sitting
 */
function calcVelocity(snapshot: OnchainSnapshot): number {
  // Total transfer volume (use net flows as proxy)
  const totalVolume = Math.abs(snapshot.netInflowUsd || 0) + 
                      Math.abs(snapshot.netOutflowUsd || 0) +
                      (snapshot.largeTransfersVolumeUsd || 0);
  
  // Reference: $10B moving in a window is very high velocity
  const maxVelocity = 10_000_000_000;
  
  return normalizeLog(totalVolume, maxVelocity);
}

/**
 * Calculate distributionSkew: activity concentration
 * 
 * Higher = few addresses dominate, lower = distributed activity
 * 
 * Proxy: large transfers / total activity ratio
 */
function calcDistributionSkew(snapshot: OnchainSnapshot): number {
  const largeVolume = snapshot.largeTransfersVolumeUsd || 0;
  const totalVolume = Math.abs(snapshot.netInflowUsd || 0) + 
                      Math.abs(snapshot.netOutflowUsd || 0) + EPS;
  
  // If large transfers dominate, skew is high
  const skew = largeVolume / (largeVolume + totalVolume);
  
  return clamp(skew, 0, 1);
}

/**
 * Calculate data completeness
 */
function calcDataCompleteness(snapshot: OnchainSnapshot): number {
  let available = 0;
  
  for (const field of EXPECTED_FIELDS) {
    const value = (snapshot as any)[field];
    if (value !== undefined && value !== null && value !== 0) {
      available++;
    }
  }
  
  return available / EXPECTED_FIELDS.length;
}

/**
 * Calculate confidence score
 */
function calcConfidence(snapshot: OnchainSnapshot, completeness: number): number {
  const sourceQuality = snapshot.sourceQuality || 0.3;
  
  // Freshness factor (data older than 5 min is less reliable)
  const ageMs = Date.now() - snapshot.snapshotTimestamp;
  const freshness = ageMs < 300_000 ? 1.0 : 
                    ageMs < 600_000 ? 0.8 : 
                    ageMs < 3600_000 ? 0.5 : 0.3;
  
  return clamp(completeness * sourceQuality * freshness, 0, 1);
}

/**
 * Generate drivers (top reasons for current state)
 */
function generateDrivers(
  flowScore: number,
  exchangePressure: number,
  whaleActivity: number,
  networkHeat: number,
  velocity: number,
  distributionSkew: number
): string[] {
  const drivers: string[] = [];
  
  // Flow drivers
  if (flowScore > DRIVER_THRESHOLDS.highFlow) {
    drivers.push('net_outflows_detected');
  } else if (flowScore < -DRIVER_THRESHOLDS.highFlow) {
    drivers.push('net_inflows_detected');
  }
  
  // Exchange pressure drivers
  if (exchangePressure > DRIVER_THRESHOLDS.highPressure) {
    drivers.push('exchange_deposits_elevated');
  } else if (exchangePressure < -DRIVER_THRESHOLDS.highPressure) {
    drivers.push('exchange_withdrawals_elevated');
  }
  
  // Whale activity
  if (whaleActivity > DRIVER_THRESHOLDS.highWhale) {
    drivers.push('large_holder_activity_spike');
  }
  
  // Network heat
  if (networkHeat > DRIVER_THRESHOLDS.highHeat) {
    drivers.push('network_congestion_high');
  }
  
  // Velocity
  if (velocity > DRIVER_THRESHOLDS.highVelocity) {
    drivers.push('capital_velocity_elevated');
  }
  
  // Skew
  if (distributionSkew > DRIVER_THRESHOLDS.highSkew) {
    drivers.push('activity_concentrated');
  }
  
  return drivers.slice(0, 3);  // Max 3 drivers
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

class OnchainMetricsEngine {
  /**
   * Calculate all metrics from a snapshot
   */
  calculate(snapshot: OnchainSnapshot): OnchainMetrics {
    // Calculate raw scores
    const flowScore = calcFlowScore(snapshot);
    const exchangePressure = calcExchangePressure(snapshot);
    const whaleActivity = calcWhaleActivity(snapshot);
    const networkHeat = calcNetworkHeat(snapshot);
    const velocity = calcVelocity(snapshot);
    const distributionSkew = calcDistributionSkew(snapshot);
    
    // Quality metrics
    const dataCompleteness = calcDataCompleteness(snapshot);
    const confidence = calcConfidence(snapshot, dataCompleteness);
    
    // Explainability
    const drivers = generateDrivers(
      flowScore, exchangePressure, whaleActivity, 
      networkHeat, velocity, distributionSkew
    );
    
    return {
      symbol: snapshot.symbol,
      t0: snapshot.t0,
      window: snapshot.window,
      
      flowScore,
      exchangePressure,
      whaleActivity,
      networkHeat,
      velocity,
      distributionSkew,
      
      dataCompleteness,
      confidence,
      
      drivers,
      missing: snapshot.missingFields || [],
      
      rawScores: {
        flowRaw: snapshot.netFlowUsd,
        exchangeRaw: snapshot.exchangeNetUsd,
        whaleRaw: snapshot.largeTransfersVolumeUsd,
        heatRaw: snapshot.txCount,
        velocityRaw: Math.abs(snapshot.netInflowUsd) + Math.abs(snapshot.netOutflowUsd),
        skewRaw: snapshot.largeTransfersVolumeUsd / (Math.abs(snapshot.netFlowUsd) + 1),
      },
    };
  }
  
  /**
   * Generate diagnostics for a metrics calculation
   */
  getDiagnostics(snapshot: OnchainSnapshot, metrics: OnchainMetrics) {
    const warnings: string[] = [];
    
    if (metrics.confidence < 0.4) {
      warnings.push('Low confidence - data may be unreliable');
    }
    
    if (metrics.dataCompleteness < 0.5) {
      warnings.push(`Missing ${Math.round((1 - metrics.dataCompleteness) * 100)}% of expected data`);
    }
    
    if (snapshot.source === 'mock') {
      warnings.push('Using mock data - not suitable for production');
    }
    
    return {
      symbol: metrics.symbol,
      t0: metrics.t0,
      
      // Metric breakdown
      breakdown: {
        flowScore: {
          value: metrics.flowScore,
          interpretation: metrics.flowScore > 0.2 ? 'distribution' : 
                         metrics.flowScore < -0.2 ? 'accumulation' : 'neutral',
          inputs: {
            netInflow: snapshot.netInflowUsd,
            netOutflow: snapshot.netOutflowUsd,
          },
        },
        exchangePressure: {
          value: metrics.exchangePressure,
          interpretation: metrics.exchangePressure > 0.2 ? 'sell_pressure' :
                         metrics.exchangePressure < -0.2 ? 'withdrawal_pressure' : 'balanced',
          inputs: {
            deposits: snapshot.exchangeInflowUsd,
            withdrawals: snapshot.exchangeOutflowUsd,
          },
        },
        whaleActivity: {
          value: metrics.whaleActivity,
          interpretation: metrics.whaleActivity > 0.6 ? 'high' :
                         metrics.whaleActivity > 0.3 ? 'moderate' : 'low',
          inputs: {
            count: snapshot.largeTransfersCount,
            volume: snapshot.largeTransfersVolumeUsd,
          },
        },
        networkHeat: {
          value: metrics.networkHeat,
          interpretation: metrics.networkHeat > 0.7 ? 'congested' :
                         metrics.networkHeat > 0.4 ? 'active' : 'quiet',
          inputs: {
            addresses: snapshot.activeAddresses,
            txCount: snapshot.txCount,
            fees: snapshot.feesUsd,
          },
        },
        velocity: {
          value: metrics.velocity,
          interpretation: metrics.velocity > 0.6 ? 'high_turnover' :
                         metrics.velocity > 0.3 ? 'moderate_turnover' : 'low_turnover',
        },
        distributionSkew: {
          value: metrics.distributionSkew,
          interpretation: metrics.distributionSkew > 0.7 ? 'concentrated' :
                         metrics.distributionSkew > 0.4 ? 'moderately_concentrated' : 'distributed',
        },
      },
      
      // Quality assessment
      quality: {
        confidence: metrics.confidence,
        dataCompleteness: metrics.dataCompleteness,
        source: snapshot.source,
        sourceQuality: snapshot.sourceQuality,
      },
      
      // Explainability
      drivers: metrics.drivers,
      missing: metrics.missing,
      warnings,
      
      // Usability flag
      isUsable: metrics.confidence >= ONCHAIN_THRESHOLDS.MIN_USABLE_CONFIDENCE,
    };
  }
}

export const onchainMetricsEngine = new OnchainMetricsEngine();

console.log('[C2.1.2] OnchainMetricsEngine loaded');
