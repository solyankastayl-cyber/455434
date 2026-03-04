/**
 * Ablation Matrix Runner Service - P0.2 + P1.1
 * 
 * Orchestrates multi-model ablation experiments
 * P1.1: Optionally includes stability analysis
 * Pure orchestration - uses existing B4.2 training and B4.3 ablation
 */
import { getSuiteDefinition } from './ablation_suite.definitions.js';
import type { 
  AblationMatrixRunInput, 
  AblationMatrixResult,
  AblationVariantResult 
} from '../types/ablation_suite.types.js';
import { TrainingExecutorService } from './training_executor.service.js';
import { AblationRunnerService } from './ablation_runner.service.js';
import { AblationVerdictService } from './ablation_verdict.service.js';
import { PythonMLV3Client } from '../clients/python_ml_v3.client.js';
import { DatasetMarketMeta } from '../models/dataset_market_meta.model.js';
import { SyntheticDatasetBuilderService } from './synthetic_dataset_builder.service.js';
import { TrainingStabilityRunner } from './training_stability_runner.service.js';
import { DecisionGate } from '../utils/decision_gate.js';

export class AblationMatrixRunnerService {
  /**
   * Run ablation matrix experiment
   */
  static async run(input: AblationMatrixRunInput): Promise<AblationMatrixResult> {
    console.log(`[Matrix] Starting ablation matrix: ${input.suite}`);
    console.log(`[Matrix] Network: ${input.network}, Dataset: ${input.datasetId}`);
    if (input.includeStability) {
      console.log(`[Matrix] Stability check enabled (${input.stabilityRuns || 3} runs)`);
    }
    
    // Get suite definition
    const suite = getSuiteDefinition(input.suite);
    
    // Check dataset
    let finalDatasetId = input.datasetId;
    const datasetMeta = await DatasetMarketMeta.findOne({ datasetId: input.datasetId }).lean();
    
    if (!datasetMeta) {
      throw new Error(`Dataset not found: ${input.datasetId}`);
    }
    
    // Check if dataset has enough rows
    if (datasetMeta.rows < suite.minRows) {
      if (input.useSyntheticIfNeeded) {
        console.log(`[Matrix] Dataset too small (${datasetMeta.rows} < ${suite.minRows}), creating synthetic...`);
        
        const syntheticService = new SyntheticDatasetBuilderService();
        const multiplier = Math.ceil(suite.minRows / datasetMeta.rows) + 1;
        
        const syntheticResult = await syntheticService.buildSyntheticDataset({
          sourceDatasetId: input.datasetId,
          multiplier,
          noisePct: 2.5,
          seed: 42,
        });
        
        finalDatasetId = syntheticResult.datasetId;
        console.log(`[Matrix] Synthetic dataset created: ${finalDatasetId} (${syntheticResult.rowsGenerated} rows)`);
      } else {
        throw new Error(
          `Dataset too small for ablation (${datasetMeta.rows} < ${suite.minRows}). ` +
          `Use useSyntheticIfNeeded=true or provide larger dataset.`
        );
      }
    }
    
    // 1. Train base model
    console.log(`[Matrix] Training base model: ${suite.basePack}`);
    
    const trainingExecutor = new TrainingExecutorService();
    
    const baseModel = await trainingExecutor.execute({
      task: input.task,
      network: input.network,
      datasetId: finalDatasetId,
      featurePack: suite.basePack,
    });
    
    if (!baseModel.success) {
      throw new Error(`Base model training failed: ${baseModel.error}`);
    }
    
    console.log(`[Matrix] Base model trained: ${baseModel.modelId}`);
    
    // P1.1: Run stability check on base model if requested
    let baseStability: AblationMatrixResult['baseStability'] | undefined;
    
    if (input.includeStability) {
      console.log(`[Matrix] Running stability check for base model...`);
      
      const stabilityRunner = new TrainingStabilityRunner();
      const stabilityResult = await stabilityRunner.run({
        task: input.task,
        network: input.network,
        featurePack: suite.basePack,
        datasetId: finalDatasetId,
        runs: input.stabilityRuns || 3,
      });
      
      baseStability = {
        verdict: stabilityResult.verdict,
        meanF1: stabilityResult.stats.mean.f1,
        stdF1: stabilityResult.stats.std.f1,
        runs: stabilityResult.runsCompleted,
      };
      
      console.log(`[Matrix] Base stability: ${stabilityResult.verdict} (F1 std=${(stabilityResult.stats.std.f1 * 100).toFixed(2)}%)`);
    }
    
    // 2. Train variants and run ablations
    const results: AblationVariantResult[] = [];
    
    const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8002';
    const py = new PythonMLV3Client(mlServiceUrl, 120000);
    const verdict = new AblationVerdictService();
    const ablationRunner = new AblationRunnerService(py, verdict);
    
    for (const variantPack of suite.variants) {
      console.log(`[Matrix] Training variant: ${variantPack}`);
      
      const variantModel = await trainingExecutor.execute({
        task: input.task,
        network: input.network,
        datasetId: finalDatasetId,
        featurePack: variantPack,
      });
      
      if (!variantModel.success) {
        console.error(`[Matrix] Variant training failed: ${variantModel.error}`);
        results.push({
          variantPack,
          modelId: 'FAILED',
          ablationReportId: 'N/A',
          verdict: 'INCONCLUSIVE',
          deltaF1: 0,
          deltaAccuracy: 0,
          fpRateChange: 0,
          reasons: [`Training failed: ${variantModel.error}`],
        });
        continue;
      }
      
      console.log(`[Matrix] Variant trained: ${variantModel.modelId}`);
      console.log(`[Matrix] Running ablation: ${suite.basePack} vs ${variantPack}`);
      
      // Run ablation
      const ablationReport = await ablationRunner.run({
        task: input.task,
        network: input.network,
        datasetId: finalDatasetId,
        modelA: {
          modelId: baseModel.modelId!,
          featurePack: suite.basePack,
          modelVersion: baseModel.modelVersion,
        },
        modelB: {
          modelId: variantModel.modelId!,
          featurePack: variantPack,
          modelVersion: variantModel.modelVersion,
        },
      });
      
      console.log(`[Matrix] Ablation complete: verdict=${ablationReport.verdict}`);
      
      // P1.1: Calculate final decision using DecisionGate
      const stabilityVerdict = baseStability?.verdict;
      const finalDecision = DecisionGate.decide(
        ablationReport.verdict,
        stabilityVerdict
      );
      
      results.push({
        variantPack,
        modelId: variantModel.modelId!,
        ablationReportId: ablationReport._id.toString(),
        verdict: ablationReport.verdict,
        deltaF1: ablationReport.deltas.deltaF1,
        deltaAccuracy: ablationReport.deltas.deltaAccuracy,
        fpRateChange: ablationReport.deltas.fpRateB - ablationReport.deltas.fpRateA,
        reasons: ablationReport.reasons,
        stabilityVerdict,
        finalDecision,
      });
      
      console.log(`[Matrix] Final decision: ${finalDecision}`);
    }
    
    // 3. Generate summary
    const summary: AblationMatrixResult['summary'] = {
      totalVariants: results.length,
      improves: results.filter(r => r.verdict === 'IMPROVES').length,
      degrades: results.filter(r => r.verdict === 'DEGRADES').length,
      neutral: results.filter(r => r.verdict === 'NEUTRAL').length,
      inconclusive: results.filter(r => r.verdict === 'INCONCLUSIVE').length,
    };
    
    // P1.1: Add stability summary if enabled
    if (input.includeStability) {
      summary.stable = results.filter(r => r.stabilityVerdict === 'STABLE').length;
      summary.accepted = results.filter(r => r.finalDecision === 'ACCEPT').length;
    }
    
    console.log(`[Matrix] Matrix complete: ${summary.improves} improves, ${summary.degrades} degrades, ${summary.neutral} neutral, ${summary.inconclusive} inconclusive`);
    if (input.includeStability) {
      console.log(`[Matrix] Accepted for production: ${summary.accepted}`);
    }
    
    // Get final dataset rows count
    const finalMeta = await DatasetMarketMeta.findOne({ datasetId: finalDatasetId }).lean();
    
    return {
      matrixId: `matrix_${input.suite.toLowerCase()}_${Date.now()}`,
      suite: input.suite,
      baseModelId: baseModel.modelId!,
      basePack: suite.basePack,
      datasetId: finalDatasetId,
      rows: finalMeta?.rows || 0,
      results,
      summary,
      baseStability, // P1.1: Include base model stability info
      createdAt: new Date(),
    };
  }
}

export default AblationMatrixRunnerService;
