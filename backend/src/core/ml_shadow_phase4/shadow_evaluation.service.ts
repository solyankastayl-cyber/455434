/**
 * PHASE 4 — Shadow ML Evaluation Service
 * 
 * Main orchestrator for shadow evaluation runs
 * ML observes ONLY, no influence on Engine
 */
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { MLShadowRunModel, IMLShadowRun, WindowType } from './ml_shadow_run.model.js';
import { MLShadowPredictionModel } from './ml_shadow_prediction.model.js';
import { MLShadowEvaluationModel } from './ml_shadow_evaluation.model.js';
import { MLShadowAlertModel } from './ml_shadow_alert.model.js';
import { SampleBuilder, LabeledSample } from './sample_builder.service.js';
import { MetricsCalculator } from './metrics_calculator.service.js';
import { env } from '../../config/env.js';

export class ShadowEvaluationService {
  private mlServiceUrl: string;

  constructor() {
    this.mlServiceUrl = env.ML_SERVICE_URL || 'http://localhost:8003';
  }

  /**
   * Start a new shadow evaluation run
   * CRITICAL: ML never affects Engine decisions
   */
  async startRun(window: WindowType, limit: number = 500, modelRef: string = 'latest'): Promise<IMLShadowRun> {
    const runId = `shadow-${window}-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // Create run record
    const run = await MLShadowRunModel.create({
      runId,
      window,
      sampleCount: 0,
      modelRef,
      status: 'RUNNING',
      startedAt: new Date(),
      notes: [],
    });

    // Execute asynchronously (don't wait)
    this.executeRun(runId, window, limit, modelRef).catch((err) => {
      console.error(`[ShadowEval] Run ${runId} failed:`, err);
      MLShadowRunModel.updateOne({ runId }, { status: 'FAILED', finishedAt: new Date() }).exec();
    });

    return run;
  }

  /**
   * Execute shadow run (async)
   */
  private async executeRun(runId: string, window: WindowType, limit: number, modelRef: string): Promise<void> {
    try {
      // 1. Fetch labeled samples
      const samples = await this.fetchLabeledSamples(window, limit);
      
      if (samples.length < 50) {
        await MLShadowRunModel.updateOne(
          { runId },
          { 
            status: 'FAILED', 
            finishedAt: new Date(),
            notes: [`Insufficient samples: ${samples.length} < 50`]
          }
        );
        return;
      }

      // 2. Get ML predictions
      const predictions = await this.getMLPredictions(runId, samples, modelRef);

      // 3. Evaluate
      const evaluation = await this.evaluatePredictions(runId, window, samples, predictions);

      // 4. Check for alerts
      await this.checkAlerts(runId, evaluation);

      // 5. Update run status
      await MLShadowRunModel.updateOne(
        { runId },
        {
          status: 'DONE',
          finishedAt: new Date(),
          sampleCount: samples.length,
          metrics: {
            accuracy: evaluation.accuracy,
            precision: evaluation.precision,
            recall: evaluation.recall,
            f1: evaluation.f1,
            ece: evaluation.ece,
          },
        }
      );

      console.log(`[ShadowEval] Run ${runId} completed: ${samples.length} samples, accuracy=${evaluation.accuracy.toFixed(3)}`);
    } catch (error) {
      console.error(`[ShadowEval] Run ${runId} error:`, error);
      throw error;
    }
  }

  /**
   * Fetch labeled samples (with ground truth)
   * NOW USES REAL DATA from SampleBuilder
   */
  private async fetchLabeledSamples(window: WindowType, limit: number): Promise<LabeledSample[]> {
    const samples = await SampleBuilder.fetchLabeledSamples(window, limit);
    
    // Filter out skipped samples
    const validSamples = samples.filter(s => !s.skipped);
    
    // Log skip statistics
    const skipStats = SampleBuilder.getSkipStats(samples);
    console.log(`[ShadowEval] Sample stats:`, skipStats);
    
    return validSamples;
  }

  /**
   * Get ML predictions from ML Service
   * NOW USES PHASE 4 CONTRACT with timeout guards
   */
  private async getMLPredictions(runId: string, samples: LabeledSample[], modelRef: string): Promise<any[]> {
    try {
      // Extract features for ML service
      const samplesPayload = samples.map(s => ({
        sampleKey: s.sampleKey,
        features: s.features,
      }));
      
      // Call ML Service with timeout guard (500ms, no retry)
      const response = await axios.post(
        `${this.mlServiceUrl}/api/phase4/predict`,
        {
          model: modelRef,
          window: samples[0]?.window || '7d',
          samples: samplesPayload,
        },
        { 
          timeout: 500, // 500ms timeout
        }
      );

      const predictions = response.data.predictions || [];

      // Store predictions
      const predictionDocs = samples.map((sample) => {
        const pred = predictions.find((p: any) => p.sampleKey === sample.sampleKey);
        
        return {
          subjectId: sample.signalId,
          snapshotId: sample.sampleKey,
          window: sample.window,
          p_up: pred?.p_up || 0.33,
          p_down: pred?.p_down || 0.33,
          p_flat: pred?.p_flat || 0.34,
          calibratedConfidence: Math.max(pred?.p_up || 0, pred?.p_down || 0, pred?.p_flat || 0),
          modelRef,
          runId,
          features: sample.features,
        };
      });

      await MLShadowPredictionModel.insertMany(predictionDocs);

      return predictions;
    } catch (error: any) {
      console.error('[ShadowEval] ML prediction error (fallback to uniform):', error.message);
      
      // FALLBACK: uniform distribution (no retry)
      const fallbackPredictions = samples.map(s => ({
        sampleKey: s.sampleKey,
        p_up: 0.33,
        p_down: 0.33,
        p_flat: 0.34,
        confidence: 0.5,
      }));
      
      // Still store fallback predictions
      const predictionDocs = samples.map((sample) => ({
        subjectId: sample.signalId,
        snapshotId: sample.sampleKey,
        window: sample.window,
        p_up: 0.33,
        p_down: 0.33,
        p_flat: 0.34,
        calibratedConfidence: 0.34,
        modelRef: 'fallback',
        runId,
        features: sample.features,
      }));

      await MLShadowPredictionModel.insertMany(predictionDocs);
      
      return fallbackPredictions;
    }
  }

  /**
   * Evaluate predictions vs ground truth
   * NOW USES REAL METRICS from MetricsCalculator (БЛОК 4.3)
   */
  private async evaluatePredictions(
    runId: string,
    window: string,
    samples: LabeledSample[],
    predictions: any[]
  ): Promise<any> {
    // Calculate all metrics using MetricsCalculator
    const metrics = MetricsCalculator.calculateAllMetrics(samples, predictions);

    // Coverage strata with real metrics
    const coverageStrata = MetricsCalculator.calculateStrataMetrics(samples, predictions);

    // Calculate drift (compare to previous run)
    const driftDelta = await this.calculateDrift(window, metrics.accuracy);

    const evaluation = {
      runId,
      window,
      accuracy: metrics.accuracy,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      ece: metrics.ece,
      eceBins: metrics.eceBins,
      agreementRate: metrics.agreementRate,
      flipRate: metrics.flipRate,
      calibrationCurve: metrics.calibrationCurve,
      confusionMatrix: metrics.confusionMatrix,
      coverageStrata,
      driftDelta,
      failures: [],
      sampleCount: samples.length,
    };

    await MLShadowEvaluationModel.create(evaluation);

    return evaluation;
  }

  /**
   * Calculate drift vs previous run
   */
  private async calculateDrift(window: string, currentAccuracy: number): Promise<number> {
    const previousRun = await MLShadowEvaluationModel
      .findOne({ window })
      .sort({ createdAt: -1 })
      .skip(1)
      .exec();

    if (!previousRun) return 0;

    return currentAccuracy - previousRun.accuracy;
  }

  /**
   * Check for alerts (drift, degradation, anomalies)
   * БЛОК 4.5: Enhanced with AlertManager + auto-resolve
   */
  private async checkAlerts(runId: string, evaluation: any): Promise<void> {
    // Use AlertManager for passive monitoring + gating
    const { AlertManager } = await import('./alert_manager.service.js');
    await AlertManager.checkMetrics(evaluation);

    // Evaluate readiness gates
    const { ReadinessGatesService } = await import('./readiness_gates.service.js');
    await ReadinessGatesService.evaluateAllGates();
  }

  /**
   * Get run status
   */
  async getRunStatus(runId: string): Promise<IMLShadowRun | null> {
    return MLShadowRunModel.findOne({ runId }).exec();
  }

  /**
   * Get summary (for UI)
   */
  async getSummary(window: WindowType): Promise<any> {
    const lastRun = await MLShadowRunModel
      .findOne({ window })
      .sort({ createdAt: -1 })
      .exec();

    if (!lastRun) {
      return {
        lastRun: null,
        metrics: null,
        sampleCount: 0,
        gateStatus: 'FAIL',
        reason: 'No runs yet',
      };
    }

    const evaluation = await MLShadowEvaluationModel.findOne({ runId: lastRun.runId }).exec();

    const gateStatus = this.checkGateStatus(lastRun, evaluation);

    return {
      lastRun: {
        runId: lastRun.runId,
        status: lastRun.status,
        startedAt: lastRun.startedAt,
        finishedAt: lastRun.finishedAt,
      },
      metrics: evaluation ? {
        accuracy: evaluation.accuracy,
        precision: evaluation.precision,
        recall: evaluation.recall,
        f1: evaluation.f1,
        ece: evaluation.ece,
        agreementRate: evaluation.agreementRate,
        flipRate: evaluation.flipRate,
        driftDelta: evaluation.driftDelta,
      } : null,
      sampleCount: lastRun.sampleCount,
      gateStatus,
    };
  }

  /**
   * Check gate status
   */
  private checkGateStatus(run: IMLShadowRun, evaluation: any): 'PASS' | 'FAIL' {
    if (run.status !== 'DONE') return 'FAIL';
    if (run.sampleCount < 100) return 'FAIL';
    if (!evaluation) return 'FAIL';
    if (evaluation.accuracy < 0.6) return 'FAIL';
    if (evaluation.ece > 0.1) return 'FAIL';
    
    return 'PASS';
  }

  /**
   * Get detailed report
   */
  async getReport(runId: string): Promise<any> {
    const run = await MLShadowRunModel.findOne({ runId }).exec();
    const evaluation = await MLShadowEvaluationModel.findOne({ runId }).exec();
    const alerts = await MLShadowAlertModel.find({ runId }).exec();

    return {
      run,
      evaluation,
      alerts,
    };
  }

  /**
   * Get strata metrics
   */
  async getStrata(runId: string): Promise<any> {
    const evaluation = await MLShadowEvaluationModel.findOne({ runId }).exec();
    
    return {
      runId,
      coverageStrata: evaluation?.coverageStrata || [],
    };
  }
}

export const shadowEvaluationService = new ShadowEvaluationService();
