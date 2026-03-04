/**
 * Dataset Market Meta Model - Audit trail for dataset builds
 * Tracks what was included, what was excluded, and why
 */
import mongoose, { Schema } from 'mongoose';

export interface IDexStats {
  pools: number;
  featuresRows24h: number;
  coverage: number;
}

export interface IDatasetMarketMeta {
  datasetId: string;
  network: string;
  task: string;
  version: string;
  
  // Pack A (always included)
  packAIncluded: boolean;
  packAStats?: {
    cexRows: number;
    zonesRows: number;
    corridorsRows: number;
  };
  
  // DEX (conditionally included)
  dexIncluded: boolean;
  dexExcludedReason?: string;
  dexStats?: IDexStats;
  
  // B4.2: Feature pack classification
  featurePack?: string; // 'PACK_A' | 'PACK_A_PLUS_DEX'
  packCompatibility?: {
    compatible: boolean;
    reason?: string;
  };
  
  // Dataset info
  rows: number;
  featureColumns: string[];
  
  builtAt: Date;
  buildDurationMs: number;
}

const DatasetMarketMetaSchema = new Schema<IDatasetMarketMeta>({
  datasetId: { type: String, required: true, unique: true, index: true },
  network: { type: String, required: true, index: true },
  task: { type: String, default: 'market' },
  version: { type: String, default: 'v3.0-b4' },
  
  packAIncluded: { type: Boolean, default: true },
  packAStats: {
    cexRows: Number,
    zonesRows: Number,
    corridorsRows: Number,
  },
  
  dexIncluded: { type: Boolean, default: false },
  dexExcludedReason: { type: String },
  dexStats: {
    pools: Number,
    featuresRows24h: Number,
    coverage: Number,
  },
  
  // B4.2: Feature pack
  featurePack: { type: String, enum: ['PACK_A', 'PACK_A_PLUS_DEX'] },
  packCompatibility: {
    compatible: Boolean,
    reason: String,
  },
  
  rows: { type: Number, required: true },
  featureColumns: [{ type: String }],
  
  builtAt: { type: Date, default: Date.now, index: true },
  buildDurationMs: { type: Number },
}, { timestamps: true, collection: 'dataset_market_meta' });

export const DatasetMarketMeta = mongoose.models.DatasetMarketMeta || 
  mongoose.model('DatasetMarketMeta', DatasetMarketMetaSchema);
