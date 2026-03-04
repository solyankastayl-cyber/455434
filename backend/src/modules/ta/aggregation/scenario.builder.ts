/**
 * Scenario Builder - Generates trading scenarios from TA analysis
 * 
 * Combines:
 * - Market structure
 * - Support/Resistance levels
 * - Detected patterns
 * - Volatility regime
 * 
 * Outputs 1-2 best scenarios with entry, target, stop
 */

import { 
  TaScenario, 
  MarketStructure, 
  Level, 
  DetectedPattern,
  OhlcvCandle 
} from '../ta.contracts.js';
import { VolatilityEngine, VolatilityMetrics } from '../core/volatility.engine.js';
import { v4 as uuid } from 'uuid';

export interface ScenarioBuilderConfig {
  minRiskReward: number;
  maxScenarios: number;
  defaultRiskPct: number;
}

const DEFAULT_CONFIG: ScenarioBuilderConfig = {
  minRiskReward: 1.5,
  maxScenarios: 2,
  defaultRiskPct: 2
};

export class ScenarioBuilder {
  private config: ScenarioBuilderConfig;
  private volatilityEngine: VolatilityEngine;

  constructor(config: Partial<ScenarioBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.volatilityEngine = new VolatilityEngine();
  }

  /**
   * Build trading scenarios from analysis results
   */
  build(
    asset: string,
    timeframe: string,
    candles: OhlcvCandle[],
    structure: MarketStructure,
    levels: Level[],
    patterns: DetectedPattern[]
  ): TaScenario[] {
    const currentPrice = candles[candles.length - 1].close;
    const volatility = this.volatilityEngine.calculate(candles);
    
    const scenarios: TaScenario[] = [];

    // Strategy 1: Trend Following
    const trendScenario = this.buildTrendScenario(
      asset, timeframe, currentPrice, structure, levels, volatility
    );
    if (trendScenario) scenarios.push(trendScenario);

    // Strategy 2: Pattern-Based
    if (patterns.length > 0) {
      const patternScenario = this.buildPatternScenario(
        asset, timeframe, currentPrice, patterns, levels, volatility
      );
      if (patternScenario) scenarios.push(patternScenario);
    }

    // Strategy 3: Level Bounce/Break
    const levelScenario = this.buildLevelScenario(
      asset, timeframe, currentPrice, levels, structure, volatility
    );
    if (levelScenario && scenarios.length < this.config.maxScenarios) {
      scenarios.push(levelScenario);
    }

    // Sort by confidence and limit
    return scenarios
      .filter(s => s.riskReward >= this.config.minRiskReward)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxScenarios);
  }

  /**
   * Build trend-following scenario
   */
  private buildTrendScenario(
    asset: string,
    timeframe: string,
    currentPrice: number,
    structure: MarketStructure,
    levels: Level[],
    volatility: VolatilityMetrics
  ): TaScenario | null {
    if (structure.trend === 'SIDEWAYS' || structure.strength < 0.3) {
      return null;
    }

    const isUptrend = structure.trend === 'UPTREND';
    const direction = isUptrend ? 'LONG' : 'SHORT';

    // Find nearest support/resistance for stop/target
    const support = levels.find(l => l.type === 'SUPPORT' && l.price < currentPrice);
    const resistance = levels.find(l => l.type === 'RESISTANCE' && l.price > currentPrice);

    let entryPrice = currentPrice;
    let stopPrice: number;
    let targetPrice: number;

    if (isUptrend) {
      stopPrice = support?.price || currentPrice * (1 - volatility.atrPct / 100);
      targetPrice = resistance?.price || currentPrice * (1 + volatility.atrPct * 2 / 100);
    } else {
      stopPrice = resistance?.price || currentPrice * (1 + volatility.atrPct / 100);
      targetPrice = support?.price || currentPrice * (1 - volatility.atrPct * 2 / 100);
    }

    const risk = Math.abs(entryPrice - stopPrice);
    const reward = Math.abs(targetPrice - entryPrice);
    const riskReward = reward / risk;

    if (riskReward < this.config.minRiskReward) {
      return null;
    }

    return {
      id: `scenario_${uuid()}`,
      asset,
      timeframe,
      direction,
      confidence: structure.strength * 0.8,
      entryPrice: Math.round(entryPrice * 100) / 100,
      targetPrice: Math.round(targetPrice * 100) / 100,
      stopPrice: Math.round(stopPrice * 100) / 100,
      riskReward: Math.round(riskReward * 100) / 100,
      patterns: [],
      levels: levels.slice(0, 3),
      structure,
      createdAt: new Date().toISOString(),
      expiresAt: this.calculateExpiry(timeframe)
    };
  }

  /**
   * Build pattern-based scenario
   */
  private buildPatternScenario(
    asset: string,
    timeframe: string,
    currentPrice: number,
    patterns: DetectedPattern[],
    levels: Level[],
    volatility: VolatilityMetrics
  ): TaScenario | null {
    // Get strongest pattern
    const bestPattern = patterns
      .filter(p => p.direction !== 'NEUTRAL')
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (!bestPattern) return null;

    const direction = bestPattern.direction === 'BULLISH' ? 'LONG' : 'SHORT';
    
    let targetPrice = bestPattern.targetPrice || currentPrice * (direction === 'LONG' ? 1.05 : 0.95);
    let stopPrice = bestPattern.invalidationPrice || currentPrice * (direction === 'LONG' ? 0.97 : 1.03);

    const risk = Math.abs(currentPrice - stopPrice);
    const reward = Math.abs(targetPrice - currentPrice);
    const riskReward = reward / risk;

    return {
      id: `scenario_${uuid()}`,
      asset,
      timeframe,
      direction,
      confidence: bestPattern.confidence,
      entryPrice: Math.round(currentPrice * 100) / 100,
      targetPrice: Math.round(targetPrice * 100) / 100,
      stopPrice: Math.round(stopPrice * 100) / 100,
      riskReward: Math.round(riskReward * 100) / 100,
      patterns: [bestPattern],
      levels: levels.slice(0, 3),
      structure: {
        trend: 'SIDEWAYS',
        strength: 0,
        swingHighs: [],
        swingLows: [],
        higherHighs: false,
        higherLows: false,
        lowerHighs: false,
        lowerLows: false
      },
      createdAt: new Date().toISOString(),
      expiresAt: this.calculateExpiry(timeframe)
    };
  }

  /**
   * Build level-based scenario (bounce or breakout)
   */
  private buildLevelScenario(
    asset: string,
    timeframe: string,
    currentPrice: number,
    levels: Level[],
    structure: MarketStructure,
    volatility: VolatilityMetrics
  ): TaScenario | null {
    // Find nearest unbroken levels
    const nearSupport = levels.find(l => 
      l.type === 'SUPPORT' && 
      !l.broken && 
      Math.abs(l.price - currentPrice) / currentPrice < 0.02
    );
    
    const nearResistance = levels.find(l => 
      l.type === 'RESISTANCE' && 
      !l.broken && 
      Math.abs(l.price - currentPrice) / currentPrice < 0.02
    );

    if (!nearSupport && !nearResistance) return null;

    let scenario: Partial<TaScenario> = {};

    if (nearSupport && structure.trend !== 'DOWNTREND') {
      // Support bounce scenario
      const targetLevel = levels.find(l => l.type === 'RESISTANCE' && l.price > currentPrice);
      scenario = {
        direction: 'LONG',
        entryPrice: nearSupport.price * 1.002,
        stopPrice: nearSupport.price * 0.99,
        targetPrice: targetLevel?.price || currentPrice * 1.03,
        confidence: nearSupport.strength * 0.7
      };
    } else if (nearResistance && structure.trend !== 'UPTREND') {
      // Resistance rejection scenario
      const targetLevel = levels.find(l => l.type === 'SUPPORT' && l.price < currentPrice);
      scenario = {
        direction: 'SHORT',
        entryPrice: nearResistance.price * 0.998,
        stopPrice: nearResistance.price * 1.01,
        targetPrice: targetLevel?.price || currentPrice * 0.97,
        confidence: nearResistance.strength * 0.7
      };
    }

    if (!scenario.direction) return null;

    const risk = Math.abs(scenario.entryPrice! - scenario.stopPrice!);
    const reward = Math.abs(scenario.targetPrice! - scenario.entryPrice!);
    const riskReward = reward / risk;

    return {
      id: `scenario_${uuid()}`,
      asset,
      timeframe,
      direction: scenario.direction,
      confidence: scenario.confidence!,
      entryPrice: Math.round(scenario.entryPrice! * 100) / 100,
      targetPrice: Math.round(scenario.targetPrice! * 100) / 100,
      stopPrice: Math.round(scenario.stopPrice! * 100) / 100,
      riskReward: Math.round(riskReward * 100) / 100,
      patterns: [],
      levels: levels.slice(0, 3),
      structure,
      createdAt: new Date().toISOString(),
      expiresAt: this.calculateExpiry(timeframe)
    };
  }

  /**
   * Calculate scenario expiry based on timeframe
   */
  private calculateExpiry(timeframe: string): string {
    const now = new Date();
    let hours = 24;

    switch (timeframe) {
      case '1H': hours = 4; break;
      case '4H': hours = 16; break;
      case '1D': hours = 48; break;
      case '1W': hours = 168; break;
    }

    return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  }
}
