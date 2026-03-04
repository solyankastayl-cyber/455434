/**
 * Phase I: Calibrator Service
 * 
 * Main calibration service with per-regime models
 */

import { Db } from 'mongodb';
import { getMongoDb } from '../../../db/mongoose.js';
import {
  CalibrationModel,
  CalibrationResult,
  CalibrationConfig,
  RegimeBucket,
  DEFAULT_CALIBRATION_CONFIG,
} from './calibration_types.js';
import { buildCalibrationDataset, groupByRegime, getDatasetStats } from './dataset_builder.js';
import { buildCalibratedBins, lookupProbability, calculateECE } from './bins.js';
import { fallbackProbability } from '../decision/probability.js';

// In-memory cache
let modelCache: Map<RegimeBucket | 'GLOBAL', CalibrationModel> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Calibration Service v2
 */
export class CalibratorV2 {
  private db: Db | null = null;
  private config: CalibrationConfig;
  
  constructor(config: Partial<CalibrationConfig> = {}) {
    this.config = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
  }
  
  private getDb(): Db {
    if (!this.db) {
      this.db = getMongoDb();
    }
    return this.db;
  }
  
  /**
   * Load all calibration models from DB
   */
  async loadModels(forceRefresh: boolean = false): Promise<void> {
    const now = Date.now();
    
    // Check cache
    if (!forceRefresh && modelCache.size > 0 && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return;
    }
    
    const db = this.getDb();
    const models = await db.collection('ta_calibration_models')
      .find({})
      .toArray();
    
    modelCache.clear();
    
    for (const m of models) {
      const model: CalibrationModel = {
        regime: m.regime,
        bins: m.bins || [],
        sampleCount: m.sampleCount || 0,
        winRate: m.winRate || 0,
        ece: m.ece || 0,
        generatedAt: new Date(m.generatedAt),
      };
      modelCache.set(m.regime, model);
    }
    
    cacheTimestamp = now;
  }
  
  /**
   * Calibrate a score given the current regime
   */
  async calibrate(
    score: number,
    regime: RegimeBucket | null
  ): Promise<CalibrationResult> {
    await this.loadModels();
    
    // Try regime-specific model first
    if (regime && modelCache.has(regime)) {
      const model = modelCache.get(regime)!;
      
      if (model.sampleCount >= this.config.minTotalSamples) {
        const probability = lookupProbability(score, model.bins);
        
        if (probability !== null) {
          return {
            probability,
            source: 'CALIBRATED',
            regime,
            bin: model.bins.find(b => score >= b.minScore && score <= b.maxScore) || null,
            sampleCount: model.sampleCount,
          };
        }
      }
    }
    
    // Fall back to global model
    if (this.config.fallbackToGlobal && modelCache.has('GLOBAL' as any)) {
      const globalModel = modelCache.get('GLOBAL' as any)!;
      
      if (globalModel.sampleCount >= this.config.minTotalSamples) {
        const probability = lookupProbability(score, globalModel.bins);
        
        if (probability !== null) {
          return {
            probability,
            source: 'CALIBRATED',
            regime: 'GLOBAL' as any,
            bin: globalModel.bins.find(b => score >= b.minScore && score <= b.maxScore) || null,
            sampleCount: globalModel.sampleCount,
          };
        }
      }
    }
    
    // Final fallback: logistic shrink
    const fallback = fallbackProbability(score);
    return {
      probability: fallback.p,
      source: 'FALLBACK',
      regime: null,
      bin: null,
      sampleCount: 0,
    };
  }
  
  /**
   * Create calibrator function for ScenarioRanker
   */
  createCalibrator(regime: RegimeBucket | null): (score: number) => Promise<number | null> {
    return async (score: number): Promise<number | null> => {
      const result = await this.calibrate(score, regime);
      return result.source === 'CALIBRATED' ? result.probability : null;
    };
  }
  
  /**
   * Get model for a specific regime
   */
  async getModel(regime: RegimeBucket | 'GLOBAL'): Promise<CalibrationModel | null> {
    await this.loadModels();
    return modelCache.get(regime) || null;
  }
  
  /**
   * Get all loaded models
   */
  async getAllModels(): Promise<CalibrationModel[]> {
    await this.loadModels();
    return Array.from(modelCache.values());
  }
  
  /**
   * Check if calibration is available for a regime
   */
  async hasCalibration(regime: RegimeBucket): Promise<boolean> {
    await this.loadModels();
    const model = modelCache.get(regime);
    return model !== undefined && model.sampleCount >= this.config.minTotalSamples;
  }
  
  /**
   * Clear the cache
   */
  clearCache(): void {
    modelCache.clear();
    cacheTimestamp = 0;
  }
}

// Singleton instance
export const calibratorV2 = new CalibratorV2();
