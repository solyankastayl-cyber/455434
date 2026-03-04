/**
 * Dataset Builder V3 with Feature Pack Support - B4.2
 * 
 * Extends existing builder to support explicit feature pack selection
 */
import { FeaturePack, getFeaturesByPack } from '../types/feature_packs.js';
import { 
  buildMarketDatasetV3 as buildOriginal,
  type DatasetBuildResult 
} from './dataset_market_v3.builder.js';
import { DatasetMarketMeta } from '../models/dataset_market_meta.model.js';

export interface DatasetBuildOptions {
  network: string;
  featurePack: FeaturePack;
  forceDex?: boolean;
}

export interface DatasetBuildResultV3 extends DatasetBuildResult {
  featurePack: FeaturePack;
  expectedFeatures: string[];
  actualFeatures: string[];
  featuresMissing: string[];
}

/**
 * Build dataset with explicit feature pack
 */
export async function buildDatasetForPack(
  options: DatasetBuildOptions
): Promise<DatasetBuildResultV3> {
  const { network, featurePack, forceDex } = options;
  
  console.log(`[Dataset V3 Pack] Building ${featurePack} dataset for ${network}`);
  
  // Build dataset using existing builder
  // It auto-detects DEX availability
  const result = await buildOriginal(network);
  
  // Get expected features for this pack
  const expectedFeatures = getFeaturesByPack(featurePack);
  const actualFeatures = result.featureColumns;
  
  // Check if we got what we needed
  const featuresMissing = expectedFeatures.filter(
    f => !actualFeatures.includes(f)
  );
  
  // Validate result matches pack requirements
  const validation = validatePackCompatibility(featurePack, result);
  
  if (!validation.compatible) {
    console.warn(
      `[Dataset V3 Pack] WARNING: Dataset incompatible with ${featurePack}: ${validation.reason}`
    );
    
    // If DEX required but missing, add reason
    if (featurePack === FeaturePack.PACK_A_PLUS_DEX && !result.dexIncluded) {
      console.warn(
        `[Dataset V3 Pack] DEX features required but not available: ${result.dexExcludedReason}`
      );
    }
  }
  
  // Update meta with feature pack info
  await DatasetMarketMeta.updateOne(
    { datasetId: result.datasetId },
    {
      $set: {
        featurePack,
        packCompatibility: validation,
      },
    }
  );
  
  return {
    ...result,
    featurePack,
    expectedFeatures,
    actualFeatures,
    featuresMissing,
  };
}

/**
 * Validate that dataset is compatible with feature pack
 */
function validatePackCompatibility(
  pack: FeaturePack,
  result: DatasetBuildResult
): { compatible: boolean; reason?: string } {
  // PACK_A only needs base features (no DEX required)
  if (pack === FeaturePack.PACK_A) {
    if (result.packAIncluded) {
      return { compatible: true };
    }
    return { compatible: false, reason: 'Pack A features missing' };
  }
  
  // PACK_A_PLUS_DEX requires both base + DEX
  if (pack === FeaturePack.PACK_A_PLUS_DEX) {
    if (!result.packAIncluded) {
      return { compatible: false, reason: 'Pack A features missing' };
    }
    if (!result.dexIncluded) {
      return { 
        compatible: false, 
        reason: `DEX features missing: ${result.dexExcludedReason}` 
      };
    }
    return { compatible: true };
  }
  
  return { compatible: false, reason: 'Unknown pack' };
}

/**
 * Get latest dataset compatible with feature pack
 */
export async function getLatestDatasetForPack(
  network: string,
  pack: FeaturePack
): Promise<any | null> {
  const query: any = {
    network,
    packAIncluded: true,
  };
  
  // If DEX required, must have it
  if (pack === FeaturePack.PACK_A_PLUS_DEX) {
    query.dexIncluded = true;
  }
  
  return DatasetMarketMeta.findOne(query)
    .sort({ builtAt: -1 })
    .lean();
}

/**
 * List datasets by feature pack compatibility
 */
export async function listDatasetsByPack(
  network: string,
  pack: FeaturePack,
  limit = 20
): Promise<any[]> {
  const query: any = {
    network,
    packAIncluded: true,
  };
  
  if (pack === FeaturePack.PACK_A_PLUS_DEX) {
    query.dexIncluded = true;
  }
  
  return DatasetMarketMeta.find(query)
    .sort({ builtAt: -1 })
    .limit(limit)
    .lean();
}

export default {
  buildDatasetForPack,
  getLatestDatasetForPack,
  listDatasetsByPack,
};
