/**
 * ALT SCANNER DATA COLLECTION JOB
 * ================================
 * 
 * Periodic job for:
 * 1. Saving daily snapshots to MongoDB
 * 2. Recording outcomes for past predictions
 * 3. Accumulating ClusterLearningSamples for ML training
 */

import { altScannerService } from '../alt-scanner.service.js';
import { patternMemoryService } from '../pattern-memory/pattern-memory.service.js';
import { shadowPortfolioService } from '../shadow/shadow-portfolio.service.js';
import { clusterFeatureBuilder } from '../ml/feature-builder.service.js';
import { clusterOutcomeModel } from '../ml/cluster-outcome.model.js';
import { replayEngineService } from '../replay/replay-engine.service.js';
import { getSector } from '../portfolio-filter/portfolio-filter.types.js';
import type { ClusterLearningSample, ClusterFeatureVector } from '../ml/ml.types.js';

// MongoDB repositories
import { 
  clusterSampleRepo, 
  shadowTradeRepo, 
  snapshotRepo,
  patternPerfRepo,
} from '../db/alt-scanner.repo.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const COLLECTION_INTERVAL = 5 * 60 * 1000; // 5 minutes
const OUTCOME_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

let collectionHandle: NodeJS.Timeout | null = null;
let outcomeHandle: NodeJS.Timeout | null = null;

// Storage for pending predictions
interface PendingPrediction {
  id: string;
  symbol: string;
  clusterId: string;
  patternLabel: string;
  direction: 'UP' | 'DOWN';
  entryPrice: number;
  entryTime: number;
  confidence: number;
  regime: string;
  sector: string;
  horizonMs: number;
  features: ClusterFeatureVector;
}

const pendingPredictions: Map<string, PendingPrediction> = new Map();

// ═══════════════════════════════════════════════════════════════
// DATA COLLECTION
// ═══════════════════════════════════════════════════════════════

