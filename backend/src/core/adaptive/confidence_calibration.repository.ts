/**
 * Confidence Calibration Repository
 */
import {
  ConfidenceCalibrationModel,
  IConfidenceCalibration,
  CalibrationSubject,
  DEFAULT_CONFIDENCE_BUCKETS,
  CALIBRATION_VALIDITY_HOURS,
  CALIBRATION_BOUNDS,
} from './confidence_calibration.model.js';
import { env } from '../../config/env.js';

/**
 * Create empty buckets
 */
function createEmptyBuckets() {
  return DEFAULT_CONFIDENCE_BUCKETS.map(b => ({
    ...b,
    totalPredictions: 0,
    correctOutcomes: 0,
    actualAccuracy: 0,
    bucketCalibration: 1,
  }));
}

/**
 * Get or create calibration record
 */
export async function getOrCreateCalibration(
  subjectType: CalibrationSubject,
  subjectId: string
): Promise<IConfidenceCalibration> {
  const existing = await ConfidenceCalibrationModel.findOne({
    subjectType,
    subjectId: subjectId.toLowerCase(),
  });
  
  if (existing) return existing;
  
  const calibration = new ConfidenceCalibrationModel({
    subjectType,
    subjectId: subjectId.toLowerCase(),
    calibrationFactor: 1.0,
    buckets: createEmptyBuckets(),
    calculatedAt: new Date(),
    validUntil: new Date(Date.now() + CALIBRATION_VALIDITY_HOURS * 60 * 60 * 1000),
  });
  
  return calibration.save();
}

/**
 * Get calibration
 */
export async function getCalibration(
  subjectType: CalibrationSubject,
  subjectId: string
): Promise<IConfidenceCalibration | null> {
  return ConfidenceCalibrationModel.findOne({
    subjectType,
    subjectId: subjectId.toLowerCase(),
  }).lean() as unknown as Promise<IConfidenceCalibration | null>;
}

/**
 * Add prediction outcome to calibration
 */
export async function addPredictionOutcome(
  subjectType: CalibrationSubject,
  subjectId: string,
  predictedConfidence: number,
  wasCorrect: boolean
): Promise<IConfidenceCalibration | null> {
  const calibration = await ConfidenceCalibrationModel.findOne({
    subjectType,
    subjectId: subjectId.toLowerCase(),
  });
  
  if (!calibration) return null;
  
  // Find the right bucket
  const bucketIndex = calibration.buckets.findIndex(
    b => predictedConfidence >= b.rangeMin && predictedConfidence < b.rangeMax
  );
  
  if (bucketIndex >= 0) {
    calibration.buckets[bucketIndex].totalPredictions += 1;
    if (wasCorrect) {
      calibration.buckets[bucketIndex].correctOutcomes += 1;
    }
    
    // Recalculate bucket accuracy
    const bucket = calibration.buckets[bucketIndex];
    bucket.actualAccuracy = bucket.totalPredictions > 0
      ? bucket.correctOutcomes / bucket.totalPredictions
      : 0;
    bucket.bucketCalibration = bucket.expectedAccuracy > 0
      ? bucket.actualAccuracy / bucket.expectedAccuracy
      : 1;
  }
  
  // Update stats
  calibration.stats.totalSamples += 1;
  
  const expectedOutcome = predictedConfidence >= 0.5;
  if (expectedOutcome && !wasCorrect) {
    calibration.stats.overconfidentCount += 1;
  } else if (!expectedOutcome && wasCorrect) {
    calibration.stats.underconfidentCount += 1;
  } else {
    calibration.stats.wellCalibratedCount += 1;
  }
  
  // Brier score (running average)
  const outcome = wasCorrect ? 1 : 0;
  const error = Math.pow(predictedConfidence - outcome, 2);
  const n = calibration.stats.totalSamples;
  calibration.stats.brierScore = ((n - 1) * calibration.stats.brierScore + error) / n;
  
  await calibration.save();
  return calibration;
}

/**
 * Recalculate calibration factor
 * Applies stability floor and smoothing to prevent jumps from single events
 */
