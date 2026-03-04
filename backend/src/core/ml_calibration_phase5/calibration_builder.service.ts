/**
 * Phase 5: Calibration Builder Service
 * Builds calibration maps from labeled samples
 */
import { v4 as uuidv4 } from 'uuid';
import { CalibrationRunModel, ICalibrationRun } from './calibration_run.model.js';
import { CalibrationMapModel, ICalibrationMap, ICalibrationBin } from './calibration_map.model.js';
import { MLShadowEvaluationModel } from '../ml_shadow_phase4/ml_shadow_evaluation.model.js';

export interface BuildCalibrationMapInput {
  window: '24h' | '7d';
  scope?: 'GLOBAL' | 'BY_STRATUM' | 'BY_SEVERITY' | 'BY_STRATUM_SEVERITY';
  limit?: number;
  realOnly?: boolean;
  config?: {
    bins?: number;
    maxAdjPct?: number;
    minBinCount?: number;
    smoothing?: 'isotonic-lite' | 'beta' | 'histogram';
  };
}

export interface LabeledSample {
  sampleKey: string;
  confidence: number;
  predictedClass: 'UP' | 'DOWN' | 'FLAT';
  actualClass: 'UP' | 'DOWN' | 'FLAT';
  correct: boolean;
}

export class CalibrationBuilderService {
  /**
   * Build calibration map from recent shadow evaluations
   */
  async buildCalibrationMap(input: BuildCalibrationMapInput): Promise<{
    runId: string;
    mapId: string;
    status: string;
    metrics: any;
  }> {
    const {
      window,
      scope = 'GLOBAL',
      limit = 500,
      realOnly = true,
      config = {},
    } = input;

    // Config defaults
    const bins = config.bins || 10;
    const maxAdjPct = config.maxAdjPct || 10;
    const minBinCount = config.minBinCount || 20;
    const smoothing = config.smoothing || 'histogram';

    console.log(`[CalBuilder] Building calibration map for ${window}, scope=${scope}`);

    // 1. Fetch labeled samples from shadow evaluations
    const samples = await this.fetchLabeledSamples(window, limit, realOnly);
    
    if (samples.length < 50) {
      throw new Error(`Insufficient samples: ${samples.length} (need at least 50)`);
    }

    console.log(`[CalBuilder] Collected ${samples.length} labeled samples`);

    // 2. Calculate input metrics (ECE before calibration)
    const inputMetrics = this.calculateInputMetrics(samples);

    // 3. Build bins
    const binResults = this.buildBins(samples, bins, maxAdjPct);

    // 4. Apply smoothing
    const smoothedBins = this.applySmoothing(binResults, smoothing);

    // 5. Calculate output metrics (estimated ECE after)
    const outputMetrics = this.calculateOutputMetrics(samples, smoothedBins, maxAdjPct);

    // 6. Create run and map records
    const runId = `calrun-${window}-${uuidv4().split('-')[0]}`;
    const mapId = `calmap-${window}-${uuidv4().split('-')[0]}`;

    const sampleRange = {
      from: new Date(Math.min(...samples.map(s => new Date(s.sampleKey).getTime()))),
      to: new Date(Math.max(...samples.map(s => new Date(s.sampleKey).getTime()))),
      count: samples.length,
      realLabelPct: (samples.filter(s => s.correct !== undefined).length / samples.length) * 100,
    };

    const run: Partial<ICalibrationRun> = {
      runId,
      window,
      sampleRange,
      strataSummary: { low: 0, medium: 0, high: 0 }, // TODO: stratify if scope requires
      inputMetrics,
      outputMetrics,
      status: 'DRAFT',
      rejectionReasons: [],
      config: { bins, maxAdjPct, minBinCount, smoothing },
      artifactsRef: { mapId, sampleKeys: samples.map(s => s.sampleKey) },
    };

    const map: Partial<ICalibrationMap> = {
      mapId,
      runId,
      window,
      scope,
      bins: smoothedBins,
      smoothingMeta: { method: smoothing, params: {} },
      guardrails: { maxAdjPct, minBinCount },
    };

    // Save to DB
    await CalibrationRunModel.create(run);
    await CalibrationMapModel.create(map);

    console.log(`[CalBuilder] Created run=${runId}, map=${mapId}`);
    console.log(`[CalBuilder] ECE before=${inputMetrics.eceBefore.toFixed(3)}, after=${outputMetrics.eceAfter.toFixed(3)}`);

    return {
      runId,
      mapId,
      status: 'DRAFT',
      metrics: {
        eceBefore: inputMetrics.eceBefore,
        eceAfterEst: outputMetrics.eceAfter,
        deltaECE: outputMetrics.deltaECE,
        clampRate: outputMetrics.clampRate,
      },
    };
  }

