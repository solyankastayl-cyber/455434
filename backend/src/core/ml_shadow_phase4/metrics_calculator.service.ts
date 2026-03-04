/**
 * PHASE 4 - БЛОК 4.3: Real Metrics Calculator
 * 
 * Calculates:
 * - ECE (Expected Calibration Error)
 * - Agreement Rate / Flip Rate
 * - Confidence Calibration Curve
 * - Per-strata metrics
 * 
 * NO INFLUENCE on Engine decisions
 */
import { LabeledSample } from './sample_builder.service.js';

export interface ECEBin {
  bin: string;
  count: number;
  accuracy: number;
  confidence: number;
}

export interface CalibrationPoint {
  confidence: number;
  accuracy: number;
  count: number;
}

export interface MetricsResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  ece: number;
  eceBins: ECEBin[];
  agreementRate: number;
  flipRate: number;
  calibrationCurve: CalibrationPoint[];
  confusionMatrix: {
    tp: number;
    tn: number;
    fp: number;
    fn: number;
  };
}

export class MetricsCalculator {
  /**
   * Get predicted label from probabilities
   */
  static getPredictedLabel(prediction: any): 'UP' | 'DOWN' | 'FLAT' {
    if (!prediction) return 'FLAT';
    
    const { p_up = 0, p_down = 0, p_flat = 0 } = prediction;
    
    const max = Math.max(p_up, p_down, p_flat);
    
    if (max === p_up) return 'UP';
    if (max === p_down) return 'DOWN';
    return 'FLAT';
  }

  /**
   * Get confidence (max probability)
   */
  static getConfidence(prediction: any): number {
    if (!prediction) return 0.33;
    
    const { p_up = 0, p_down = 0, p_flat = 0 } = prediction;
    return Math.max(p_up, p_down, p_flat);
  }

  /**
   * Calculate Expected Calibration Error (ECE)
   * 
   * Formula: ECE = Σ_k (|acc_k − conf_k| × n_k / N)
   * 
   * Uses 10 bins: [0-0.1, 0.1-0.2, ..., 0.9-1.0]
   */
  static calculateECE(samples: LabeledSample[], predictions: any[]): {
    ece: number;
    eceBins: ECEBin[];
  } {
    const numBins = 10;
    const bins: {
      range: [number, number];
      predictions: number[];
      correctness: number[];
    }[] = [];

    // Initialize bins
    for (let i = 0; i < numBins; i++) {
      bins.push({
        range: [i / numBins, (i + 1) / numBins],
        predictions: [],
        correctness: [],
      });
    }

    // Assign predictions to bins
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const prediction = predictions[i];
      
      if (!sample.labels.d7) continue;

      const confidence = this.getConfidence(prediction);
      const predicted = this.getPredictedLabel(prediction);
      const truth = sample.labels.d7;
      const correct = predicted === truth ? 1 : 0;

      // Find bin
      const binIndex = Math.min(Math.floor(confidence * numBins), numBins - 1);
      bins[binIndex].predictions.push(confidence);
      bins[binIndex].correctness.push(correct);
    }

    // Calculate ECE
    let ece = 0;
    const totalSamples = samples.length;
    const eceBins: ECEBin[] = [];

    for (let i = 0; i < numBins; i++) {
      const bin = bins[i];
      const count = bin.predictions.length;

      if (count === 0) {
        eceBins.push({
          bin: `${(i / numBins).toFixed(1)}-${((i + 1) / numBins).toFixed(1)}`,
          count: 0,
          accuracy: 0,
          confidence: 0,
        });
        continue;
      }

      const avgConfidence = bin.predictions.reduce((a, b) => a + b, 0) / count;
      const accuracy = bin.correctness.reduce((a, b) => a + b, 0) / count;

      ece += Math.abs(accuracy - avgConfidence) * (count / totalSamples);

      eceBins.push({
        bin: `${(i / numBins).toFixed(1)}-${((i + 1) / numBins).toFixed(1)}`,
        count,
        accuracy,
        confidence: avgConfidence,
      });
    }