export async function recalculateCalibration(
  subjectType: CalibrationSubject,
  subjectId: string
): Promise<IConfidenceCalibration | null> {
  const calibration = await ConfidenceCalibrationModel.findOne({
    subjectType,
    subjectId: subjectId.toLowerCase(),
  });
  
  if (!calibration) return null;
  
  // Calculate weighted average of bucket calibrations
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const bucket of calibration.buckets) {
    if (bucket.totalPredictions > 0) {
      // Weight by number of predictions in bucket
      const weight = bucket.totalPredictions;
      weightedSum += bucket.bucketCalibration * weight;
      totalWeight += weight;
    }
  }
  
  const previousFactor = calibration.calibrationFactor;
  let newFactor = totalWeight > 0 ? weightedSum / totalWeight : 1.0;
  
  // Clamp to bounds
  newFactor = Math.max(CALIBRATION_BOUNDS.min, Math.min(CALIBRATION_BOUNDS.max, newFactor));
  
  // Apply stability floor and smoothing
  // confidence = max(prev * (1 - smoothing) + new * smoothing, CONFIDENCE_FLOOR)
  const smoothingFactor = env.CONFIDENCE_SMOOTHING_FACTOR; // 0.3 default
  const confidenceFloor = env.CONFIDENCE_FLOOR; // 0.15 default
  
  let smoothedFactor = previousFactor * (1 - smoothingFactor) + newFactor * smoothingFactor;
  
  // Apply stability floor - prevent calibration from going below floor
  // This prevents wild swings from single events
  smoothedFactor = Math.max(confidenceFloor, smoothedFactor);
  
  calibration.calibrationFactor = smoothedFactor;
  
  // Determine trend
  const delta = calibration.calibrationFactor - previousFactor;
  if (Math.abs(delta) < 0.01) {
    calibration.trend = 'stable';
  } else if (
    (previousFactor < 1 && calibration.calibrationFactor > previousFactor) ||
    (previousFactor > 1 && calibration.calibrationFactor < previousFactor)
  ) {
    calibration.trend = 'improving';
  } else {
    calibration.trend = 'degrading';
  }
  
  calibration.previousFactor = previousFactor;
  calibration.calculatedAt = new Date();
  calibration.validUntil = new Date(Date.now() + CALIBRATION_VALIDITY_HOURS * 60 * 60 * 1000);
  
  await calibration.save();
  return calibration;
}

/**
 * Get all calibrations by type
 */
export async function getCalibrationsByType(
  subjectType: CalibrationSubject
): Promise<IConfidenceCalibration[]> {
  return ConfidenceCalibrationModel
    .find({ subjectType })
    .sort({ calibrationFactor: 1 })
    .lean() as unknown as Promise<IConfidenceCalibration[]>;
}

/**
 * Get poorly calibrated subjects
 */
export async function getPoorlyCalibrated(
  threshold: number = 0.15
): Promise<IConfidenceCalibration[]> {
  return ConfidenceCalibrationModel
    .find({
      $or: [
        { calibrationFactor: { $lt: 1 - threshold } },
        { calibrationFactor: { $gt: 1 + threshold } },
      ],
    })
    .sort({ calibrationFactor: 1 })
    .lean() as unknown as Promise<IConfidenceCalibration[]>;
}

/**
 * Get calibration stats
 */
export async function getCalibrationStats(): Promise<{
  total: number;
  avgCalibrationFactor: number;
  avgBrierScore: number;
  overconfidentSubjects: number;
  underconfidentSubjects: number;
  wellCalibratedSubjects: number;
}> {
  const [total, avgAgg, distributionAgg] = await Promise.all([
    ConfidenceCalibrationModel.countDocuments(),
    ConfidenceCalibrationModel.aggregate([
      {
        $group: {
          _id: null,
          avgFactor: { $avg: '$calibrationFactor' },
          avgBrier: { $avg: '$stats.brierScore' },
        },
      },
    ]),
    ConfidenceCalibrationModel.aggregate([
      {
        $group: {
          _id: null,
          over: { $sum: { $cond: [{ $lt: ['$calibrationFactor', 0.9] }, 1, 0] } },
          under: { $sum: { $cond: [{ $gt: ['$calibrationFactor', 1.1] }, 1, 0] } },
          well: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$calibrationFactor', 0.9] },
                    { $lte: ['$calibrationFactor', 1.1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);
  
  return {
    total,
    avgCalibrationFactor: avgAgg[0]?.avgFactor || 1,
    avgBrierScore: avgAgg[0]?.avgBrier || 0,
    overconfidentSubjects: distributionAgg[0]?.over || 0,
    underconfidentSubjects: distributionAgg[0]?.under || 0,
    wellCalibratedSubjects: distributionAgg[0]?.well || 0,
  };
}
