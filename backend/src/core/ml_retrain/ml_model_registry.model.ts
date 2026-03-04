/**
 * ML Model Registry
 * 
 * BATCH 1: Source of truth по моделям.
 * BATCH 4: Extended with activatedAt/deactivatedAt for promotion/rollback tracking.
 * ML v2.3: Extended with featureMeta for feature pruning/weighting.
 * GOVERNANCE: Extended with approvalStatus and eval for human-in-the-loop workflow.
 * 
 * Важно: inference никогда не смотрит на файлы напрямую — только сюда.
 */

import mongoose, { Schema, model, Document } from 'mongoose';

export type ModelStatus = 'ACTIVE' | 'SHADOW' | 'ARCHIVED';

// Governance types
export type ApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type EvalVerdict = 'NONE' | 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface IModelMetrics {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  ece?: number; // Expected Calibration Error
}

// ML v2.3: Feature metadata
export interface IDroppedFeature {
  name: string;
  reason: string;
}

export interface IFeatureMeta {
  keptFeatures?: string[];
  droppedFeatures?: IDroppedFeature[];
  importances?: Record<string, number>;
  pruning?: Record<string, any>;
  weighting?: Record<string, any>;
  // B4.2: Feature pack info
  featurePack?: string; // 'PACK_A' | 'PACK_A_PLUS_DEX'
  dexIncluded?: boolean;
  featureCount?: number;
}

// Governance: Approval workflow
export interface IApprovalActor {
  id: string;
  role: 'SYSTEM' | 'ADMIN' | 'MODERATOR';
  email?: string;
}

export interface IApprovalInfo {
  requestedAt?: Date;
  requestedBy?: IApprovalActor;
  approvedAt?: Date;
  approvedBy?: IApprovalActor;
  rejectedAt?: Date;
  rejectedBy?: IApprovalActor;
  note?: string;
}

export interface IEvalInfo {
  verdict: EvalVerdict;
  evaluatedAt?: Date;
  comparedToVersion?: string;
  metrics?: IModelMetrics;
  delta?: Record<string, number>;
}

export interface IMlModelRegistry extends Document {
  modelType: 'market' | 'actor';
  network: string;
  version: string;
  status: ModelStatus;
  metrics: IModelMetrics;
  artifactPath: string;
  trainedAt: Date;
  promotedFrom?: string;
  rollbackOf?: string;
  // BATCH 4: Promotion/Rollback tracking
  activatedAt?: number;
  deactivatedAt?: number;
  // ML v2.3: Feature metadata
  featureMeta?: IFeatureMeta;
  // Governance: Approval workflow
  approvalStatus?: ApprovalStatus;
  approval?: IApprovalInfo;
  eval?: IEvalInfo;
}

const ApprovalActorSchema = new Schema({
  id: { type: String, required: true },
  role: { type: String, enum: ['SYSTEM', 'ADMIN', 'MODERATOR'], required: true },
  email: { type: String }
}, { _id: false });

const ApprovalInfoSchema = new Schema({
  requestedAt: { type: Date },
  requestedBy: { type: ApprovalActorSchema },
  approvedAt: { type: Date },
  approvedBy: { type: ApprovalActorSchema },
  rejectedAt: { type: Date },
  rejectedBy: { type: ApprovalActorSchema },
  note: { type: String }
}, { _id: false });

const EvalInfoSchema = new Schema({
  verdict: { type: String, enum: ['NONE', 'PASS', 'FAIL', 'INCONCLUSIVE'], default: 'NONE' },
  evaluatedAt: { type: Date },
  comparedToVersion: { type: String },
  metrics: { type: Schema.Types.Mixed },
  delta: { type: Schema.Types.Mixed }
}, { _id: false });

const MlModelRegistrySchema = new Schema<IMlModelRegistry>({
  modelType: { 
    type: String, 
    enum: ['market', 'actor'], 
    required: true 
  },
  network: { type: String, required: true },
  version: { type: String, required: true },
  status: {
    type: String,
    enum: ['ACTIVE', 'SHADOW', 'ARCHIVED'],
    required: true
  },
  metrics: {
    accuracy: Number,
    precision: Number,
    recall: Number,
    f1: Number,
    ece: Number
  },
  artifactPath: { type: String, required: true },
  trainedAt: { type: Date, default: Date.now },
  promotedFrom: { type: String },
  rollbackOf: { type: String },
  // BATCH 4
  activatedAt: { type: Number },
  deactivatedAt: { type: Number },
  // ML v2.3: Feature metadata
  featureMeta: {
    keptFeatures: [String],
    droppedFeatures: [{
      name: String,
      reason: String
    }],
    importances: { type: Schema.Types.Mixed },
    pruning: { type: Schema.Types.Mixed },
    weighting: { type: Schema.Types.Mixed },
    // B4.2: Feature pack info
    // P0.3: Extended with variant packs
    featurePack: { 
      type: String, 
      enum: [
        'PACK_A', 
        'PACK_A_PLUS_DEX',
        'PACK_A_MINUS_CEX',
        'PACK_A_MINUS_CORRIDORS',
        'PACK_A_MINUS_ZONES',
        'PACK_A_MINUS_DEX',
      ] 
    },
    dexIncluded: { type: Boolean },
    featureCount: { type: Number }
  },
  // Governance
  approvalStatus: { 
    type: String, 
    enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'],
    default: 'NONE'
  },
  approval: { type: ApprovalInfoSchema },
  eval: { type: EvalInfoSchema }
});

// Indexes
MlModelRegistrySchema.index({ modelType: 1, network: 1, status: 1 });
MlModelRegistrySchema.index({ modelType: 1, network: 1, version: 1 }, { unique: true });
MlModelRegistrySchema.index({ status: 1, trainedAt: -1 });
MlModelRegistrySchema.index({ deactivatedAt: -1 }); // BATCH 4: for rollback queries
// Governance indexes
MlModelRegistrySchema.index({ approvalStatus: 1, status: 1, 'eval.verdict': 1 });
MlModelRegistrySchema.index({ approvalStatus: 1, trainedAt: -1 });

export const MlModelRegistryModel = 
  (mongoose.models.ml_model_registry as mongoose.Model<IMlModelRegistry>) ||
  model<IMlModelRegistry>('ml_model_registry', MlModelRegistrySchema);
