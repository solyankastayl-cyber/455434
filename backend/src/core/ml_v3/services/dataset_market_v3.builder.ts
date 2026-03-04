/**
 * Dataset Market V3 Builder
 * 
 * Builds dataset with:
 * - Pack A features (ALWAYS)
 * - DEX features (IF AVAILABLE + VALID)
 * 
 * Safety guards prevent including invalid/empty DEX data
 */
import { FeatureMarketModel, FeatureCorridorModel } from '../../features/feature.models.js';
import { DatasetMarketV3, type IDatasetMarketV3 } from '../models/dataset_market_v3.model.js';
import { DatasetMarketMeta } from '../models/dataset_market_meta.model.js';
import { getDexAggregates, type DexAggregates } from './dex_feature_adapter.service.js';

const VERSION = 'v3.0-b4';

// Map spike level string to number
function spikeLevelToNum(level?: string): number {
  if (level === 'HIGH') return 2;
  if (level === 'MEDIUM') return 1;
  return 0;
}

// Map spike direction string to number
function spikeDirectionToNum(dir?: string | null): number {
  if (dir === 'BUY' || dir === 'ADD') return 1;
  if (dir === 'SELL' || dir === 'REMOVE') return -1;
  return 0;
}

export interface DatasetBuildResult {
  datasetId: string;
  network: string;
  rows: number;
  packAIncluded: boolean;
  dexIncluded: boolean;
  dexExcludedReason?: string;
  durationMs: number;
  featureColumns: string[];
}

/**
 * Build Market Dataset V3 for a network
 */
export async function buildMarketDatasetV3(network: string): Promise<DatasetBuildResult> {
  const startTime = Date.now();
  const datasetId = `market_v3_${network}_${Date.now()}`;
  
  console.log(`[Dataset V3] Building for ${network}, datasetId=${datasetId}`);
  
  // 1. Get Pack A features (ALWAYS)
  const packAData = await getPackAFeatures(network);
  console.log(`[Dataset V3] Pack A: ${packAData.length} rows`);
  
  if (packAData.length === 0) {
    const result: DatasetBuildResult = {
      datasetId,
      network,
      rows: 0,
      packAIncluded: false,
      dexIncluded: false,
      dexExcludedReason: 'NO_PACK_A_DATA',
      durationMs: Date.now() - startTime,
      featureColumns: [],
    };
    
    await saveDatasetMeta(datasetId, network, result, null);
    return result;
  }
  
  // 2. Check DEX availability
  const dexResult = await getDexAggregates(network);
  console.log(`[Dataset V3] DEX available: ${dexResult.available}, reason: ${dexResult.reason || 'OK'}`);
  
  // 3. Build dataset rows
  const rows: Partial<IDatasetMarketV3>[] = [];
  const featureColumns: string[] = [
    // Pack A columns
    'cex_pressure_5m', 'cex_pressure_1h', 'cex_pressure_1d',
    'cex_in_delta', 'cex_out_delta', 'cex_spike_level', 'cex_spike_direction',
    'zone_persistence_7d', 'zone_persistence_30d', 'zone_decay_score', 'zone_quality_score',
    'corridor_persistence_7d', 'corridor_persistence_30d', 'corridor_repeat_rate',
    'corridor_entropy', 'corridor_concentration', 'corridor_net_flow_trend', 'corridor_quality_score',
  ];
  
  // Add DEX columns if available
  if (dexResult.available) {
    featureColumns.push(
      'dex_liquidity_net_1h', 'dex_liquidity_net_24h',
      'dex_lp_spike_level', 'dex_lp_spike_direction',
      'dex_depth_index', 'dex_thin_liquidity_share',
      'dex_price_confidence_avg', 'dex_universe_coverage'
    );
  }
  
  for (const packA of packAData) {
    const row: Partial<IDatasetMarketV3> = {
      network,
      bucketTs: packA.bucketTs,
      timestamp: new Date(packA.bucketTs * 1000),
      datasetId,
      version: VERSION,
      
      // Pack A: CEX
      cex_pressure_5m: packA.cexPressureV3?.pressure_5m ?? 0,
      cex_pressure_1h: packA.cexPressureV3?.pressure_1h ?? 0,
      cex_pressure_1d: packA.cexPressureV3?.pressure_1d ?? 0,
      cex_in_delta: packA.cexPressureV3?.inDelta_1h ?? 0,
      cex_out_delta: packA.cexPressureV3?.outDelta_1h ?? 0,
      cex_spike_level: spikeLevelToNum(packA.cexPressureV3?.spikeLevel),
      cex_spike_direction: spikeDirectionToNum(packA.cexPressureV3?.spikeDirection),
      
      // Pack A: Zones
      zone_persistence_7d: packA.zonesV3?.persistence_7d ?? 0,
      zone_persistence_30d: packA.zonesV3?.persistence_30d ?? 0,
      zone_decay_score: packA.zonesV3?.decayScore ?? 0,
      zone_quality_score: packA.zonesV3?.qualityScore ?? 0,
      
      // Pack A: Corridors (aggregate from corridor collection)
      corridor_persistence_7d: packA.corridorAgg?.persistence_7d ?? 0,
      corridor_persistence_30d: packA.corridorAgg?.persistence_30d ?? 0,
      corridor_repeat_rate: packA.corridorAgg?.repeatRate ?? 0,
      corridor_entropy: packA.corridorAgg?.entropy ?? 0,
      corridor_concentration: packA.corridorAgg?.concentrationIndex ?? 0,
      corridor_net_flow_trend: packA.corridorAgg?.netFlowTrend ?? 0,
      corridor_quality_score: packA.corridorAgg?.qualityScore ?? 0,
    };
    
    // Add DEX features if available
    if (dexResult.available && dexResult.aggregates) {
      row.dex_liquidity_net_1h = dexResult.aggregates.dex_liquidity_net_1h;
      row.dex_liquidity_net_24h = dexResult.aggregates.dex_liquidity_net_24h;
      row.dex_lp_spike_level = dexResult.aggregates.dex_lp_spike_level;
      row.dex_lp_spike_direction = dexResult.aggregates.dex_lp_spike_direction;
      row.dex_depth_index = dexResult.aggregates.dex_depth_index;
      row.dex_thin_liquidity_share = dexResult.aggregates.dex_thin_liquidity_share;
      row.dex_price_confidence_avg = dexResult.aggregates.dex_price_confidence_avg;
      row.dex_universe_coverage = dexResult.aggregates.dex_universe_coverage;
    }
    
    rows.push(row);
  }
  
  // 4. Insert rows
  if (rows.length > 0) {
    await DatasetMarketV3.insertMany(rows, { ordered: false });
  }
  
  const durationMs = Date.now() - startTime;
  
  const result: DatasetBuildResult = {
    datasetId,
    network,
    rows: rows.length,
    packAIncluded: true,
    dexIncluded: dexResult.available,
    dexExcludedReason: dexResult.available ? undefined : dexResult.reason,
    durationMs,
    featureColumns,
  };
  
  // 5. Save meta
  await saveDatasetMeta(datasetId, network, result, dexResult.stats || null);
  
  console.log(
    `[Dataset V3] Complete: ${rows.length} rows, ` +
    `dex=${dexResult.available ? 'YES' : 'NO'}, ${durationMs}ms`
  );
  
  return result;
}

