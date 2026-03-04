/**
 * Calibration Dataset Builder
 * 
 * Phase 6: Calibration Layer
 * 
 * Collects:
 * - score
 * - pattern_type
 * - outcome
 */

import { Db } from 'mongodb';
import { getMongoDb } from '../../../db/mongoose.js';

export type CalibrationDataPoint = {
  score: number;
  type: string;
  result: 'WIN' | 'LOSS' | 'TIMEOUT';
  returnPct?: number;
  patternId: string;
  runId: string;
};

/**
 * Build calibration dataset by joining ta_patterns with ta_outcomes
 */
export async function buildCalibrationDataset(
  db: Db,
  options: {
    asset?: string;
    minOutcomes?: number;
    since?: Date;
  } = {}
): Promise<CalibrationDataPoint[]> {
  const { asset, since } = options;

  // Build match stage
  const matchStage: any = {
    'outcome.result': { $in: ['WIN', 'LOSS', 'TIMEOUT'] }
  };
  
  if (asset) {
    matchStage.asset = asset;
  }
  
  if (since) {
    matchStage.createdAt = { $gte: since };
  }

  // Aggregate patterns with outcomes
  const pipeline = [
    {
      $lookup: {
        from: 'ta_outcomes',
        localField: 'patternId',
        foreignField: 'patternId',
        as: 'outcome'
      }
    },
    { $unwind: '$outcome' },
    { $match: matchStage },
    {
      $project: {
        _id: 0,
        score: '$scoring.score',
        type: '$type',
        result: '$outcome.result',
        returnPct: '$outcome.returnPct',
        patternId: 1,
        runId: 1
      }
    }
  ];

  const results = await db.collection('ta_patterns')
    .aggregate(pipeline)
    .toArray();

  return results as CalibrationDataPoint[];
}

/**
 * Build calibration dataset grouped by pattern type
 */
export async function buildCalibrationDatasetByType(
  db: Db,
  patternType: string,
  options: {
    asset?: string;
    since?: Date;
  } = {}
): Promise<CalibrationDataPoint[]> {
  const { asset, since } = options;

  // Build match stage
  const matchStage: any = {
    type: patternType,
    'outcome.result': { $in: ['WIN', 'LOSS', 'TIMEOUT'] }
  };
  
  if (asset) {
    matchStage.asset = asset;
  }
  
  if (since) {
    matchStage.createdAt = { $gte: since };
  }

  const pipeline = [
    {
      $lookup: {
        from: 'ta_outcomes',
        localField: 'patternId',
        foreignField: 'patternId',
        as: 'outcome'
      }
    },
    { $unwind: '$outcome' },
    { $match: matchStage },
    {
      $project: {
        _id: 0,
        score: '$scoring.score',
        type: 1,
        result: '$outcome.result',
        returnPct: '$outcome.returnPct',
        patternId: 1,
        runId: 1
      }
    }
  ];

  const results = await db.collection('ta_patterns')
    .aggregate(pipeline)
    .toArray();

  return results as CalibrationDataPoint[];
}

/**
 * Get unique pattern types from dataset
 */
export async function getPatternTypes(db: Db): Promise<string[]> {
  const types = await db.collection('ta_patterns')
    .distinct('type');
  
  return types.sort();
}
