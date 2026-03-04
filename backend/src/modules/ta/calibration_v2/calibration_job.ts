/**
 * Phase I: Calibration Job
 * 
 * Batch job to rebuild calibration models from outcome data
 */

import { Db } from 'mongodb';
import { getMongoDb } from '../../../db/mongoose.js';
import {
  CalibrationModel,
  CalibrationConfig,
  RegimeBucket,
  DEFAULT_CALIBRATION_CONFIG,
} from './calibration_types.js';
import { buildCalibrationDataset, groupByRegime, getDatasetStats } from './dataset_builder.js';
import { buildCalibratedBins, calculateECE } from './bins.js';
import { calibratorV2 } from './calibrator.js';

export interface RebuildResult {
  ok: boolean;
  modelsBuilt: number;
  globalModel: {
    sampleCount: number;
    winRate: number;
    ece: number;
  } | null;
  regimeModels: Array<{
    regime: RegimeBucket;
    sampleCount: number;
    winRate: number;
    ece: number;
  }>;
  skippedRegimes: string[];
  timestamp: string;
}

/**
 * Rebuild all calibration models
 */
export async function rebuildCalibrationModels(params: {
  db?: Db;
  asset?: string;
  timeframe?: string;
  minDate?: Date;
  config?: Partial<CalibrationConfig>;
}): Promise<RebuildResult> {
  const db = params.db || getMongoDb();
  const config = { ...DEFAULT_CALIBRATION_CONFIG, ...params.config };
  
  console.log('[Calibration Job] Starting rebuild...');
  
  // 1. Build dataset
  const data = await buildCalibrationDataset(db, {
    asset: params.asset,
    timeframe: params.timeframe,
    minDate: params.minDate,
    limit: 20000,
  });
  
  console.log(`[Calibration Job] Dataset: ${data.length} data points`);
  
  if (data.length < config.minTotalSamples) {
    return {
      ok: false,
      modelsBuilt: 0,
      globalModel: null,
      regimeModels: [],
      skippedRegimes: [],
      timestamp: new Date().toISOString(),
    };
  }
  
  const results: RebuildResult = {
    ok: true,
    modelsBuilt: 0,
    globalModel: null,
    regimeModels: [],
    skippedRegimes: [],
    timestamp: new Date().toISOString(),
  };
  
  // 2. Build GLOBAL model (all data)
  const globalStats = getDatasetStats(data);
  const globalBins = buildCalibratedBins(data, config);
  const globalEce = calculateECE(globalBins);
  
  const globalModel: CalibrationModel = {
    regime: 'GLOBAL' as any,
    bins: globalBins,
    sampleCount: globalStats.total,
    winRate: globalStats.winRate,
    ece: globalEce,
    generatedAt: new Date(),
  };
  
  await db.collection('ta_calibration_models').updateOne(
    { regime: 'GLOBAL' },
    { $set: globalModel },
    { upsert: true }
  );
  
  results.modelsBuilt++;
  results.globalModel = {
    sampleCount: globalStats.total,
    winRate: globalStats.winRate,
    ece: globalEce,
  };
  
  console.log(`[Calibration Job] GLOBAL model: ${globalStats.total} samples, winRate=${globalStats.winRate.toFixed(3)}, ECE=${globalEce.toFixed(4)}`);
  
  // 3. Build per-regime models
  const regimeGroups = groupByRegime(data);
  
  for (const [regime, regimeData] of regimeGroups) {
    if (regimeData.length < config.minTotalSamples) {
      results.skippedRegimes.push(`${regime} (${regimeData.length} samples)`);
      continue;
    }
    
    const regimeStats = getDatasetStats(regimeData);
    const regimeBins = buildCalibratedBins(regimeData, config);
    const regimeEce = calculateECE(regimeBins);
    
    const regimeModel: CalibrationModel = {
      regime,
      bins: regimeBins,
      sampleCount: regimeStats.total,
      winRate: regimeStats.winRate,
      ece: regimeEce,
      generatedAt: new Date(),
    };
    
    await db.collection('ta_calibration_models').updateOne(
      { regime },
      { $set: regimeModel },
      { upsert: true }
    );
    
    results.modelsBuilt++;
    results.regimeModels.push({
      regime,
      sampleCount: regimeStats.total,
      winRate: regimeStats.winRate,
      ece: regimeEce,
    });
    
    console.log(`[Calibration Job] ${regime}: ${regimeStats.total} samples, winRate=${regimeStats.winRate.toFixed(3)}, ECE=${regimeEce.toFixed(4)}`);
  }
  
  // 4. Clear calibrator cache to pick up new models
  calibratorV2.clearCache();
  
  console.log(`[Calibration Job] Complete: ${results.modelsBuilt} models built`);
  
  return results;
}

/**
 * Initialize calibration indexes
 */
export async function initCalibrationIndexes(db?: Db): Promise<void> {
  const database = db || getMongoDb();
  
  await database.collection('ta_calibration_models').createIndex(
    { regime: 1 },
    { unique: true }
  );
}
