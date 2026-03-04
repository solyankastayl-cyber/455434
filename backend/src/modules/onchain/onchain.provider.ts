/**
 * C2.1.1 — Mock Onchain Provider
 * ===============================
 * 
 * Deterministic mock provider for on-chain data.
 * Same (symbol, t0) → same snapshot.
 */

import {
  OnchainSnapshot,
  OnchainWindow,
  OnchainChain,
  SOURCE_QUALITY,
  ONCHAIN_THRESHOLDS,
} from './onchain.contracts.js';

// Symbol to chain mapping
const SYMBOL_CHAIN_MAP: Record<string, OnchainChain> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'ethereum',
  XRPUSDT: 'ethereum',
  ARBUSDT: 'arbitrum',
};

// Asset-specific mock parameters
const ASSET_PARAMS: Record<string, {
  avgDailyVolume: number;
  avgActiveAddresses: number;
  avgTxCount: number;
  avgFees: number;
  volatility: number;
}> = {
  BTCUSDT: {
    avgDailyVolume: 10_000_000_000,
    avgActiveAddresses: 800_000,
    avgTxCount: 300_000,
    avgFees: 1_500_000,
    volatility: 0.3,
  },
  ETHUSDT: {
    avgDailyVolume: 8_000_000_000,
    avgActiveAddresses: 500_000,
    avgTxCount: 1_200_000,
    avgFees: 5_000_000,
    volatility: 0.35,
  },
  SOLUSDT: {
    avgDailyVolume: 2_000_000_000,
    avgActiveAddresses: 200_000,
    avgTxCount: 5_000_000,
    avgFees: 100_000,
    volatility: 0.5,
  },
  DEFAULT: {
    avgDailyVolume: 500_000_000,
    avgActiveAddresses: 50_000,
    avgTxCount: 100_000,
    avgFees: 50_000,
    volatility: 0.4,
  },
};

const WINDOW_MULT: Record<OnchainWindow, number> = {
  '1h': 1 / 24,
  '4h': 4 / 24,
  '24h': 1,
  '7d': 7,
};

/**
 * Generate deterministic hash from string
 */
function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get direction bias (-1 to +1) from seed
 */
function getDirectionBias(seed: number): number {
  const raw = ((seed >> 5) % 200) - 100;
  return raw / 100;
}

/**
 * Generate deterministic mock snapshot
 */
export function generateMockSnapshot(
  symbol: string,
  t0: number,
  window: OnchainWindow
): OnchainSnapshot {
  const params = ASSET_PARAMS[symbol] || ASSET_PARAMS.DEFAULT;
  const windowMult = WINDOW_MULT[window];
  
  const seed = hashSeed(`${symbol}:${t0}:${window}`);
  
  const baseVolume = params.avgDailyVolume * windowMult;
  const baseAddresses = Math.round(params.avgActiveAddresses * windowMult);
  const baseTxCount = Math.round(params.avgTxCount * windowMult);
  const baseFees = params.avgFees * windowMult;
  
  const variance = (seed % 1000) / 1000;
  const direction = ((seed >> 10) % 2) === 0 ? 1 : -1;
  const volatilityFactor = params.volatility * variance * direction;
  
  const exchangeBias = getDirectionBias(seed);
  const exchangeInflowUsd = Math.round(baseVolume * 0.15 * (1 + exchangeBias * 0.3));
  const exchangeOutflowUsd = Math.round(baseVolume * 0.15 * (1 - exchangeBias * 0.3));
  const exchangeNetUsd = exchangeInflowUsd - exchangeOutflowUsd;
  
  const flowBias = getDirectionBias(seed + 1000);
  const netInflowUsd = Math.round(baseVolume * 0.2 * (1 + flowBias * 0.2));
  const netOutflowUsd = Math.round(baseVolume * 0.2 * (1 - flowBias * 0.2));
  const netFlowUsd = netInflowUsd - netOutflowUsd;
  
  const activityMult = 1 + volatilityFactor * 0.5;
  const activeAddresses = Math.round(baseAddresses * activityMult);
  const txCount = Math.round(baseTxCount * activityMult);
  const feesUsd = Math.round(baseFees * (1 + volatilityFactor * 0.8));
  
  const whaleSeed = (seed >> 15) % 100;
  const largeTransfersCount = Math.max(0, Math.round(
    (5 + whaleSeed / 10) * windowMult * (1 + Math.abs(volatilityFactor))
  ));
  const avgLargeTransfer = ONCHAIN_THRESHOLDS.LARGE_TRANSFER_USD * (3 + whaleSeed / 50);
  const largeTransfersVolumeUsd = Math.round(largeTransfersCount * avgLargeTransfer);
  
  return {
    symbol,
    chain: SYMBOL_CHAIN_MAP[symbol] || 'ethereum',
    t0,
    snapshotTimestamp: t0 - 60_000,
    window,
    
    exchangeInflowUsd,
    exchangeOutflowUsd,
    exchangeNetUsd,
    
    netInflowUsd,
    netOutflowUsd,
    netFlowUsd,
    
    activeAddresses,
    txCount,
    feesUsd,
    
    largeTransfersCount,
    largeTransfersVolumeUsd,
    
    source: 'mock',
    sourceProvider: 'mock_onchain_v1',
    sourceQuality: SOURCE_QUALITY.mock,
    missingFields: ['topHolderDeltaUsd'],
  };
}

console.log('[C2.1] Mock Provider loaded');