  /**
   * Fetch labeled samples from recent shadow evaluations
   */
  private async fetchLabeledSamples(
    window: string,
    limit: number,
    realOnly: boolean
  ): Promise<LabeledSample[]> {
    // Get recent evaluations with real labels
    const query: any = { window };
    if (realOnly) {
      query['metrics.realLabelPct'] = { $gte: 50 };
    }

    const evals = await MLShadowEvaluationModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(20);

    const samples: LabeledSample[] = [];

    for (const evaluation of evals) {
      // Extract samples from evaluation (simplified)
      // In real implementation, would fetch from ml_shadow_predictions
      const sampleCount = Math.min(limit - samples.length, 50);
      
      // Mock sample generation (replace with actual prediction fetching)
      for (let i = 0; i < sampleCount; i++) {
        const confidence = 0.4 + Math.random() * 0.5; // 0.4-0.9
        const predictedClass = confidence > 0.7 ? 'UP' : confidence < 0.5 ? 'DOWN' : 'FLAT';
        const actualClass = Math.random() > 0.3 ? predictedClass : (predictedClass === 'UP' ? 'DOWN' : 'UP');
        
        samples.push({
          sampleKey: `${evaluation.runId}-${i}`,
          confidence,
          predictedClass: predictedClass as any,
          actualClass: actualClass as any,
          correct: predictedClass === actualClass,
        });
      }

      if (samples.length >= limit) break;
    }

    return samples;
  }

  /**
   * Calculate input metrics before calibration
   */
  private calculateInputMetrics(samples: LabeledSample[]): {
    eceBefore: number;
    agreementRate: number;
    flipRate: number;
    accuracy: number;
  } {
    const bins = 10;
    const binSize = 1.0 / bins;
    const binData: Array<{ conf: number[]; acc: number[] }> = Array(bins)
      .fill(null)
      .map(() => ({ conf: [], acc: [] }));

    // Bin samples by confidence
    for (const sample of samples) {
      const binIdx = Math.min(Math.floor(sample.confidence / binSize), bins - 1);
      binData[binIdx].conf.push(sample.confidence);
      binData[binIdx].acc.push(sample.correct ? 1 : 0);
    }

    // Calculate ECE (Expected Calibration Error)
    let ece = 0;
    for (const bin of binData) {
      if (bin.conf.length === 0) continue;
      const meanConf = bin.conf.reduce((a, b) => a + b, 0) / bin.conf.length;
      const meanAcc = bin.acc.reduce((a, b) => a + b, 0) / bin.acc.length;
      const weight = bin.conf.length / samples.length;
      ece += weight * Math.abs(meanConf - meanAcc);
    }

    const accuracy = samples.filter(s => s.correct).length / samples.length;

    return {
      eceBefore: ece,
      agreementRate: accuracy, // Simplified
      flipRate: 0.02, // Placeholder
      accuracy,
    };
  }

  /**
   * Build bins with adjustment percentages
   */
  private buildBins(
    samples: LabeledSample[],
    numBins: number,
    maxAdjPct: number
  ): ICalibrationBin[] {
    const binSize = 1.0 / numBins;
    const binData: Array<{ conf: number[]; acc: number[] }> = Array(numBins)
      .fill(null)
      .map(() => ({ conf: [], acc: [] }));

    // Bin samples
    for (const sample of samples) {
      const binIdx = Math.min(Math.floor(sample.confidence / binSize), numBins - 1);
      binData[binIdx].conf.push(sample.confidence);
      binData[binIdx].acc.push(sample.correct ? 1 : 0);
    }

    // Calculate adjustments
    const bins: ICalibrationBin[] = [];
    for (let i = 0; i < numBins; i++) {
      const bin = binData[i];
      const binLabel = `${(i * binSize).toFixed(1)}-${((i + 1) * binSize).toFixed(1)}`;

      if (bin.conf.length === 0) {
        bins.push({
          bin: binLabel,
          n: 0,
          meanConf: i * binSize + binSize / 2,
          meanAcc: i * binSize + binSize / 2,
          adjPct: 0,
          adjClamped: false,
        });
        continue;
      }

      const meanConf = bin.conf.reduce((a, b) => a + b, 0) / bin.conf.length;
      const meanAcc = bin.acc.reduce((a, b) => a + b, 0) / bin.acc.length;
      const gap = meanAcc - meanConf;
      
      // Clamp adjustment to ±maxAdjPct
      let adjPct = gap * 100;
      const adjClamped = Math.abs(adjPct) > maxAdjPct;
      if (adjClamped) {
        adjPct = Math.sign(adjPct) * maxAdjPct;
      }

      bins.push({
        bin: binLabel,
        n: bin.conf.length,
        meanConf,
        meanAcc,
        adjPct,
        adjClamped,
      });
    }

    return bins;
  }

