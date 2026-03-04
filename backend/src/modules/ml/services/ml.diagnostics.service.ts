/**
 * PHASE 3.3 — ML Diagnostics Service
 * ====================================
 * Drift detection and model health monitoring
 */

import { ModelMetrics } from '../contracts/ml.types.js';
import { mlTrainService } from './ml.train.service.js';
import { mlDatasetBuilder } from './ml.dataset.builder.js';
import { timelineService } from '../../observability/services/timeline.service.js';

interface DriftResult {
  driftDetected: boolean;
  driftScore: number;
  currentAccuracy: number;
  baselineAccuracy: number;
  threshold: number;
  windowSize: number;
  recommendation: string;
}

class MlDiagnosticsService {
  private readonly DRIFT_THRESHOLD = 0.15; // 15% accuracy drop
  private readonly WINDOW_SIZE = 100;
  
  async checkDrift(symbol?: string): Promise<DriftResult> {
    // Get baseline from active model
    const model = await mlTrainService.getActiveModel('LOGREG');
    const baselineAccuracy = model?.metrics?.accuracy ?? 0.7;
    
    // Get recent data
    const now = Date.now();
    const windowStart = now - 7 * 24 * 60 * 60 * 1000; // Last 7 days
    
    const recentRows = await mlDatasetBuilder.loadRows({
      symbols: symbol ? [symbol] : undefined,
      from: windowStart,
    });
    
    if (recentRows.length < this.WINDOW_SIZE) {
      return {
        driftDetected: false,
        driftScore: 0,
        currentAccuracy: baselineAccuracy,
        baselineAccuracy,
        threshold: this.DRIFT_THRESHOLD,
        windowSize: recentRows.length,
        recommendation: `Insufficient data for drift detection (${recentRows.length}/${this.WINDOW_SIZE})`,
      };
    }
    
    // Calculate current accuracy from recent confirmed/diverged
    const confirmed = recentRows.filter((r) => r.y === 1).length;
    const currentAccuracy = confirmed / recentRows.length;
    
    const accuracyDrop = (baselineAccuracy - currentAccuracy) / baselineAccuracy;
    const driftDetected = accuracyDrop > this.DRIFT_THRESHOLD;
    
    if (driftDetected) {
      // Emit timeline event
      await timelineService.emit({
        type: 'DIVERGENCE_DETECTED',
        severity: 'WARN',
        symbol,
        message: `ML drift detected: accuracy dropped ${(accuracyDrop * 100).toFixed(1)}%`,
        data: {
          currentAccuracy,
          baselineAccuracy,
          driftScore: accuracyDrop,
        },
      });
    }
    
    const recommendation = driftDetected
      ? 'Consider retraining model with recent data'
      : 'Model performance within acceptable range';
    
    return {
      driftDetected,
      driftScore: accuracyDrop,
      currentAccuracy,
      baselineAccuracy,
      threshold: this.DRIFT_THRESHOLD,
      windowSize: recentRows.length,
      recommendation,
    };
  }
  
  async getModelHealth(): Promise<{
    logreg: ModelMetrics | null;
    tree: ModelMetrics | null;
    datasetSize: number;
    lastTrainedAt: Date | null;
    drift: DriftResult;
  }> {
    const logreg = await mlTrainService.getActiveModel('LOGREG');
    const tree = await mlTrainService.getActiveModel('TREE');
    const datasetSize = await mlDatasetBuilder.count();
    const drift = await this.checkDrift();
    
    return {
      logreg: logreg?.metrics as ModelMetrics | null,
      tree: tree?.metrics as ModelMetrics | null,
      datasetSize,
      lastTrainedAt: logreg?.trainedAt || tree?.trainedAt || null,
      drift,
    };
  }
  
  // Feature-level diagnostics
  async getFeatureStats(): Promise<Array<{
    name: string;
    mean: number;
    std: number;
    importance: number;
  }>> {
    const model = await mlTrainService.getActiveModel('LOGREG');
    if (!model?.featureNames || !model.weights) {
      return [];
    }
    
    return model.featureNames.map((name, i) => ({
      name,
      mean: model.scaler?.mean[i] ?? 0,
      std: model.scaler?.std[i] ?? 1,
      importance: Math.abs(model.weights![i] || 0),
    })).sort((a, b) => b.importance - a.importance);
  }
}

export const mlDiagnosticsService = new MlDiagnosticsService();

console.log('[Phase 3.3] ML Diagnostics Service loaded');
