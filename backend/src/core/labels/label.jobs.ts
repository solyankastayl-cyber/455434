/**
 * P2.2 Labeling Jobs
 * 
 * Jobs to compute labels from features + prices
 */

import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { FeatureMarketModel, FeatureActorModel } from '../features/feature.models.js';
import {
  LabelPriceOutcomeModel,
  LabelFlowEffectModel,
  LabelActorPerformanceModel,
  HORIZONS,
  getPriceLabel,
  getExpectedDirection,
  getActualDirection,
  getFlowOutcome,
  getPerformanceLabel,
  horizonToSeconds,
  type Horizon,
} from './label.models.js';
import { getAssetForNetwork, getFuturePrice } from './price.service.js';

const VERSION = 'P2.2.0';

// ============================================
// 1. PRICE OUTCOME LABELER
// ============================================

/**
 * Label price outcomes for a network
 * Runs every 1h with min 24h lag
 */
export async function runPriceOutcomeLabeler(network: string): Promise<number> {
  const asset = getAssetForNetwork(network);
  const nowTs = Math.floor(Date.now() / 1000);
  
  // Look back at market features, with lag for future prices
  const maxHorizon = horizonToSeconds('24h');
  const lookbackTs = nowTs - (7 * 86400); // 7 days back
  const cutoffTs = nowTs - maxHorizon; // Need future prices to exist
  
  // Get market features that need labeling
  const features = await FeatureMarketModel.find({
    network,
    bucketTs: { $gte: lookbackTs, $lte: cutoffTs },
  }).lean();
  
  let labeled = 0;
  
  for (const feature of features) {
    for (const horizon of HORIZONS) {
      // Check if already labeled
      const existing = await LabelPriceOutcomeModel.findOne({
        network,
        asset,
        ts: feature.bucketTs,
        horizon,
      });
      
      if (existing) continue;
      
      // Get price data
      const priceData = await getFuturePrice(network, feature.bucketTs, horizonToSeconds(horizon));
      const label = getPriceLabel(priceData.returnPct);
      
      // Create label
      await LabelPriceOutcomeModel.updateOne(
        { network, asset, ts: feature.bucketTs, horizon },
        {
          $set: {
            priceNow: priceData.priceNow,
            priceFuture: priceData.priceFuture,
            returnPct: Math.round(priceData.returnPct * 10000) / 10000,
            label,
            meta: {
              computedAtTs: nowTs,
              version: VERSION,
            },
          },
        },
        { upsert: true }
      );
      
      labeled++;
    }
  }
  
  return labeled;
}

// ============================================
// 2. FLOW EFFECT LABELER
// ============================================

/**
 * Label flow effects by comparing signals to price outcomes
 * Runs every 4h
 */
export async function runFlowEffectLabeler(network: string): Promise<number> {
  const asset = getAssetForNetwork(network);
  const nowTs = Math.floor(Date.now() / 1000);
  
  // Get price labels
  const priceLabels = await LabelPriceOutcomeModel.find({
    network,
    asset,
  }).lean();
  
  if (priceLabels.length === 0) return 0;
  
  // Create map for quick lookup
  const priceLabelMap = new Map<string, typeof priceLabels[0]>();
  for (const pl of priceLabels) {
    const key = `${pl.ts}_${pl.horizon}`;
    priceLabelMap.set(key, pl);
  }
  
  // Get market features
  const features = await FeatureMarketModel.find({ network }).lean();
  
  let labeled = 0;
  
  for (const feature of features) {
    for (const horizon of HORIZONS) {
      const priceLabel = priceLabelMap.get(`${feature.bucketTs}_${horizon}`);
      if (!priceLabel) continue;
      
      // Check if already labeled for PRESSURE
      const existingPressure = await LabelFlowEffectModel.findOne({
        network, asset, ts: feature.bucketTs, horizon, signalType: 'PRESSURE',
      });
      
      if (!existingPressure) {
        // Label PRESSURE signal
        const pressureValue = feature.cexPressure?.pressure?.w24h || 0;
        const expected = getExpectedDirection(pressureValue, 'PRESSURE');
        const actual = getActualDirection(priceLabel.returnPct);
        const outcome = getFlowOutcome(expected, actual, priceLabel.returnPct);
        
        await LabelFlowEffectModel.updateOne(
          { network, asset, ts: feature.bucketTs, horizon, signalType: 'PRESSURE' },
          {
            $set: {
              signalValue: pressureValue,
              expectedDirection: expected,
              actualDirection: actual,
              outcome,
              meta: { computedAtTs: nowTs, version: VERSION },
            },
          },
          { upsert: true }
        );
        labeled++;
      }
      
      // Check if already labeled for ZONE
      const existingZone = await LabelFlowEffectModel.findOne({
        network, asset, ts: feature.bucketTs, horizon, signalType: 'ZONE',
      });
      
      if (!existingZone) {
        // Label ZONE signal
        const accStrength = feature.zones?.accumulationStrength?.w7d || 0.5;
        const expected = getExpectedDirection(accStrength, 'ZONE');
        const actual = getActualDirection(priceLabel.returnPct);
        const outcome = getFlowOutcome(expected, actual, priceLabel.returnPct);
        
        await LabelFlowEffectModel.updateOne(
          { network, asset, ts: feature.bucketTs, horizon, signalType: 'ZONE' },
          {
            $set: {
              signalValue: accStrength,
              expectedDirection: expected,
              actualDirection: actual,
              outcome,
              meta: { computedAtTs: nowTs, version: VERSION },
            },
          },
          { upsert: true }
        );
        labeled++;
      }
    }
  }
  
  return labeled;
}

