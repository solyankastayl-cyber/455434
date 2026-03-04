/**
 * Ablation Runner Service - B4.3
 * 
 * Orchestrates ablation comparison between two SHADOW models
 */
import { MlAblationReport, type MlAblationReportDoc } from '../models/ml_ablation_report.model.js';
import { PythonMLV3Client } from '../clients/python_ml_v3.client.js';
import { AblationVerdictService } from './ablation_verdict.service.js';

export interface RunAblationInput {
  task: 'market' | 'actor';
  network: string;
  datasetId: string;
  modelA: {
    modelId: string;
    featurePack: string;
    modelVersion?: string;
  };
  modelB: {
    modelId: string;
    featurePack: string;
    modelVersion?: string;
  };
}

export class AblationRunnerService {
  constructor(
    private py: PythonMLV3Client,
    private verdictService: AblationVerdictService
  ) {}

  private safeRate(numerator: number, denominator: number): number {
    return denominator <= 0 ? 0 : numerator / denominator;
  }

  async run(input: RunAblationInput): Promise<MlAblationReportDoc> {
    console.log(`[Ablation Runner] Starting comparison:`);
    console.log(`  Model A: ${input.modelA.modelId} (${input.modelA.featurePack})`);
    console.log(`  Model B: ${input.modelB.modelId} (${input.modelB.featurePack})`);
    console.log(`  Dataset: ${input.datasetId}`);

    // 1. Evaluate both models on the same dataset
    const [metricsA, metricsB] = await Promise.all([
      this.py.evaluate({
        task: input.task,
        modelId: input.modelA.modelId,
        datasetId: input.datasetId,
      }),
      this.py.evaluate({
        task: input.task,
        modelId: input.modelB.modelId,
        datasetId: input.datasetId,
      }),
    ]);

    console.log(`[Ablation Runner] Model A metrics: F1=${metricsA.f1.toFixed(3)}, Acc=${metricsA.accuracy.toFixed(3)}`);
    console.log(`[Ablation Runner] Model B metrics: F1=${metricsB.f1.toFixed(3)}, Acc=${metricsB.accuracy.toFixed(3)}`);

    // 2. Compute derived rates
    const fpRateA = this.safeRate(
      metricsA.confusion.fp,
      metricsA.confusion.fp + metricsA.confusion.tn
    );
    const fpRateB = this.safeRate(
      metricsB.confusion.fp,
      metricsB.confusion.fp + metricsB.confusion.tn
    );
    const fnRateA = this.safeRate(
      metricsA.confusion.fn,
      metricsA.confusion.fn + metricsA.confusion.tp
    );
    const fnRateB = this.safeRate(
      metricsB.confusion.fn,
      metricsB.confusion.fn + metricsB.confusion.tp
    );

    // 3. Compute deltas
    const deltas = {
      deltaAccuracy: metricsB.accuracy - metricsA.accuracy,
      deltaF1: metricsB.f1 - metricsA.f1,
      deltaPrecision: metricsB.precision - metricsA.precision,
      deltaRecall: metricsB.recall - metricsA.recall,
      fpRateA,
      fpRateB,
      fnRateA,
      fnRateB,
    };

    console.log(`[Ablation Runner] Deltas: F1=${(deltas.deltaF1 * 100).toFixed(2)}%, Acc=${(deltas.deltaAccuracy * 100).toFixed(2)}%`);

    // 4. Determine verdict
    const { verdict, reasons } = this.verdictService.decide({
      deltaF1: deltas.deltaF1,
      deltaAccuracy: deltas.deltaAccuracy,
      fpRateA,
      fpRateB,
      rows: Math.min(metricsA.rows, metricsB.rows),
    });

    console.log(`[Ablation Runner] Verdict: ${verdict}`);
    console.log(`[Ablation Runner] Reasons: ${reasons.join(', ')}`);

    // 5. Persist report
    const doc = await MlAblationReport.create({
      task: input.task,
      network: input.network,
      datasetId: input.datasetId,
      modelA: input.modelA,
      modelB: input.modelB,
      metricsA,
      metricsB,
      deltas,
      verdict,
      reasons,
    });

    console.log(`[Ablation Runner] Report saved: ${doc._id}`);

    return doc;
  }
}

export default AblationRunnerService;
