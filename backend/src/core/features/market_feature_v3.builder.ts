/**
 * V3.0 Pack A - Market Feature Builder
 * 
 * A) CEX Pressure v3 (History + Spikes)
 * B) Zones v3 (Persistence + Decay + Quality)
 * 
 * Runs every 5 minutes for real-time spike detection
 */

import { 
  FeatureMarketModel, 
  toBucket, 
  clamp01,
} from './feature.models.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { ZoneModel } from '../zones/zones.routes.js';
import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { getCexAddresses } from '../market/exchange_pressure.routes.js';

const BUCKET_SEC = 300; // 5 minutes for v3 granularity
const VERSION = 'V3.0.0';

// Spike detection thresholds
const SPIKE_THRESHOLD_MEDIUM = 0.15; // 15% deviation
const SPIKE_THRESHOLD_HIGH = 0.30;   // 30% deviation

// Decay half-life in days
const ZONE_DECAY_HALF_LIFE = 3;

// ============================================
// A) CEX PRESSURE V3 - HISTORY + SPIKES
// ============================================

interface CexPressureResult {
  pressure_5m: number;
  pressure_1h: number;
  pressure_1d: number;
  inDelta_1h: number;
  outDelta_1h: number;
  spikeLevel: 'NONE' | 'MEDIUM' | 'HIGH';
  spikeDirection: 'BUY' | 'SELL' | null;
}

async function buildCexPressureV3(
  network: string,
  bucketTs: number,
  cexAddresses: Set<string>
): Promise<CexPressureResult> {
  const now = bucketTs * 1000;
  
  // Time windows
  const since5m = new Date(now - 5 * 60 * 1000);
  const since1h = new Date(now - 60 * 60 * 1000);
  const since1d = new Date(now - 24 * 60 * 60 * 1000);
  const since2h = new Date(now - 2 * 60 * 60 * 1000);
  
  const cexArray = Array.from(cexAddresses);
  
  // Parallel queries for different windows
  const [
    cexIn5m, cexOut5m,
    cexIn1h, cexOut1h,
    cexIn1d, cexOut1d,
    cexIn2h, cexOut2h,
  ] = await Promise.all([
    // 5m window
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since5m },
      to: { $in: cexArray },
    }),
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since5m },
      from: { $in: cexArray },
    }),
    // 1h window
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since1h },
      to: { $in: cexArray },
    }),
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since1h },
      from: { $in: cexArray },
    }),
    // 1d window
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since1d },
      to: { $in: cexArray },
    }),
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since1d },
      from: { $in: cexArray },
    }),
    // 2h window (for delta calculation)
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since2h, $lt: since1h },
      to: { $in: cexArray },
    }),
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since2h, $lt: since1h },
      from: { $in: cexArray },
    }),
  ]);
  
  // Calculate pressure: (IN - OUT) / (IN + OUT)
  const calcPressure = (inVal: number, outVal: number): number => {
    const total = inVal + outVal;
    if (total === 0) return 0;
    return Math.round(((inVal - outVal) / total) * 1000) / 1000;
  };
  
  const pressure_5m = calcPressure(cexIn5m, cexOut5m);
  const pressure_1h = calcPressure(cexIn1h, cexOut1h);
  const pressure_1d = calcPressure(cexIn1d, cexOut1d);
  
  // Calculate deltas (current 1h vs previous 1h)
  const prevIn = cexIn2h;
  const prevOut = cexOut2h;
  const currIn = cexIn1h - cexIn2h; // Only last hour
  const currOut = cexOut1h - cexOut2h;
  
  const inDelta_1h = prevIn > 0 ? (currIn - prevIn) / prevIn : currIn > 0 ? 1 : 0;
  const outDelta_1h = prevOut > 0 ? (currOut - prevOut) / prevOut : currOut > 0 ? 1 : 0;
  
  // Spike detection: compare 5m pressure to 1h average
  const pressureDeviation = Math.abs(pressure_5m - pressure_1h);
  
  let spikeLevel: 'NONE' | 'MEDIUM' | 'HIGH' = 'NONE';
  let spikeDirection: 'BUY' | 'SELL' | null = null;
  
  if (pressureDeviation >= SPIKE_THRESHOLD_HIGH) {
    spikeLevel = 'HIGH';
    spikeDirection = pressure_5m < pressure_1h ? 'BUY' : 'SELL';
  } else if (pressureDeviation >= SPIKE_THRESHOLD_MEDIUM) {
    spikeLevel = 'MEDIUM';
    spikeDirection = pressure_5m < pressure_1h ? 'BUY' : 'SELL';
  }
  
  return {
    pressure_5m: Math.round(pressure_5m * 1000) / 1000,
    pressure_1h: Math.round(pressure_1h * 1000) / 1000,
    pressure_1d: Math.round(pressure_1d * 1000) / 1000,
    inDelta_1h: Math.round(inDelta_1h * 1000) / 1000,
    outDelta_1h: Math.round(outDelta_1h * 1000) / 1000,
    spikeLevel,
    spikeDirection,
  };
}

// ============================================
// B) ZONES V3 - PERSISTENCE + DECAY + QUALITY
// ============================================

