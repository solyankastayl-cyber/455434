/**
 * Market Discovery Service
 * 
 * Provides data for the Market Discovery page with ML integration:
 * - decisionImpact: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
 * - affectedTokens: string[]
 * - engineStatus: 'USED_IN_DECISION' | 'WEIGHTED_DOWN' | 'IGNORED'
 * 
 * Market Discovery = вход в Decision System (pre-filter)
 */

import { ERC20LogModel } from '../../onchain/ethereum/logs_erc20.model.js';
import { generateTokenSignals } from './token_signals.service.js';
import { getTokenMetadata } from './coingecko.service.js';

// Types
export type DecisionImpact = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type EngineStatus = 'USED_IN_DECISION' | 'WEIGHTED_DOWN' | 'IGNORED';

export interface UnusualActivityItem {
  address: string;
  symbol: string;
  name: string;
  transferCount: number;
  activeWallets: number;
  // ML integration fields
  decisionImpact: DecisionImpact;
  engineStatus: EngineStatus;
  affectedTokens: string[];
  topSignal?: {
    type: string;
    severity: number;
    title: string;
  };
}

export interface NarrativeItem {
  id: string;
  theme: string;
  category: string;
  pattern: string;
  scope?: string;
  // ML integration fields
  decisionImpact: DecisionImpact;
  tokensAffected: number;
  affectedTokens: string[];
  supportScore: {
    signals: number;
    tokens: number;
  };
}

export interface DeviationWatchlistItem {
  address: string;
  symbol: string;
  name: string;
  signalType: string;
  severity: number;
  deviationFactor: number;
  // ML integration fields
  engineStatus: EngineStatus;
  decisionImpact: DecisionImpact;
  contributesToDecision: boolean;
}

/**
 * Calculate decision impact based on signal severity and token activity
 */
function calculateDecisionImpact(
  severity: number,
  transferCount: number,
  hasSignals: boolean
): DecisionImpact {
  if (!hasSignals) return 'NONE';
  if (severity >= 80 || transferCount > 1000) return 'HIGH';
  if (severity >= 50 || transferCount > 500) return 'MEDIUM';
  if (severity >= 20) return 'LOW';
  return 'NONE';
}

/**
 * Determine engine status based on signal characteristics
 */
function determineEngineStatus(
  severity: number,
  transferCount: number
): EngineStatus {
  // High severity signals with significant activity are used in decisions
  if (severity >= 60 && transferCount >= 100) return 'USED_IN_DECISION';
  // Lower severity signals are weighted down
  if (severity >= 30 || transferCount >= 50) return 'WEIGHTED_DOWN';
  // Otherwise ignored
  return 'IGNORED';
}

/**
 * Get Unusual Activity data (Block 1)
 * Combines: Highest on-chain activity + Unusual on-chain behavior + New wallets activity
 */
export async function getUnusualActivity(limit: number = 10): Promise<{
  items: UnusualActivityItem[];
  totalChecked: number;
  window: string;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Get top active tokens
  const topTokens = await ERC20LogModel.aggregate([
    { $match: { blockTimestamp: { $gte: since } } },
    { $group: {
      _id: '$token',
      transferCount: { $sum: 1 },
      senders: { $addToSet: '$from' },
      receivers: { $addToSet: '$to' },
    }},
    { $project: {
      token: '$_id',
      transferCount: 1,
      walletCount: { $size: { $setUnion: ['$senders', '$receivers'] } },
    }},
    { $sort: { transferCount: -1 } },
    { $limit: limit * 2 }, // Get more for filtering
  ]);
  
  const items: UnusualActivityItem[] = [];
  
  for (const token of topTokens) {
    if (items.length >= limit) break;
    
    const address = token.token.toLowerCase();
    const metadata = getTokenMetadata(address);
    const signalsResult = await generateTokenSignals(address);
    
    const hasSignals = signalsResult.signals.length > 0;
    const topSignal = signalsResult.signals.sort((a, b) => b.severity - a.severity)[0];
    const severity = topSignal?.severity || 0;
    
    items.push({
      address,
      symbol: metadata?.symbol || address.slice(0, 8) + '...',
      name: metadata?.name || 'Unknown Token',
      transferCount: token.transferCount,
      activeWallets: token.walletCount,
      decisionImpact: calculateDecisionImpact(severity, token.transferCount, hasSignals),
      engineStatus: determineEngineStatus(severity, token.transferCount),
      affectedTokens: hasSignals ? [address] : [],
      topSignal: topSignal ? {
        type: topSignal.type,
        severity: topSignal.severity,
        title: topSignal.title,
      } : undefined,
    });
  }
  
  return {
    items,
    totalChecked: topTokens.length,
    window: '24h',
  };
}

/**
 * Get Narratives & Coordination data (Block 2)
 */
