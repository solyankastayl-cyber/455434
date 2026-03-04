/**
 * AE/S-Brain v2 — World State Contract
 * 
 * Aggregates all assets + global context into single pack.
 * This is what Brain reads to understand "state of the world".
 */

import { AssetId, AssetStatePack } from './asset_state.contract.js';
import { CrossAssetPack } from './cross_asset.contract.js';

export interface GlobalContext {
  // DXY macro dominates cross-asset
  dxyMacroScoreSigned?: number;
  dominantRegime?: string;
  regimePosterior?: Record<string, number>;
  
  // Cross-asset correlation state
  correlationRegime?: 'RISK_ON' | 'RISK_OFF' | 'DECORRELATED';
  
  // System health
  systemHealth?: {
    status: 'HEALTHY' | 'WARNING' | 'DEGRADED';
    shadowDivergence?: number;
    stabilityScore?: number;
  };
  
  // Notes/warnings
  notes?: string[];
}

export interface WorldStatePack {
  asOf: string;
  
  // All assets
  assets: Record<AssetId, AssetStatePack>;
  
  // Global cross-asset context
  global: GlobalContext;
  
  // P9.0: Cross-asset correlation regime
  crossAsset?: CrossAssetPack;
  
  // Meta
  meta: {
    generatedAt: string;
    engineVersion: string;
    inputsHash?: string; // for determinism check
  };
}

/**
 * Build global context from asset states
 */
export function deriveGlobalContext(assets: Record<AssetId, AssetStatePack>): GlobalContext {
  const dxy = assets.dxy;
  
  const global: GlobalContext = {
    notes: [],
  };
  
  // Extract DXY macro as primary
  if (dxy?.macroV2) {
    global.dxyMacroScoreSigned = dxy.macroV2.scoreSigned;
    global.dominantRegime = dxy.macroV2.regime.name;
    global.regimePosterior = dxy.macroV2.regime.probs;
  }
  
  // Derive correlation regime from guards
  const btcGuard = assets.btc?.guard?.level;
  const spxGuard = assets.spx?.guard?.level;
  
  if (btcGuard === 'CRISIS' || btcGuard === 'BLOCK') {
    global.correlationRegime = 'RISK_OFF';
    global.notes?.push('BTC in crisis mode');
  } else if (dxy?.macroV2?.regime.name === 'STRESS') {
    global.correlationRegime = 'RISK_OFF';
    global.notes?.push('Macro STRESS regime active');
  } else if (dxy?.liquidity?.regime === 'EXPANSION') {
    global.correlationRegime = 'RISK_ON';
  } else {
    global.correlationRegime = 'DECORRELATED';
  }
  
  return global;
}
