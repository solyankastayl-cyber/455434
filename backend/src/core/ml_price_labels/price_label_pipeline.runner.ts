/**
 * Price Label Pipeline Runner
 * 
 * EPIC 9: Main orchestrator for price label generation
 * 
 * Generates ground truth labels with dual-horizon (24h + 7d) validation
 */

import { v4 as uuidv4 } from 'uuid';
import type { 
  PriceLabelRunConfig, 
  PriceLabelRunStats,
  PriceLabel,
  Reaction24hLabel,
  Reaction7dLabel
} from './price_label.types.js';
import { 
  createLabelRun, 
  completeLabelRun, 
  failLabelRun,
  savePriceLabelsBatch,
  getLabelRun,
  getRecentLabelRuns,
  getPriceLabelStats
} from './price_label.store.js';
import { buildPriceLabel } from './price_label_builder.service.js';

interface PriceDataPoint {
  timestamp: Date;
  price: number;
}

interface SignalForLabeling {
  tokenAddress: string;
  signalId?: string;
  signalTimestamp: Date;
}

/**
 * Run the price label pipeline
 */
export async function runPriceLabelPipeline(
  config: PriceLabelRunConfig
): Promise<PriceLabelRunStats> {
  const runId = uuidv4();
  const { maxSignals, priceSource, dryRun } = config;
  
  console.log(`[PriceLabelPipeline] Starting run ${runId}`);
  console.log(`[PriceLabelPipeline] Config:`, { maxSignals, priceSource, dryRun });
  
  try {
    // 1. Create run record
    if (!dryRun) {
      await createLabelRun(runId, { maxSignals, priceSource });
    }
    
    // 2. Get signals to label
    console.log(`[PriceLabelPipeline] Fetching signals...`);
    const signals = await getSignalsForLabeling(config);
    console.log(`[PriceLabelPipeline] Found ${signals.length} signals`);
    
    // 3. Build labels
    console.log(`[PriceLabelPipeline] Building labels...`);
    const labels: PriceLabel[] = [];
    let insufficientCount = 0;
    
    for (const signal of signals) {
      const priceData = await fetchPriceData(signal.tokenAddress, signal.signalTimestamp, priceSource);
      
      if (!priceData) {
        insufficientCount++;
        continue;
      }
      
      const label = buildPriceLabel(
        signal,
        priceData.priceAtSignal,
        priceData.priceHistory24h,
        priceData.priceHistory7d,
        runId,
        priceSource
      );
      
      if (label) {
        labels.push(label);
      } else {
        insufficientCount++;
      }
    }
    
    console.log(`[PriceLabelPipeline] Generated ${labels.length} labels, ${insufficientCount} insufficient`);
    
    // 4. Save labels
    if (!dryRun && labels.length > 0) {
      console.log(`[PriceLabelPipeline] Saving ${labels.length} labels...`);
      await savePriceLabelsBatch(labels);
    }
    
    // 5. Calculate stats
    const stats = calculateRunStats(runId, signals.length, labels, insufficientCount);
    
    // 6. Complete run
    if (!dryRun) {
      await completeLabelRun(runId, stats);
    }
    
    console.log(`[PriceLabelPipeline] Run ${runId} completed`);
    return stats;
    
  } catch (error) {
    console.error(`[PriceLabelPipeline] Run ${runId} failed:`, error);
    
    if (!dryRun) {
      await failLabelRun(runId, error instanceof Error ? error.message : 'Unknown error');
    }
    
    throw error;
  }
}

/**
 * Get signals that need labeling
 */
async function getSignalsForLabeling(config: PriceLabelRunConfig): Promise<SignalForLabeling[]> {
  // TODO: Connect to actual signal collection
  // For now, return empty array
  
  /*
  const query: any = {};
  
  if (config.startDate) {
    query.timestamp = { $gte: config.startDate };
  }
  if (config.endDate) {
    query.timestamp = { ...query.timestamp, $lte: config.endDate };
  }
  
  const signals = await EngineSignalModel.find(query)
    .sort({ timestamp: -1 })
    .limit(config.maxSignals)
    .lean();
  
  return signals.map(s => ({
    tokenAddress: s.tokenAddress,
    signalId: s._id.toString(),
    signalTimestamp: s.timestamp,
  }));
  */
  
  return [];
}

/**
 * Fetch price data for a token
 */
async function fetchPriceData(
  tokenAddress: string,
  signalTimestamp: Date,
  priceSource: string
): Promise<{
  priceAtSignal: number;
  priceHistory24h: PriceDataPoint[];
  priceHistory7d: PriceDataPoint[];
} | null> {
  // TODO: Connect to actual price data source (CoinGecko, DEX aggregator, etc.)
  
  /*
  const priceAtSignal = await getPriceAtTime(tokenAddress, signalTimestamp);
  
  if (!priceAtSignal) return null;
  
  const time24h = new Date(signalTimestamp.getTime() + 24 * 60 * 60 * 1000);
  const time7d = new Date(signalTimestamp.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const history24h = await getPriceHistory(tokenAddress, signalTimestamp, time24h, '1h');
  const history7d = await getPriceHistory(tokenAddress, signalTimestamp, time7d, '4h');
  
  return {
    priceAtSignal,
    priceHistory24h: history24h,
    priceHistory7d: history7d,
  };
  */
  
  return null;
}

/**
 * Calculate run statistics
 */
function calculateRunStats(
  runId: string,
  signalsProcessed: number,
  labels: PriceLabel[],
  insufficientData: number
): PriceLabelRunStats {
  // Distribution 24h
  const distribution24h: Record<Reaction24hLabel, number> = {
    STRONG_UP: 0,
    WEAK_UP: 0,
    FLAT: 0,
    DOWN: 0,
  };
  
  // Distribution 7d
  const distribution7d: Record<Reaction7dLabel, number> = {
    FOLLOW_THROUGH: 0,
    FADED: 0,
    REVERSED: 0,
    NOISE: 0,
  };
  
  // Quality distribution
  const qualityDistribution: Record<string, number> = {};
  
  let positiveCount = 0;
  
  for (const label of labels) {
    distribution24h[label.label24h]++;
    distribution7d[label.label7d]++;
    
    const quality = label.pairLabel.signalQuality;
    qualityDistribution[quality] = (qualityDistribution[quality] || 0) + 1;
    
    if (label.binaryLabel === 1) {
      positiveCount++;
    }
  }
  
  return {
    runId,
    startedAt: new Date(),
    status: 'COMPLETED',
    signalsProcessed,
    labelsGenerated: labels.length,
    insufficientData,
    distribution24h,
    distribution7d,
    qualityDistribution,
    positiveRatio: labels.length > 0 ? positiveCount / labels.length : 0,
    errors: [],
  };
}

/**
 * Get run status
 */
export async function getLabelRunStatus(runId: string): Promise<PriceLabelRunStats | null> {
  const run = await getLabelRun(runId);
  if (!run) return null;
  
  return {
    runId: run.runId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status as 'RUNNING' | 'COMPLETED' | 'FAILED',
    signalsProcessed: run.signalsProcessed,
    labelsGenerated: run.labelsGenerated,
    insufficientData: run.insufficientData,
    distribution24h: run.distribution24h as Record<Reaction24hLabel, number>,
    distribution7d: run.distribution7d as Record<Reaction7dLabel, number>,
    qualityDistribution: run.qualityDistribution,
    positiveRatio: run.positiveRatio,
    errors: run.errors,
  };
}

export { getRecentLabelRuns, getPriceLabelStats };
