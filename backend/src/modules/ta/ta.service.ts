/**
 * TA Service - Main orchestrator for Technical Analysis
 * 
 * Coordinates:
 * - Pivot Engine
 * - Structure Engine  
 * - Level Detector
 * - Pattern Detectors
 * - Outcome Engine
 * - Scenario Builder
 */

import { getMongoDb } from '../../db/mongoose.js';
import {
  OhlcvCandle,
  TaAnalyzeRequest,
  TaAnalyzeResponse,
  TaScenario,
  MarketStructure,
  Level,
  DetectedPattern
} from './ta.contracts.js';
import { PivotEngine } from './core/pivot.engine.js';
import { StructureEngine } from './core/structure.engine.js';
import { VolatilityEngine, VolatilityMetrics } from './core/volatility.engine.js';
import { LevelsDetector } from './detectors/levels.detector.js';
import { ScenarioBuilder } from './aggregation/scenario.builder.js';

export class TaService {
  private pivotEngine: PivotEngine;
  private structureEngine: StructureEngine;
  private volatilityEngine: VolatilityEngine;
  private levelsDetector: LevelsDetector;
  private scenarioBuilder: ScenarioBuilder;

  constructor() {
    this.pivotEngine = new PivotEngine();
    this.structureEngine = new StructureEngine();
    this.volatilityEngine = new VolatilityEngine();
    this.levelsDetector = new LevelsDetector();
    this.scenarioBuilder = new ScenarioBuilder();
  }

  /**
   * Main analysis endpoint
   */
  async analyze(request: TaAnalyzeRequest): Promise<TaAnalyzeResponse> {
    const { asset, timeframe, lookback } = request;
    
    // 1. Fetch OHLCV data
    const candles = await this.fetchCandles(asset, timeframe, lookback);
    
    if (candles.length < 50) {
      return {
        ok: false,
        asset,
        timeframe,
        structure: this.getEmptyStructure(),
        levels: [],
        patterns: [],
        scenarios: [],
        timestamp: new Date().toISOString()
      };
    }

    // 2. Detect pivots
    const pivots = this.pivotEngine.detectPivots(candles);
    
    // 3. Analyze market structure
    const structure = this.structureEngine.analyze(candles, pivots);
    
    // 4. Detect support/resistance levels
    const levels = this.levelsDetector.detect(candles, pivots);
    
    // 5. Detect patterns (placeholder - will add detectors)
    const patterns: DetectedPattern[] = [];
    
    // 6. Build trading scenarios
    const scenarios = this.scenarioBuilder.build(
      asset,
      timeframe,
      candles,
      structure,
      levels,
      patterns
    );

    return {
      ok: true,
      asset,
      timeframe,
      structure,
      levels,
      patterns,
      scenarios,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Fetch OHLCV candles from database
   */
  private async fetchCandles(
    asset: string,
    timeframe: string,
    lookback: number
  ): Promise<OhlcvCandle[]> {
    const db = getMongoDb();
    
    // Determine collection based on asset
    let collection = 'fractal_canonical_ohlcv';
    if (asset.toUpperCase() === 'SPX') {
      collection = 'spx_candles';
    } else if (asset.toUpperCase() === 'DXY') {
      collection = 'dxy_candles';
    }

    const candles = await db.collection(collection)
      .find({})
      .sort({ ts: -1 })
      .limit(lookback)
      .toArray();

    // Convert to OhlcvCandle format and reverse to chronological order
    return candles.reverse().map((c: any) => ({
      ts: c.ts || new Date(c.date).getTime(),
      date: c.date || new Date(c.ts).toISOString().split('T')[0],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));
  }

  /**
   * Get empty structure for error cases
   */
  private getEmptyStructure(): MarketStructure {
    return {
      trend: 'SIDEWAYS',
      strength: 0,
      swingHighs: [],
      swingLows: [],
      higherHighs: false,
      higherLows: false,
      lowerHighs: false,
      lowerLows: false
    };
  }

  /**
   * Health check
   */
  async health(): Promise<{ ok: boolean; version: string }> {
    return {
      ok: true,
      version: '1.0.0'
    };
  }
}
