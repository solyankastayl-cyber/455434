/**
 * Training Stability Runner - P1.1
 * 
 * Orchestrates multi-seed training runs for stability analysis
 */
import { TrainingStabilityAnalyzer } from './training_stability_analyzer.service.js';
import { TrainingExecutorService } from './training_executor.service.js';
import { MlTrainingStabilityModel } from '../models/ml_training_stability.model.js';
import { FeaturePack } from '../types/feature_packs.js';
import type { StabilityRunRequest, StabilityMetrics } from '../types/training_stability.types.js';

export class TrainingStabilityRunner {
  /**
   * Run multi-seed stability analysis
   */
  async run(req: StabilityRunRequest) {
    const runs = req.runs ?? 5;
    
    console.log(`[Stability] Starting stability analysis for ${req.featurePack}`);
    console.log(`[Stability] Runs: ${runs}, Dataset: ${req.datasetId}`);

    // Generate seeds
    const seeds = req.seeds?.length
      ? req.seeds
      : Array.from({ length: runs }, () => Math.floor(Math.random() * 1e9));

    const metrics: StabilityMetrics[] = [];
    const startedAt = new Date();

    const trainingExecutor = new TrainingExecutorService();

    // Train with each seed
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      console.log(`[Stability] Training run ${i + 1}/${seeds.length} with seed=${seed}`);

      const t0 = Date.now();

      try {
        const trained = await trainingExecutor.execute({
          task: req.task,
          network: req.network,
          featurePack: req.featurePack as FeaturePack, // P1.1: Cast to enum
          datasetId: req.datasetId,
          seed: seed, // P1.1: Pass seed for reproducibility
        });

        if (!trained.success) {
          console.error(`[Stability] Training failed for seed=${seed}: ${trained.error}`);
          continue;
        }

        // Validate metrics exist
        if (!trained.metrics || trained.metrics.accuracy === undefined || trained.metrics.f1 === undefined) {
          console.error(`[Stability] Missing metrics for seed=${seed}`);
          continue;
        }

        metrics.push({
          seed,
          modelId: trained.modelId!,
          accuracy: trained.metrics.accuracy ?? 0,
          f1: trained.metrics.f1 ?? 0,
          precision: trained.metrics.precision ?? 0,
          recall: trained.metrics.recall ?? 0,
          trainMs: Date.now() - t0,
        });

        console.log(`[Stability] Run ${i + 1} complete: F1=${trained.metrics.f1.toFixed(3)}`);
      } catch (error: any) {
        console.error(`[Stability] Training error for seed=${seed}: ${error.message}`);
      }
    }

    console.log(`[Stability] All runs complete: ${metrics.length}/${seeds.length} successful`);

    // Analyze stability
    const analyzer = new TrainingStabilityAnalyzer();
    const { stats, verdict, reasons, summary } = analyzer.analyze(metrics);

    console.log(`[Stability] ${summary}`);
    console.log(`[Stability] Verdict: ${verdict}`);

    // Save to database
    const doc = await MlTrainingStabilityModel.create({
      task: req.task,
      network: req.network,
      featurePack: req.featurePack,
      datasetId: req.datasetId,
      runsRequested: seeds.length,
      runsCompleted: metrics.length,
      metrics,
      stats,
      verdict,
      reasons,
      createdAt: startedAt,
    });

    return {
      task: req.task,
      network: req.network,
      featurePack: req.featurePack,
      datasetId: req.datasetId,
      runsRequested: seeds.length,
      runsCompleted: metrics.length,
      metrics,
      stats,
      verdict,
      reasons,
      createdAt: startedAt.toISOString(),
      _id: doc._id,
    };
  }

  /**
   * Get latest stability result
   */
  async getLatest(task: string, network: string, featurePack: string) {
    return MlTrainingStabilityModel.findOne({ task, network, featurePack })
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Get stability history
   */
  async getHistory(task: string, network: string, featurePack?: string, limit = 20) {
    const query: any = { task, network };
    if (featurePack) {
      query.featurePack = featurePack;
    }

    return MlTrainingStabilityModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}

export default TrainingStabilityRunner;