async function collectSnapshot(): Promise<void> {
  try {
    console.log('[DataCollector] Starting snapshot collection...');
    
    // Run full scan
    const scanResult = await altScannerService.scan(true);
    
    // Get market context
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    // Save snapshot for replay
    replayEngineService.recordSnapshot(
      scanResult.radar.venue,
      scanResult.ranking.opportunities.map(o => o.vector)
    );
    
    // Save daily snapshot to MongoDB
    try {
      await snapshotRepo.save({
        venue: scanResult.radar.venue,
        totalAssets: scanResult.radar.universeSize,
        totalClusters: scanResult.clustering.clusters.length,
        topLongsCount: scanResult.ranking.topLongs.length,
        topShortsCount: scanResult.ranking.topShorts.length,
        marketRegime: marketContext.marketRegime,
        btcVolatility: marketContext.btcVolatility,
        topOpportunities: scanResult.ranking.opportunities.slice(0, 10).map(o => ({
          symbol: o.symbol,
          direction: o.direction,
          score: o.opportunityScore,
          clusterId: o.clusterId ?? '',
        })),
        activeClusters: scanResult.clustering.clusters.map(c => ({
          clusterId: c.clusterId,
          label: c.label ?? 'Unknown',
          memberCount: c.members.length,
          avgScore: c.performance?.avgReturn ?? 0,
        })),
        mlSamples: clusterOutcomeModel.getStats().totalSamples,
        mlAccuracy: clusterOutcomeModel.getStats().accuracy,
      });
    } catch (dbErr) {
      console.warn('[DataCollector] Failed to save snapshot to MongoDB:', dbErr);
    }
    
    // Process top opportunities for learning
    const topOpps = [
      ...scanResult.ranking.topLongs.slice(0, 5),
      ...scanResult.ranking.topShorts.slice(0, 5),
    ];
    
    for (const opp of topOpps) {
      if (!opp.clusterId) continue;
      
      // Build cluster features
      const clusterMembers = scanResult.ranking.opportunities.filter(
        o => o.clusterId === opp.clusterId
      );
      
      const features = clusterFeatureBuilder.buildClusterFeatures(
        opp.clusterId,
        clusterMembers.map(m => m.vector)
      );
      
      // Get entry price
      const entryPrice = opp.vector.meta?.lastPrice ?? 0;
      if (entryPrice === 0) continue;
      
      // Create pending prediction for outcome tracking
      const predictionId = `${opp.symbol}-${opp.clusterId}-${Date.now()}`;
      
      pendingPredictions.set(predictionId, {
        id: predictionId,
        symbol: opp.symbol,
        clusterId: opp.clusterId,
        patternLabel: opp.clusterLabel ?? 'Unknown',
        direction: opp.direction === 'UP' ? 'UP' : 'DOWN',
        entryPrice,
        entryTime: Date.now(),
        confidence: opp.confidence,
        regime: marketContext.marketRegime,
        sector: getSector(opp.symbol),
        horizonMs: 4 * 60 * 60 * 1000, // 4h default
        features,
      });
      
      // Save shadow trade to MongoDB
      try {
        await shadowTradeRepo.create({
          tradeId: predictionId,
          symbol: opp.symbol,
          venue: scanResult.radar.venue,
          direction: opp.direction === 'UP' ? 'UP' : 'DOWN',
          entryPrice,
          clusterId: opp.clusterId,
          patternLabel: opp.clusterLabel ?? 'Unknown',
          confidence: opp.confidence,
          regime: marketContext.marketRegime,
          sector: getSector(opp.symbol),
          horizon: '4h',
          status: 'OPEN',
        });
      } catch (dbErr) {
        // Ignore duplicate key errors
      }
      
      // Record in shadow portfolio (in-memory)
      shadowPortfolioService.recordDecision({
        id: predictionId,
        symbol: opp.symbol,
        timestamp: Date.now(),
        decision: 'ENTER',
        clusterId: opp.clusterId,
        confidence: opp.confidence,
        expectedOutcome: opp.direction === 'UP' ? 'BULLISH' : 'BEARISH',
      });
    }
    
    console.log(`[DataCollector] Snapshot collected: ${topOpps.length} predictions tracked`);
  } catch (error) {
    console.error('[DataCollector] Snapshot collection failed:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME TRACKING
// ═══════════════════════════════════════════════════════════════

async function checkOutcomes(): Promise<void> {
  try {
    console.log('[DataCollector] Checking outcomes...');
    
    const now = Date.now();
    const completed: string[] = [];
    
    for (const [id, prediction] of pendingPredictions) {
      // Check if horizon has passed
      if (now - prediction.entryTime < prediction.horizonMs) {
        continue;
      }
      
      // Get current price
      const scanResult = await altScannerService.scan();
      const currentOpp = scanResult.ranking.opportunities.find(
        o => o.symbol === prediction.symbol
      );
      
      if (!currentOpp) {
        completed.push(id);
        continue;
      }
      
      const exitPrice = currentOpp.vector.meta?.lastPrice ?? 0;
      if (exitPrice === 0) {
        completed.push(id);
        continue;
      }
      
      // Calculate return
      const returnPct = prediction.direction === 'UP'
        ? ((exitPrice - prediction.entryPrice) / prediction.entryPrice) * 100
        : ((prediction.entryPrice - exitPrice) / prediction.entryPrice) * 100;
      
      // Determine outcome
      const outcome: 'HIT' | 'MISS' | 'NEUTRAL' = 
        returnPct >= 2 ? 'HIT' :
        returnPct <= -2 ? 'MISS' : 'NEUTRAL';
      
      const outcomeClass: 'UP' | 'DOWN' | 'FLAT' = 
        returnPct >= 2 ? 'UP' :
        returnPct <= -2 ? 'DOWN' : 'FLAT';
      
      // Create learning sample
      const sample: ClusterLearningSample = {
        clusterId: prediction.clusterId,
        features: prediction.features,
        outcome,
        returnPct,
        horizon: '4h',
        timestamp: prediction.entryTime,
        venue: scanResult.radar.venue,
        regime: prediction.regime,
        sampleCount: 1,
      };
      
      // Feed to ML model (in-memory)
      clusterOutcomeModel.addSample(sample);
      
      // Save learning sample to MongoDB
      try {
        await clusterSampleRepo.save({
          clusterId: prediction.clusterId,
          venue: scanResult.radar.venue,
          avgRsi: prediction.features.avgRsi,
          avgFunding: prediction.features.avgFunding,
          avgOiDelta: prediction.features.avgOiDelta,
          avgMomentum1h: prediction.features.avgMomentum1h,
          avgMomentum4h: prediction.features.avgMomentum4h,
          avgMomentum24h: prediction.features.avgMomentum24h,
          avgVolatility: prediction.features.avgVolatility,
          avgLiquidity: prediction.features.avgLiquidity,
          memberCount: prediction.features.memberCount,
          rsiStd: prediction.features.rsiStd,
          fundingStd: prediction.features.fundingStd,
          btcVolatility: prediction.features.contextBtcVolatility,
          marketRegime: prediction.regime,
          fundingGlobal: prediction.features.contextFundingGlobal,
          outcomeClass,
          returnPct,
          horizon: '4h',
          timestamp: new Date(prediction.entryTime),
        });
      } catch (dbErr) {
        console.warn('[DataCollector] Failed to save sample to MongoDB:', dbErr);
      }
      
      // Update shadow trade in MongoDB
      try {
        await shadowTradeRepo.close(
          prediction.id, 
          exitPrice, 
          returnPct, 
          outcome === 'HIT' ? 'TP' : outcome === 'MISS' ? 'FP' : 'WEAK'
        );
      } catch (dbErr) {
        // Ignore errors
      }
      
      // Update pattern performance in MongoDB
      try {
        const isWin = outcome === 'HIT';
        await patternPerfRepo.incrementTrade(prediction.clusterId, isWin, returnPct);
      } catch (dbErr) {
        // Ignore errors
      }
      
      // Record in pattern memory (in-memory)
      patternMemoryService.recordOutcome(
        prediction.clusterId,
        prediction.patternLabel,
        prediction.symbol,
        scanResult.radar.venue,
        prediction.entryPrice,
        exitPrice,
        prediction.direction,
        '4h',
        prediction.confidence,
        prediction.regime,
        prediction.sector
      );
      
      // Update shadow portfolio (in-memory)
      shadowPortfolioService.recordOutcome({
        predictionId: prediction.id,
        symbol: prediction.symbol,
        exitPrice,
        returnPct,
        outcome: outcome === 'HIT' ? 'TP' : outcome === 'MISS' ? 'FP' : 'WEAK',
        timestamp: now,
      });
      
      console.log(`[DataCollector] Outcome: ${prediction.symbol} ${prediction.direction} => ${outcome} (${returnPct.toFixed(2)}%)`);
      
      completed.push(id);
    }
    
    // Clean up completed predictions
    for (const id of completed) {
      pendingPredictions.delete(id);
    }
    
    // Get stats from MongoDB
    let dbSampleCount = 0;
    try {
      dbSampleCount = await clusterSampleRepo.count();
    } catch (err) {
      // Ignore
    }
    
    // Log stats
    const modelStats = clusterOutcomeModel.getStats();
    console.log(`[DataCollector] ML samples (memory): ${modelStats.totalSamples}, DB: ${dbSampleCount}, Pending: ${pendingPredictions.size}`);
    
    // Auto-train if we have enough samples
    if (modelStats.totalSamples >= 100 && modelStats.totalSamples % 50 === 0) {
      console.log('[DataCollector] Triggering ML model training...');
      clusterOutcomeModel.train();
    }
    
  } catch (error) {
    console.error('[DataCollector] Outcome check failed:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// JOB CONTROL
// ═══════════════════════════════════════════════════════════════

export function startDataCollection(): void {
  if (collectionHandle) {
    console.log('[DataCollector] Already running');
    return;
  }
  
  console.log('[DataCollector] Starting data collection job...');
  
  // Run immediately
  collectSnapshot();
  
  // Schedule periodic collection
  collectionHandle = setInterval(collectSnapshot, COLLECTION_INTERVAL);
  
  // Schedule outcome checking
  outcomeHandle = setInterval(checkOutcomes, OUTCOME_CHECK_INTERVAL);
  
  console.log(`[DataCollector] Job started (collect every ${COLLECTION_INTERVAL / 1000}s, outcomes every ${OUTCOME_CHECK_INTERVAL / 1000}s)`);
}

export function stopDataCollection(): void {
  if (collectionHandle) {
    clearInterval(collectionHandle);
    collectionHandle = null;
  }
  if (outcomeHandle) {
    clearInterval(outcomeHandle);
    outcomeHandle = null;
  }
  console.log('[DataCollector] Job stopped');
}

export function getCollectionStats(): {
  pendingPredictions: number;
  isRunning: boolean;
} {
  return {
    pendingPredictions: pendingPredictions.size,
    isRunning: collectionHandle !== null,
  };
}

// ═══════════════════════════════════════════════════════════════
// AUTO-START ON IMPORT (optional)
// ═══════════════════════════════════════════════════════════════

// Uncomment to auto-start:
// startDataCollection();

console.log('[ExchangeAlt] Data Collection Job loaded');