  /**
   * Apply smoothing to bins (histogram smoothing)
   */
  private applySmoothing(
    bins: ICalibrationBin[],
    method: 'isotonic-lite' | 'beta' | 'histogram'
  ): ICalibrationBin[] {
    if (method === 'histogram') {
      // Simple histogram smoothing: moving average
      const smoothed = [...bins];
      for (let i = 1; i < bins.length - 1; i++) {
        if (bins[i].n > 0) {
          const prevAdj = bins[i - 1].adjPct;
          const currAdj = bins[i].adjPct;
          const nextAdj = bins[i + 1].adjPct;
          smoothed[i].adjPct = (prevAdj + currAdj * 2 + nextAdj) / 4;
        }
      }
      return smoothed;
    }

    // For other methods, return as-is (can implement later)
    return bins;
  }

  /**
   * Calculate output metrics after calibration
   */
  private calculateOutputMetrics(
    samples: LabeledSample[],
    bins: ICalibrationBin[],
    maxAdjPct: number
  ): {
    eceAfter: number;
    deltaECE: number;
    clampRate: number;
    maxAdjSeen: number;
  } {
    // Simulate applying calibration
    let totalClamp = 0;
    let maxAdj = 0;

    const calibratedSamples = samples.map(sample => {
      const binIdx = Math.min(Math.floor(sample.confidence * bins.length), bins.length - 1);
      const bin = bins[binIdx];
      
      const adjFactor = 1 + bin.adjPct / 100;
      let calibratedConf = sample.confidence * adjFactor;
      
      // Clamp to [0, 1]
      if (calibratedConf < 0 || calibratedConf > 1) {
        totalClamp++;
        calibratedConf = Math.max(0, Math.min(1, calibratedConf));
      }

      maxAdj = Math.max(maxAdj, Math.abs(bin.adjPct));

      return { ...sample, confidence: calibratedConf };
    });

    // Recalculate ECE with calibrated confidences
    const eceAfter = this.calculateECE(calibratedSamples);
    const eceBefore = this.calculateECE(samples);

    return {
      eceAfter,
      deltaECE: eceAfter - eceBefore,
      clampRate: (totalClamp / samples.length) * 100,
      maxAdjSeen: maxAdj,
    };
  }

  /**
   * Calculate ECE for a set of samples
   */
  private calculateECE(samples: LabeledSample[]): number {
    const bins = 10;
    const binSize = 1.0 / bins;
    const binData: Array<{ conf: number[]; acc: number[] }> = Array(bins)
      .fill(null)
      .map(() => ({ conf: [], acc: [] }));

    for (const sample of samples) {
      const binIdx = Math.min(Math.floor(sample.confidence / binSize), bins - 1);
      binData[binIdx].conf.push(sample.confidence);
      binData[binIdx].acc.push(sample.correct ? 1 : 0);
    }

    let ece = 0;
    for (const bin of binData) {
      if (bin.conf.length === 0) continue;
      const meanConf = bin.conf.reduce((a, b) => a + b, 0) / bin.conf.length;
      const meanAcc = bin.acc.reduce((a, b) => a + b, 0) / bin.acc.length;
      const weight = bin.conf.length / samples.length;
      ece += weight * Math.abs(meanConf - meanAcc);
    }

    return ece;
  }
}

export const calibrationBuilderService = new CalibrationBuilderService();
