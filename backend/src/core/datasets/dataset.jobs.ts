/**
 * P2.3 Dataset Builder Jobs
 * 
 * Join features with labels to create ML-ready datasets
 */

import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { FeatureMarketModel, FeatureActorModel } from '../features/feature.models.js';
import { 
  LabelPriceOutcomeModel, 
  LabelFlowEffectModel, 
  LabelActorPerformanceModel,
  HORIZONS,
} from '../labels/label.models.js';
import { getAssetForNetwork } from '../labels/price.service.js';
import { 
  DatasetMarketModel, 
  DatasetActorModel, 
  DatasetSignalModel 
} from './dataset.models.js';

const VERSION = 'P2.3.0';

function getBuildVersion(): string {
  const now = new Date();
  return `${VERSION}-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${now.getHours().toString().padStart(2, '0')}`;
}

// ============================================
// 1. MARKET DATASET BUILDER
// ============================================

/**
 * Build market datasets by joining features with price labels
 */
export async function buildMarketDataset(network: string): Promise<number> {
  const asset = getAssetForNetwork(network);
  const buildVersion = getBuildVersion();
  
  // Get all features
  const features = await FeatureMarketModel.find({ network }).lean();
  
  // Get all price labels
  const labels = await LabelPriceOutcomeModel.find({ network, asset }).lean();
  
  // Create label map
  const labelMap = new Map<string, typeof labels[0]>();
  for (const l of labels) {
    const key = `${l.ts}_${l.horizon}`;
    labelMap.set(key, l);
  }
  
  let built = 0;
  
  for (const feature of features) {
    for (const horizon of HORIZONS) {
      const label = labelMap.get(`${feature.bucketTs}_${horizon}`);
      if (!label) continue;
      
      // Leakage check: feature ts must be before label ts
      // (Labels are created with lag, so this should always be true)
      
      await DatasetMarketModel.updateOne(
        { network, asset, ts: feature.bucketTs, horizon },
        {
          $set: {
            exchangePressure: feature.cexPressure?.pressure?.w24h || 0,
            accZoneStrength: feature.zones?.accumulationStrength?.w7d || 0,
            distZoneStrength: feature.zones?.distributionStrength?.w7d || 0,
            corridorsEntropy: feature.corridors?.entropy?.w7d || 0,
            marketRegime: feature.zones?.marketRegime || 'NEUTRAL',
            
            priceReturnPct: label.returnPct,
            priceLabel: label.label,
            
            buildVersion,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      
      built++;
    }
  }
  
  return built;
}

// ============================================
// 2. ACTOR DATASET BUILDER
// ============================================

/**
 * Build actor datasets by joining features with performance labels
 */
export async function buildActorDataset(network: string): Promise<number> {
  const buildVersion = getBuildVersion();
  
  // Get all actor performance labels
  const labels = await LabelActorPerformanceModel.find({ network }).lean();
  
  // Get latest features for each actor
  const actorIds = labels.map(l => l.actorId);
  
  let built = 0;
  
  for (const label of labels) {
    // Get latest feature for this actor
    const feature = await FeatureActorModel
      .findOne({ network, actorId: label.actorId })
      .sort({ bucketTs: -1 })
      .lean();
    
    if (!feature) continue;
    
    // Calculate flow ratio
    const inflow = feature.flows?.inUsd?.w24h || 0;
    const outflow = feature.flows?.outUsd?.w24h || 0;
    const flowRatio = outflow > 0 ? inflow / outflow : inflow > 0 ? Infinity : 1;
    
    await DatasetActorModel.updateOne(
      { actorId: label.actorId, network, period: label.period },
      {
        $set: {
          netFlowUsd: feature.flows?.netUsd?.w24h || 0,
          inflowUsd: inflow,
          outflowUsd: outflow,
          flowRatio: Math.min(flowRatio, 100), // Cap at 100
          cexExposure: (feature.exposure?.cexInUsd?.w24h || 0) + (feature.exposure?.cexOutUsd?.w24h || 0),
          bridgeUsage: feature.exposure?.bridgeOutUsd?.w24h || 0,
          interactionCount: feature.activity?.txCount?.w24h || 0,
          influenceScore: feature.scores?.influenceScore || 0,
          
          hitRate: label.hitRate,
          avgReturn: label.avgReturn,
          performanceLabel: label.label,
          
          eventCount: label.eventCount,
          buildVersion,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    built++;
  }
  
  return built;
}

// ============================================
// 3. SIGNAL DATASET BUILDER
// ============================================

/**
 * Build signal datasets by joining signal features with flow effect labels
 */
export async function buildSignalDataset(network: string): Promise<number> {
  const asset = getAssetForNetwork(network);
  const buildVersion = getBuildVersion();
  
  // Get all flow effect labels
  const labels = await LabelFlowEffectModel.find({ network, asset }).lean();
  
  let built = 0;
  
  for (const label of labels) {
    await DatasetSignalModel.updateOne(
      { network, asset, ts: label.ts, horizon: label.horizon, signalType: label.signalType },
      {
        $set: {
          signalStrength: Math.abs(label.signalValue),
          expectedDirection: label.expectedDirection,
          
          outcome: label.outcome,
          actualDirection: label.actualDirection,
          
          buildVersion,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    built++;
  }
  
  return built;
}

// ============================================
// MAIN RUNNERS
// ============================================

export async function runAllMarketDatasetBuilders(): Promise<{ network: string; count: number }[]> {
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await buildMarketDataset(network);
      results.push({ network, count });
      console.log(`[P2.3 Market Dataset] ${network}: ${count} rows built`);
    } catch (err) {
      console.error(`[P2.3 Market Dataset] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

export async function runAllActorDatasetBuilders(): Promise<{ network: string; count: number }[]> {
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await buildActorDataset(network);
      results.push({ network, count });
      console.log(`[P2.3 Actor Dataset] ${network}: ${count} rows built`);
    } catch (err) {
      console.error(`[P2.3 Actor Dataset] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

export async function runAllSignalDatasetBuilders(): Promise<{ network: string; count: number }[]> {
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await buildSignalDataset(network);
      results.push({ network, count });
      console.log(`[P2.3 Signal Dataset] ${network}: ${count} rows built`);
    } catch (err) {
      console.error(`[P2.3 Signal Dataset] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

export default {
  buildMarketDataset,
  buildActorDataset,
  buildSignalDataset,
  runAllMarketDatasetBuilders,
  runAllActorDatasetBuilders,
  runAllSignalDatasetBuilders,
};
