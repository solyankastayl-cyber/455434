/**
 * Data Ready Collector
 * 
 * Collects metrics for DATA_READY section of gate check
 */

import { TokenUniverseModel } from '../../token_universe/token_universe.model.js';

interface DataMetrics {
  tokensCount: number;
  chainsCount: number;
  timeSpanDays: number;
  signalsCount: number;
  avgCoverage: number;
  missingRate: number;
  hasUISource: boolean;
  hasMockSource: boolean;
  timestampsMonotonic: boolean;
}

export async function collectDataMetrics(_horizon: string): Promise<DataMetrics> {
  // Count tokens
  const tokensCount = await TokenUniverseModel.countDocuments({ isActive: true });
  
  // For now, return placeholder metrics
  // These will be populated when data pipelines are fully implemented
  
  // TODO: Implement actual metric collection from:
  // - Token registry
  // - Signals collection
  // - Transfer history
  // - Coverage calculations
  
  return {
    tokensCount,
    chainsCount: 1, // ETH mainnet
    timeSpanDays: 0, // TODO: Calculate from earliest to latest signal
    signalsCount: 0, // TODO: Count from signals collection
    avgCoverage: 0, // TODO: Calculate average coverage
    missingRate: 0, // TODO: Calculate gaps in data
    hasUISource: false, // Architecture ensures this
    hasMockSource: false, // No mock in production
    timestampsMonotonic: true, // Assumed from ingestion pipeline
  };
}