    return { ece, eceBins };
  }

  /**
   * Calculate Agreement Rate and Flip Rate
   * 
   * Agreement: Same direction (UP/DOWN/FLAT)
   * Flip: Opposite direction (UP vs DOWN)
   */
  static calculateAgreementMetrics(samples: LabeledSample[], predictions: any[]): {
    agreementRate: number;
    flipRate: number;
  } {
    let agreements = 0;
    let flips = 0;
    let total = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const prediction = predictions[i];

      // Use Engine decision as "truth" for agreement
      // For now, we use labels.d7 as proxy for Engine decision
      const engineDirection = sample.labels.d7;
      
      if (!engineDirection) continue;

      const mlDirection = this.getPredictedLabel(prediction);

      total++;

      // Agreement: same direction
      if (engineDirection === mlDirection) {
        agreements++;
      }

      // Flip: opposite direction (UP vs DOWN)
      if (
        (engineDirection === 'UP' && mlDirection === 'DOWN') ||
        (engineDirection === 'DOWN' && mlDirection === 'UP')
      ) {
        flips++;
      }
    }

    const agreementRate = total > 0 ? agreements / total : 0;
    const flipRate = total > 0 ? flips / total : 0;

    return { agreementRate, flipRate };
  }

  /**
   * Calculate Confidence Calibration Curve
   * 
   * Groups predictions by confidence bins and calculates actual accuracy
   * Used for visualization and analysis (NOT auto-correction)
   */
  static calculateCalibrationCurve(samples: LabeledSample[], predictions: any[]): CalibrationPoint[] {
    const numBins = 10;
    const bins: {
      predictions: number[];
      correctness: number[];
    }[] = Array.from({ length: numBins }, () => ({
      predictions: [],
      correctness: [],
    }));

    // Assign to bins
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const prediction = predictions[i];

      if (!sample.labels.d7) continue;

      const confidence = this.getConfidence(prediction);
      const predicted = this.getPredictedLabel(prediction);
      const truth = sample.labels.d7;
      const correct = predicted === truth ? 1 : 0;

      const binIndex = Math.min(Math.floor(confidence * numBins), numBins - 1);
      bins[binIndex].predictions.push(confidence);
      bins[binIndex].correctness.push(correct);
    }

    // Calculate curve points
    const curve: CalibrationPoint[] = [];

    for (const bin of bins) {
      if (bin.predictions.length === 0) continue;

      const avgConfidence = bin.predictions.reduce((a, b) => a + b, 0) / bin.predictions.length;
      const accuracy = bin.correctness.reduce((a, b) => a + b, 0) / bin.correctness.length;

      curve.push({
        confidence: avgConfidence,
        accuracy,
        count: bin.predictions.length,
      });
    }

    return curve;
  }

  /**
   * Calculate all metrics
   */
  static calculateAllMetrics(samples: LabeledSample[], predictions: any[]): MetricsResult {
    // Basic metrics
    let tp = 0, tn = 0, fp = 0, fn = 0;
    let correctPredictions = 0;

    for (let i = 0; i < samples.length; i++) {
      const truth = samples[i].labels.d7;
      const pred = this.getPredictedLabel(predictions[i]);

      if (!truth) continue;

      if (pred === truth) correctPredictions++;

      // Binary: UP vs not-UP
      if (truth === 'UP' && pred === 'UP') tp++;
      else if (truth !== 'UP' && pred !== 'UP') tn++;
      else if (truth !== 'UP' && pred === 'UP') fp++;
      else if (truth === 'UP' && pred !== 'UP') fn++;
    }

    const accuracy = samples.length > 0 ? correctPredictions / samples.length : 0;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    // ECE
    const { ece, eceBins } = this.calculateECE(samples, predictions);

    // Agreement metrics
    const { agreementRate, flipRate } = this.calculateAgreementMetrics(samples, predictions);

    // Calibration curve
    const calibrationCurve = this.calculateCalibrationCurve(samples, predictions);

    return {
      accuracy,
      precision,
      recall,
      f1,
      ece,
      eceBins,
      agreementRate,
      flipRate,
      calibrationCurve,
      confusionMatrix: { tp, tn, fp, fn },
    };
  }

  /**
   * Calculate per-strata metrics
   */
  static calculateStrataMetrics(samples: LabeledSample[], predictions: any[]): any[] {
    const strata = {
      low: { samples: [] as number[], predictions: [] as any[] },
      medium: { samples: [] as number[], predictions: [] as any[] },
      high: { samples: [] as number[], predictions: [] as any[] },
    };

    // Group by coverage
    samples.forEach((sample, idx) => {
      const coverage = sample.features.coverage;
      if (coverage < 40) {
        strata.low.samples.push(idx);
        strata.low.predictions.push(predictions[idx]);
      } else if (coverage < 70) {
        strata.medium.samples.push(idx);
        strata.medium.predictions.push(predictions[idx]);
      } else {
        strata.high.samples.push(idx);
        strata.high.predictions.push(predictions[idx]);
      }
    });

    // Calculate metrics per stratum
    const result = [];
    
    for (const [band, data] of Object.entries(strata)) {
      if (data.samples.length === 0) {
        result.push({
          band,
          accuracy: 0,
          sampleCount: 0,
          precision: 0,
          recall: 0,
          f1: 0,
          ece: 0,
          agreementRate: 0,
        });
        continue;
      }

      const strataSamples = data.samples.map(idx => samples[idx]);
      const strataPredictions = data.predictions;

      const metrics = this.calculateAllMetrics(strataSamples, strataPredictions);

      result.push({
        band,
        accuracy: metrics.accuracy,
        sampleCount: data.samples.length,
        precision: metrics.precision,
        recall: metrics.recall,
        f1: metrics.f1,
        ece: metrics.ece,
        agreementRate: metrics.agreementRate,
      });
    }

    return result;
  }
}
