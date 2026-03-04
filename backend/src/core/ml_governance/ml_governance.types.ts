/**
 * ML Governance Types
 * 
 * Human-in-the-loop approval workflow for ML models:
 * SHADOW → EVAL → PENDING_APPROVAL → APPROVED/REJECTED → PROMOTE → ACTIVE
 */

export type ApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type EvalVerdict = 'NONE' | 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type ModelStage = 'SHADOW' | 'ACTIVE' | 'ARCHIVED';
export type MlTask = 'market' | 'actor';
export type ActorRole = 'SYSTEM' | 'ADMIN' | 'MODERATOR';

/**
 * Actor who performed an action
 */
export interface ApprovalActor {
  id: string;
  role: ActorRole;
  email?: string;
}

/**
 * Approval workflow information
 */
export interface ApprovalInfo {
  requestedAt?: Date;
  requestedBy?: ApprovalActor;
  approvedAt?: Date;
  approvedBy?: ApprovalActor;
  rejectedAt?: Date;
  rejectedBy?: ApprovalActor;
  note?: string;
}

/**
 * Evaluation information from shadow comparison
 */
export interface EvalInfo {
  verdict: EvalVerdict;
  evaluatedAt?: Date;
  comparedToVersion?: string;
  metrics?: {
    accuracy?: number;
    f1?: number;
    precision?: number;
    recall?: number;
    [key: string]: number | undefined;
  };
  delta?: {
    accuracy?: number;
    f1?: number;
    [key: string]: number | undefined;
  };
}

/**
 * Extended model for governance
 */
export interface GovernedModel {
  _id: string;
  modelType: MlTask;
  network: string;
  version: string;
  stage: ModelStage;
  approvalStatus: ApprovalStatus;
  approval?: ApprovalInfo;
  eval?: EvalInfo;
  metrics?: Record<string, number>;
  featureMeta?: {
    keptFeatures?: string[];
    droppedFeatures?: { name: string; reason: string }[];
    importances?: Record<string, number>;
    pruning?: Record<string, any>;
    weighting?: Record<string, any>;
  };
  artifactPath?: string;
  trainedAt?: Date;
  createdAt?: Date;
}

/**
 * Approval request payload
 */
export interface ApprovalRequestPayload {
  modelId: string;
  note?: string;
}

/**
 * Approval action payload
 */
export interface ApprovalActionPayload {
  modelId: string;
  note?: string;
}

/**
 * Pending approval item for UI
 */
export interface PendingApprovalItem {
  modelId: string;
  task: MlTask;
  network: string;
  version: string;
  stage: ModelStage;
  approvalStatus: ApprovalStatus;
  eval: EvalInfo;
  metrics: Record<string, number>;
  featureMeta?: {
    kept: number;
    dropped: number;
    total: number;
    pruningMode?: string;
    weightingMode?: string;
  };
  createdAt: Date;
  canPromote: boolean;
}

/**
 * Active model summary
 */
export interface ActiveModelSummary {
  modelId: string;
  task: MlTask;
  network: string;
  version: string;
  metrics: Record<string, number>;
  promotedAt?: Date;
  activatedAt?: number;
}
