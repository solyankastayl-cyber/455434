/**
 * Neural Layer Types
 * 
 * Types for ML advisory layer (subordinate to Engine V2)
 */

export type MLMode = 'off' | 'advisor' | 'assist';
export type MLStatus = 'OK' | 'DEGRADED' | 'DISABLED' | 'TRAINING' | 'NOT_READY';

/**
 * Confidence Calibration Output
 */
export interface ConfidenceCalibration {
  originalConfidence: number;
  mlModifier: number;        // 0.8 - 1.2
  calibratedConfidence: number;
  notes: string[];
}

/**
 * Outcome Prediction Output
 */
export interface OutcomePrediction {
  probUp: number;
  probFlat: number;
  probDown: number;
  expectedMovePct: number;
  uncertainty: number;       // 0-1 (entropy-based)
  horizon: string;
}

/**
 * Ranking Assist Score
 */
export interface RankingAssist {
  originalRankScore: number;
  mlAdjustment: number;      // -10 to +10
  assistedRankScore: number;
  withinBucketRank: number;
}

/**
 * Full Neural Output
 */
export interface NeuralOutput {
  subject: { kind: string; id: string };
  window: string;
  mlMode: MLMode;
  mlStatus: MLStatus;
  
  calibration?: ConfidenceCalibration;
  prediction?: OutcomePrediction;
  ranking?: RankingAssist;
  
  meta: {
    modelVersion: string;
    datasetSize: number;
    lastTrainedAt?: string;
  };
}

/**
 * Model Quality Metrics
 */
export interface ModelQuality {
  accuracy: number;
  macroF1: number;
  brierScore: number;
  calibrationError: number;
  sampleCount: number;
  lastEvaluatedAt: string;
}

/**
 * Training Status
 */
export interface TrainingStatus {
  isTraining: boolean;
  lastTrainedAt?: string;
  nextTrainAt?: string;
  datasetSize: number;
  minRequiredSamples: number;
  isReadyForTraining: boolean;
  quality?: ModelQuality;
}

/**
 * ML Health Status
 */
export interface MLHealthStatus {
  mode: MLMode;
  status: MLStatus;
  training: TrainingStatus;
  safetyGates: {
    coverageOk: boolean;
    datasetOk: boolean;
    modelQualityOk: boolean;
    driftOk: boolean;
    shadowOk: boolean;
  };
  blocked: boolean;
  blockReasons: string[];
}