// ============================================
// 3. ACTOR PERFORMANCE LABELER
// ============================================

/**
 * Label actor performance based on hit rate
 * Runs every 24h
 */
export async function runActorPerformanceLabeler(network: string): Promise<number> {
  const asset = getAssetForNetwork(network);
  const nowTs = Math.floor(Date.now() / 1000);
  const minEvents = 10;
  
  // Get price labels for 24h horizon (most relevant for actor evaluation)
  const priceLabels = await LabelPriceOutcomeModel.find({
    network,
    asset,
    horizon: '24h',
  }).lean();
  
  if (priceLabels.length < minEvents) return 0;
  
  // Get actor features
  const actors = await FeatureActorModel.find({ network }).lean();
  
  // Group price labels by timestamp
  const priceLabelMap = new Map<number, typeof priceLabels[0]>();
  for (const pl of priceLabels) {
    priceLabelMap.set(pl.ts, pl);
  }
  
  let labeled = 0;
  
  for (const actor of actors) {
    const priceLabel = priceLabelMap.get(actor.bucketTs);
    if (!priceLabel) continue;
    
    // Calculate hit for this actor at this point
    const actorNetFlow = actor.flows?.netUsd?.w24h || 0;
    const priceReturn = priceLabel.returnPct;
    
    // Hit if actor direction matches price direction
    const actorDirection = actorNetFlow > 0 ? 1 : actorNetFlow < 0 ? -1 : 0;
    const priceDirection = priceReturn > 0.01 ? 1 : priceReturn < -0.01 ? -1 : 0;
    const hit = actorDirection === priceDirection || actorDirection === 0;
    
    // Get or create running stats for this actor
    const existing = await LabelActorPerformanceModel.findOne({
      actorId: actor.actorId,
      network,
      period: '30d',
    });
    
    const prevHits = existing ? existing.hitRate * existing.eventCount : 0;
    const prevReturns = existing ? existing.avgReturn * existing.eventCount : 0;
    const prevCount = existing?.eventCount || 0;
    
    const newCount = prevCount + 1;
    const newHits = prevHits + (hit ? 1 : 0);
    const newReturns = prevReturns + priceReturn;
    
    const hitRate = newHits / newCount;
    const avgReturn = newReturns / newCount;
    const label = getPerformanceLabel(hitRate, avgReturn);
    
    await LabelActorPerformanceModel.updateOne(
      { actorId: actor.actorId, network, period: '30d' },
      {
        $set: {
          eventCount: newCount,
          hitRate: Math.round(hitRate * 1000) / 1000,
          avgReturn: Math.round(avgReturn * 10000) / 10000,
          label,
          meta: { computedAtTs: nowTs, version: VERSION },
        },
      },
      { upsert: true }
    );
    
    labeled++;
  }
  
  return labeled;
}

// ============================================
// MAIN RUNNERS
// ============================================

/**
 * Run all price outcome labelers
 */
export async function runAllPriceOutcomeLabelers(): Promise<{ network: string; count: number }[]> {
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await runPriceOutcomeLabeler(network);
      results.push({ network, count });
      console.log(`[P2.2 Price Labels] ${network}: ${count} labels created`);
    } catch (err) {
      console.error(`[P2.2 Price Labels] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

/**
 * Run all flow effect labelers
 */
export async function runAllFlowEffectLabelers(): Promise<{ network: string; count: number }[]> {
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await runFlowEffectLabeler(network);
      results.push({ network, count });
      console.log(`[P2.2 Flow Labels] ${network}: ${count} labels created`);
    } catch (err) {
      console.error(`[P2.2 Flow Labels] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

/**
 * Run all actor performance labelers
 */
export async function runAllActorPerformanceLabelers(): Promise<{ network: string; count: number }[]> {
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await runActorPerformanceLabeler(network);
      results.push({ network, count });
      console.log(`[P2.2 Actor Labels] ${network}: ${count} labels created`);
    } catch (err) {
      console.error(`[P2.2 Actor Labels] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

export default {
  runPriceOutcomeLabeler,
  runFlowEffectLabeler,
  runActorPerformanceLabeler,
  runAllPriceOutcomeLabelers,
  runAllFlowEffectLabelers,
  runAllActorPerformanceLabelers,
};