/**
 * Get Pack A features from feature store
 */
async function getPackAFeatures(network: string): Promise<any[]> {
  // Get market features with V3 data
  const marketFeatures = await FeatureMarketModel.find(
    { 
      network,
      'cexPressureV3': { $exists: true },
    },
    { _id: 0 }
  )
    .sort({ bucketTs: -1 })
    .limit(1000)
    .lean();
  
  // Get corridor aggregates per bucket
  const corridorAggs = await FeatureCorridorModel.aggregate([
    { 
      $match: { 
        network,
        'corridorV3': { $exists: true },
      },
    },
    { $sort: { bucketTs: -1 } },
    { $limit: 5000 },
    {
      $group: {
        _id: '$bucketTs',
        persistence_7d: { $avg: '$corridorV3.persistence_7d' },
        persistence_30d: { $avg: '$corridorV3.persistence_30d' },
        repeatRate: { $avg: '$corridorV3.repeatRate' },
        entropy: { $avg: '$corridorV3.entropy' },
        concentrationIndex: { $avg: '$corridorV3.concentrationIndex' },
        netFlowTrend: { $avg: '$corridorV3.netFlowTrend' },
        qualityScore: { $avg: '$corridorV3.qualityScore' },
      },
    },
  ]);
  
  // Create lookup map
  const corridorMap = new Map<number, any>();
  for (const c of corridorAggs) {
    corridorMap.set(c._id, c);
  }
  
  // Merge market features with corridor aggregates
  return marketFeatures.map((mf: any) => ({
    ...mf,
    corridorAgg: corridorMap.get(mf.bucketTs) || {},
  }));
}

/**
 * Save dataset build metadata
 */
async function saveDatasetMeta(
  datasetId: string,
  network: string,
  result: DatasetBuildResult,
  dexStats: any | null
): Promise<void> {
  await DatasetMarketMeta.create({
    datasetId,
    network,
    task: 'market',
    version: VERSION,
    packAIncluded: result.packAIncluded,
    dexIncluded: result.dexIncluded,
    dexExcludedReason: result.dexExcludedReason,
    dexStats,
    rows: result.rows,
    featureColumns: result.featureColumns,
    builtAt: new Date(),
    buildDurationMs: result.durationMs,
  });
}

/**
 * Get latest dataset metadata for a network
 */
export async function getLatestDatasetMeta(network: string): Promise<any | null> {
  return DatasetMarketMeta.findOne({ network })
    .sort({ builtAt: -1 })
    .lean();
}

/**
 * Get dataset rows by ID
 */
export async function getDatasetRows(datasetId: string, limit = 100): Promise<any[]> {
  return DatasetMarketV3.find({ datasetId })
    .sort({ bucketTs: -1 })
    .limit(limit)
    .lean();
}

export default {
  buildMarketDatasetV3,
  getLatestDatasetMeta,
  getDatasetRows,
};