export async function getNarrativesWithImpact(limit: number = 5): Promise<{
  items: NarrativeItem[];
  totalNarratives: number;
  window: string;
}> {
  const { buildNarratives } = await import('./narratives/narrative.engine.js');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Get signals from top active tokens
  const topTokens = await ERC20LogModel.aggregate([
    { $match: { blockTimestamp: { $gte: since } } },
    { $group: { _id: '$token', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 30 },
  ]);
  
  // Collect all signals
  const allSignals: any[] = [];
  
  for (const token of topTokens) {
    const address = token._id.toLowerCase();
    const result = await generateTokenSignals(address);
    
    if (result.signals.length > 0) {
      const metadata = getTokenMetadata(address);
      
      for (const signal of result.signals) {
        allSignals.push({
          ...signal,
          tokenAddress: address,
          tokenSymbol: metadata?.symbol || address.slice(0, 8) + '...',
          tokenName: metadata?.name || 'Unknown',
          detectedAt: new Date(),
        });
      }
    }
  }
  
  // Build narratives
  const narratives = await buildNarratives(allSignals, {
    window: '24h',
    maxNarratives: limit,
  });
  
  // Format with ML integration
  const items: NarrativeItem[] = narratives.map((n: any) => {
    const tokensAffected = n.supportScore.tokens || 0;
    const signals = n.supportScore.signals || 0;
    
    // Decision impact based on scope and number of affected tokens
    let decisionImpact: DecisionImpact = 'NONE';
    if (tokensAffected >= 5 || signals >= 10) decisionImpact = 'HIGH';
    else if (tokensAffected >= 3 || signals >= 5) decisionImpact = 'MEDIUM';
    else if (tokensAffected >= 1) decisionImpact = 'LOW';
    
    return {
      id: n.id,
      theme: n.theme,
      category: n.category,
      pattern: n.pattern,
      scope: n.scope,
      decisionImpact,
      tokensAffected,
      affectedTokens: n.evidence.slice(0, 5).map((e: any) => e.token),
      supportScore: n.supportScore,
    };
  });
  
  return {
    items,
    totalNarratives: narratives.length,
    window: '24h',
  };
}

/**
 * Get Deviation Watchlist data (Block 3)
 * Items that may transition to decisions
 */
export async function getDeviationWatchlist(limit: number = 10): Promise<{
  items: DeviationWatchlistItem[];
  totalChecked: number;
  window: string;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Get top tokens
  const topTokens = await ERC20LogModel.aggregate([
    { $match: { blockTimestamp: { $gte: since } } },
    { $group: { _id: '$token', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 25 },
  ]);
  
  const items: DeviationWatchlistItem[] = [];
  
  for (const token of topTokens) {
    if (items.length >= limit) break;
    
    const address = token._id.toLowerCase();
    const metadata = getTokenMetadata(address);
    const signalsResult = await generateTokenSignals(address);
    
    if (signalsResult.signals.length === 0) continue;
    
    // Get top signal
    const topSignal = signalsResult.signals.sort((a, b) => b.severity - a.severity)[0];
    const severity = topSignal.severity;
    
    // Calculate deviation factor from baseline
    const deviationFactor = signalsResult.current && signalsResult.baseline
      ? (signalsResult.current.transferCount / Math.max(signalsResult.baseline.avgTransfers, 1))
      : 1;
    
    const engineStatus = determineEngineStatus(severity, token.count);
    
    items.push({
      address,
      symbol: metadata?.symbol || address.slice(0, 8) + '...',
      name: metadata?.name || 'Unknown Token',
      signalType: topSignal.type,
      severity,
      deviationFactor: Math.round(deviationFactor * 10) / 10,
      engineStatus,
      decisionImpact: calculateDecisionImpact(severity, token.count, true),
      contributesToDecision: engineStatus === 'USED_IN_DECISION',
    });
  }
  
  // Sort by severity
  items.sort((a, b) => b.severity - a.severity);
  
  return {
    items,
    totalChecked: topTokens.length,
    window: '24h',
  };
}

/**
 * Get full Market Discovery data (all 3 blocks)
 */
export async function getMarketDiscoveryData(): Promise<{
  unusualActivity: Awaited<ReturnType<typeof getUnusualActivity>>;
  narratives: Awaited<ReturnType<typeof getNarrativesWithImpact>>;
  deviationWatchlist: Awaited<ReturnType<typeof getDeviationWatchlist>>;
  analyzedAt: string;
}> {
  const [unusualActivity, narratives, deviationWatchlist] = await Promise.all([
    getUnusualActivity(8),
    getNarrativesWithImpact(5),
    getDeviationWatchlist(8),
  ]);
  
  return {
    unusualActivity,
    narratives,
    deviationWatchlist,
    analyzedAt: new Date().toISOString(),
  };
}
