/**
 * PHASE 3.2 — ML Training Service
 * ================================
 * Train baseline models for confidence calibration
 */

import { TrainConfig, ModelMetrics, TrainedModel } from '../contracts/ml.types.js';
import { mlDatasetBuilder } from './ml.dataset.builder.js';
import { LogisticRegression } from '../models/logreg.model.js';
import { TinyDecisionTree } from '../models/tree.model.js';
import { MlModelModel } from '../storage/ml.storage.js';

// Compute metrics
function computeMetrics(yTrue: number[], yPred: number[], yProba: number[]): ModelMetrics {
  const n = yTrue.length;
  if (n === 0) {
    return {
      accuracy: 0, precision: 0, recall: 0, f1: 0,
      brierScore: 1, calibrationError: 1, sampleSize: 0,
    };
  }
  
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let brierSum = 0;
  
  for (let i = 0; i < n; i++) {
    const actual = yTrue[i];
    const pred = yPred[i];
    const prob = yProba[i];
    
    if (actual === 1 && pred === 1) tp++;
    else if (actual === 0 && pred === 1) fp++;
    else if (actual === 1 && pred === 0) fn++;
    else tn++;
    
    brierSum += (prob - actual) ** 2;
  }
  
  const accuracy = (tp + tn) / n;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const brierScore = brierSum / n;
  
  // Expected Calibration Error (simplified)
  const bins = 10;
  const binCounts = new Array(bins).fill(0);
  const binCorrect = new Array(bins).fill(0);
  const binProbaSum = new Array(bins).fill(0);
  
  for (let i = 0; i < n; i++) {
    const binIdx = Math.min(Math.floor(yProba[i] * bins), bins - 1);
    binCounts[binIdx]++;
    binCorrect[binIdx] += yTrue[i];
    binProbaSum[binIdx] += yProba[i];
  }
  
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    if (binCounts[b] > 0) {
      const avgProba = binProbaSum[b] / binCounts[b];
      const actualRate = binCorrect[b] / binCounts[b];
      ece += (binCounts[b] / n) * Math.abs(avgProba - actualRate);
    }
  }
  
  return {
    accuracy,
    precision,
    recall,
    f1,
    brierScore,
    calibrationError: ece,
    sampleSize: n,
  };
}

class MlTrainService {
  
  async trainBaseline(cfg: TrainConfig = {}): Promise<{
    logreg: TrainedModel;
    tree: TrainedModel;
    summary: { trainSize: number; valSize: number; testSize: number };
  }> {
    // Load and split data
    const allRows = await mlDatasetBuilder.loadRows(cfg);
    
    if (allRows.length < (cfg.minRows || 100)) {
      throw new Error(`Not enough data: ${allRows.length} rows (min: ${cfg.minRows || 100})`);
    }
    
    const split = mlDatasetBuilder.splitTimeBased(allRows, cfg.split);
    
    console.log(`[MlTrain] Split: train=${split.train.length}, val=${split.val.length}, test=${split.test.length}`);
    
    // Build feature matrices
    const trainMatrix = mlDatasetBuilder.buildFeatureMatrix(split.train);
    const valMatrix = mlDatasetBuilder.buildFeatureMatrix(split.val);
    const testMatrix = mlDatasetBuilder.buildFeatureMatrix(split.test);
    
    // Standardize
    const scaler = mlDatasetBuilder.fitStandardScaler(trainMatrix.X);
    const trainX = mlDatasetBuilder.applyStandardScaler(trainMatrix.X, scaler);
    const valX = mlDatasetBuilder.applyStandardScaler(valMatrix.X, scaler);
    const testX = mlDatasetBuilder.applyStandardScaler(testMatrix.X, scaler);
    
    // Train LogReg
    const logreg = new LogisticRegression();
    logreg.fit(trainX, trainMatrix.y, { lr: 0.05, epochs: 300, l2: 1e-4 });
    
    const logregPredTest = logreg.predict(testX);
    const logregProbaTest = logreg.predictProba(testX);
    const logregMetrics = computeMetrics(testMatrix.y, logregPredTest, logregProbaTest);
    
    console.log(`[MlTrain] LogReg metrics: acc=${logregMetrics.accuracy.toFixed(3)}, ece=${logregMetrics.calibrationError.toFixed(3)}`);
    
    // Train Tree
    const tree = new TinyDecisionTree();
    tree.fit(trainX, trainMatrix.y, { maxDepth: 4, minLeaf: 20 });
    
    const treePredTest = tree.predict(testX);
    const treeProbaTest = tree.predictProba(testX);
    const treeMetrics = computeMetrics(testMatrix.y, treePredTest, treeProbaTest);
    
    console.log(`[MlTrain] Tree metrics: acc=${treeMetrics.accuracy.toFixed(3)}, ece=${treeMetrics.calibrationError.toFixed(3)}`);
    
    // Save models
    const version = `v${Date.now()}`;
    
    const logregModel: TrainedModel = {
      modelType: 'LOGREG',
      version,
      trainedAt: new Date(),
      metrics: logregMetrics,
      featureNames: trainMatrix.featureNames,
      weights: logreg.getWeights(),
      bias: logreg.getBias(),
      scaler,
    };
    
    const treeModel: TrainedModel = {
      modelType: 'TREE',
      version,
      trainedAt: new Date(),
      metrics: treeMetrics,
      featureNames: trainMatrix.featureNames,
      tree: tree.serialize(),
      scaler,
    };
    
    // Deactivate old models
    await MlModelModel.updateMany({ isActive: true }, { $set: { isActive: false } });
    
    // Save new models
    await MlModelModel.create({ ...logregModel, isActive: true });
    await MlModelModel.create({ ...treeModel, isActive: true });
    
    return {
      logreg: logregModel,
      tree: treeModel,
      summary: {
        trainSize: split.train.length,
        valSize: split.val.length,
        testSize: split.test.length,
      },
    };
  }
  
  async getActiveModel(modelType: 'LOGREG' | 'TREE'): Promise<TrainedModel | null> {
    const doc = await MlModelModel.findOne({ modelType, isActive: true }).lean();
    return doc as TrainedModel | null;
  }
  
  async listModels(): Promise<TrainedModel[]> {
    const docs = await MlModelModel.find().sort({ trainedAt: -1 }).limit(20).lean();
    return docs as TrainedModel[];
  }
}

export const mlTrainService = new MlTrainService();

console.log('[Phase 3.2] ML Train Service loaded');
