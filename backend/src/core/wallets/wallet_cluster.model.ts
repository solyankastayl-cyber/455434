/**
 * Wallet Cluster Mongoose Model (B3)
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { WalletCluster } from './wallet_cluster.schema.js';

export interface IWalletCluster extends WalletCluster, Document {}

const ClusterEvidenceSubSchema = new Schema({
  type: { 
    type: String, 
    required: true,
    enum: ['token_overlap', 'timing', 'role_pattern', 'flow_pattern'],
  },
  description: { type: String, required: true },
  score: { type: Number, required: true, min: 0, max: 1 },
  details: { type: Schema.Types.Mixed },
}, { _id: false });

const BehaviorOverlapSubSchema = new Schema({
  tokenOverlap: { type: Number, required: true, min: 0, max: 1 },
  timingCorrelation: { type: Number, required: true, min: 0, max: 1 },
  roleSimilarity: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const WalletClusterMongoSchema = new Schema<IWalletCluster>(
  {
    clusterId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    addresses: [{ 
      type: String, 
      required: true,
      index: true,
    }],
    primaryAddress: { 
      type: String, 
      required: true,
      index: true,
    },
    confidence: { 
      type: Number, 
      required: true,
      min: 0,
      max: 1,
    },
    evidence: [ClusterEvidenceSubSchema],
    behaviorOverlap: BehaviorOverlapSubSchema,
    status: { 
      type: String, 
      required: true,
      enum: ['suggested', 'confirmed', 'rejected'],
      default: 'suggested',
    },
    notes: { type: String },
    chain: { type: String, default: 'Ethereum' },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'wallet_clusters',
  }
);

// Indexes
WalletClusterMongoSchema.index({ addresses: 1 }, { name: 'cluster_addresses' });
WalletClusterMongoSchema.index({ status: 1, confidence: -1 }, { name: 'cluster_status_confidence' });

// Get or create model
let WalletClusterModel: Model<IWalletCluster>;

try {
  WalletClusterModel = mongoose.model<IWalletCluster>('WalletCluster');
} catch {
  WalletClusterModel = mongoose.model<IWalletCluster>(
    'WalletCluster', 
    WalletClusterMongoSchema
  );
}

export { WalletClusterModel };
