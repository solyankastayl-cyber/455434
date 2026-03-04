/**
 * PHASE 3.3 — ML Inference Service
 * =================================
 * Apply trained models for confidence calibration
 */

import { MlCalibrationResult } from '../contracts/ml.types.js';
import { mlTrainService } from './ml.train.service.js';
import { LogisticRegression } from '../models/logreg.model.js';
import { TinyDecisionTree } from '../models/tree.model.js';
import { mlDatasetBuilder } from './ml.dataset.builder.js';

class MlInferenceService {
  private logregModel: LogisticRegression | null = null;
  private treeModel: TinyDecisionTree | null = null;
  private scaler: { mean: number[]; std: number[] } | null = null;
  private featureNames: string[] = [];
  private lastLoadTime = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  private async ensureModelsLoaded(): Promise<boolean> {
    const now = Date.now();
    
    if (this.logregModel && now - this.lastLoadTime < this.CACHE_TTL) {
      return true;
    }
    
    // Load LogReg
    const logreg = await mlTrainService.getActiveModel('LOGREG');
    if (logreg?.weights && logreg.bias != null) {
      this.logregModel = new LogisticRegression({
        weights: logreg.weights,
        bias: logreg.bias,
      });
      this.scaler = logreg.scaler || null;
      this.featureNames = logreg.featureNames || [];
    }
    
    // Load Tree
    const tree = await mlTrainService.getActiveModel('TREE');
    if (tree?.tree) {
      this.treeModel = new TinyDecisionTree();
      this.treeModel.load(tree.tree);
      if (!this.scaler && tree.scaler) {
        this.scaler = tree.scaler;
      }
      if (!this.featureNames.length && tree.featureNames) {
        this.featureNames = tree.featureNames;
      }
    }
    
    this.lastLoadTime = now;
    
    return !!(this.logregModel || this.treeModel);
  }
  
  async calibrateConfidence(
    features: Record<string, number>,
    rawConfidence: number,
    preferredModel: 'LOGREG' | 'TREE' = 'LOGREG'
  ): Promise<MlCalibrationResult> {
    const hasModel = await this.ensureModelsLoaded();
    
    if (!hasModel) {
      // No model available - return raw confidence
      return {
        rawConfidence,
        calibratedConfidence: rawConfidence,
        errorProbability: 0,
        model: 'LOGREG',
      };
    }
    
    // Build feature vector in correct order
    const featureVec = this.featureNames.map((name) => {
      const v = features[name];
      return v != null && Number.isFinite(v) ? v : 0;
    });
    
    // Apply scaler
    let scaledVec = featureVec;
    if (this.scaler) {
      scaledVec = featureVec.map((v, i) =>
        (v - this.scaler!.mean[i]) / (this.scaler!.std[i] || 1)
      );
    }
    
    // Get probability from model
    let prob: number;
    let modelUsed: 'LOGREG' | 'TREE';
    
    if (preferredModel === 'LOGREG' && this.logregModel) {
      prob = this.logregModel.predictProbaOne(scaledVec);
      modelUsed = 'LOGREG';
    } else if (this.treeModel) {
      prob = this.treeModel.predictProbaOne(scaledVec);
      modelUsed = 'TREE';
    } else if (this.logregModel) {
      prob = this.logregModel.predictProbaOne(scaledVec);
      modelUsed = 'LOGREG';
    } else {
      return {
        rawConfidence,
        calibratedConfidence: rawConfidence,
        errorProbability: 0,
        model: 'LOGREG',
      };
    }
    
    // ML CAN ONLY LOWER CONFIDENCE, NEVER RAISE
    const calibratedConfidence = Math.min(rawConfidence, prob);
    const errorProbability = 1 - prob;
    
    return {
      rawConfidence,
      calibratedConfidence,
      errorProbability,
      model: modelUsed,
    };
  }
  
  // Batch calibration
  async calibrateBatch(
    items: Array<{ features: Record<string, number>; rawConfidence: number }>
  ): Promise<MlCalibrationResult[]> {
    return Promise.all(
      items.map((item) =>
        this.calibrateConfidence(item.features, item.rawConfidence)
      )
    );
  }
  
  // Check if models are loaded
  isReady(): boolean {
    return !!(this.logregModel || this.treeModel);
  }
  
  // Force reload
  async reload(): Promise<void> {
    this.lastLoadTime = 0;
    await this.ensureModelsLoaded();
  }
}

export const mlInferenceService = new MlInferenceService();

console.log('[Phase 3.3] ML Inference Service loaded');
