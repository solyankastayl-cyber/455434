/**
 * ML v2.3 - Feature Metadata Types
 * 
 * Extended model registry fields for v2.3 models.
 */

/**
 * Dropped feature with reason
 */
export interface DroppedFeature {
  name: string;
  reason: string;
}

/**
 * Feature metadata stored in model registry
 */
export interface ModelFeatureMeta {
  keptFeatures: string[];
  droppedFeatures: DroppedFeature[];
  importances?: Record<string, number>;
  pruning?: Record<string, any>;
  weighting?: Record<string, any>;
}

/**
 * v2.3 Training Response from Python
 */
export interface V23TrainResponse {
  ok: boolean;
  modelVersion: string;
  task: string;
  network: string;
  metrics: {
    accuracy: number;
    f1: number;
    precision?: number;
    recall?: number;
    train_samples?: number;
    test_samples?: number;
    features_count?: number;
  };
  keptFeatures: string[];
  droppedFeatures: DroppedFeature[];
  importances?: Record<string, number>;
  artifactsPath: string;
  pruningConfig: Record<string, any>;
  weightingConfig: Record<string, any>;
}