interface ZonesV3Result {
  persistence_7d: number;
  persistence_30d: number;
  decayScore: number;
  qualityScore: number;
  confirmedStreak: number;
  lastConfirmedAt: number | undefined;
}

async function buildZonesV3(
  network: string,
  bucketTs: number
): Promise<ZonesV3Result> {
  const now = bucketTs * 1000;
  
  // Get all zones for this network
  const zones = await ZoneModel.find({ network }).lean();
  
  if (zones.length === 0) {
    return {
      persistence_7d: 0,
      persistence_30d: 0,
      decayScore: 0,
      qualityScore: 0,
      confirmedStreak: 0,
      lastConfirmedAt: undefined,
    };
  }
  
  // Calculate persistence: how many days have zones been active
  // (simplified: use zone count as proxy for persistence)
  const strongZones = zones.filter((z: any) => z.strength === 'STRONG');
  const moderateZones = zones.filter((z: any) => z.strength === 'MODERATE');
  
  // Persistence score: weighted by strength
  const persistence_7d = clamp01(
    (strongZones.length * 3 + moderateZones.length) / 30 // Normalize to 0-1
  );
  
  const persistence_30d = clamp01(
    (strongZones.length * 3 + moderateZones.length) / 50 // More lenient for 30d
  );
  
  // Decay: based on last activity
  // Find most recent zone activity
  const lastActivities = zones
    .map((z: any) => z.lastActivity ? new Date(z.lastActivity).getTime() : 0)
    .filter((t: number) => t > 0);
  
  const lastConfirmedAt = lastActivities.length > 0 
    ? Math.max(...lastActivities) 
    : undefined;
  
  // Calculate decay score
  let decayScore = 0;
  if (lastConfirmedAt) {
    const daysSinceConfirmation = (now - lastConfirmedAt) / (24 * 60 * 60 * 1000);
    decayScore = Math.exp(-daysSinceConfirmation / ZONE_DECAY_HALF_LIFE);
    decayScore = Math.round(decayScore * 1000) / 1000;
  }
  
  // Confirmed streak: count of consecutive "strong" confirmations
  const confirmedStreak = strongZones.length;
  
  // Quality score: combination of persistence, decay, and strength
  const strengthScore = clamp01(strongZones.length / (zones.length || 1));
  const qualityScore = clamp01(
    persistence_7d * 0.3 +
    decayScore * 0.4 +
    strengthScore * 0.3
  );
  
  return {
    persistence_7d: Math.round(persistence_7d * 1000) / 1000,
    persistence_30d: Math.round(persistence_30d * 1000) / 1000,
    decayScore,
    qualityScore: Math.round(qualityScore * 1000) / 1000,
    confirmedStreak,
    lastConfirmedAt: lastConfirmedAt ? Math.floor(lastConfirmedAt / 1000) : undefined,
  };
}

// ============================================
// MAIN BUILDER
// ============================================

async function buildMarketFeaturesV3(
  network: string, 
  bucketTs: number
): Promise<boolean> {
  const cexAddresses = getCexAddresses(network);
  
  // Build A) CEX Pressure v3
  const cexPressureV3 = await buildCexPressureV3(network, bucketTs, cexAddresses);
  
  // Build B) Zones v3
  const zonesV3 = await buildZonesV3(network, bucketTs);
  
  // Upsert to feature_market_timeseries
  await FeatureMarketModel.updateOne(
    { network, bucketTs },
    {
      $set: {
        cexPressureV3,
        zonesV3,
        'meta.computedAtTs': Math.floor(Date.now() / 1000),
        'meta.version': VERSION,
      },
    },
    { upsert: true }
  );
  
  return true;
}

/**
 * Run V3 market feature builder for all networks
 */
export async function runMarketFeatureV3Builder(): Promise<{ 
  network: string; 
  success: boolean;
  cexSpike?: string;
  zoneQuality?: number;
}[]> {
  const bucketTs = toBucket(Math.floor(Date.now() / 1000), BUCKET_SEC);
  const results: { 
    network: string; 
    success: boolean;
    cexSpike?: string;
    zoneQuality?: number;
  }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      await buildMarketFeaturesV3(network, bucketTs);
      
      // Get the computed values for logging
      const doc = await FeatureMarketModel.findOne(
        { network, bucketTs },
        { cexPressureV3: 1, zonesV3: 1 }
      ).lean();
      
      results.push({ 
        network, 
        success: true,
        cexSpike: (doc as any)?.cexPressureV3?.spikeLevel || 'NONE',
        zoneQuality: (doc as any)?.zonesV3?.qualityScore || 0,
      });
      
      const spike = (doc as any)?.cexPressureV3?.spikeLevel;
      if (spike && spike !== 'NONE') {
        console.log(`[V3 Market Features] ${network}: CEX SPIKE ${spike} detected!`);
      }
      
    } catch (err) {
      console.error(`[V3 Market Features] ${network} error:`, err);
      results.push({ network, success: false });
    }
  }
  
  console.log(`[V3 Market Features] Processed ${results.filter(r => r.success).length}/${SUPPORTED_NETWORKS.length} networks`);
  
  return results;
}

export default { 
  runMarketFeatureV3Builder, 
  buildMarketFeaturesV3,
  buildCexPressureV3,
  buildZonesV3,
};
