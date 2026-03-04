/**
 * S1.1 - Strategy Evaluation Service
 * 
 * Evaluates signal drivers against strategy rules
 * to produce actionable verdicts.
 */
import type {
  StrategyDefinition,
  StrategyRule,
  StrategyCondition,
  StrategyEvaluationInput,
  StrategyEvaluationResult,
  MultiStrategyResult,
  StrategyVerdict,
  DriverCondition,
} from '../types/strategy.types.js';
import { getStrategiesForNetwork, STRATEGY_CATALOG } from '../types/strategy.catalog.js';

// Bullish states
const BULLISH_STATES = new Set([
  'ACCUMULATION',
  'PERSISTENT',
  'ADDITION',
  'CONSOLIDATION',
  'GROWING',
  'ACTIVE',
  'SUPPORT',
]);

// Bearish states
const BEARISH_STATES = new Set([
  'DISTRIBUTION',
  'BREAKDOWN',
  'REMOVAL',
  'WEAK',
  'SHRINKING',
  'RESISTANCE',
]);

export class StrategyEvaluationService {
  /**
   * Evaluate a single strategy
   */
  evaluateStrategy(
    strategy: StrategyDefinition,
    input: StrategyEvaluationInput
  ): StrategyEvaluationResult {
    // Sort rules by priority (highest first)
    const sortedRules = [...strategy.rules].sort((a, b) => b.priority - a.priority);

    // Find first matching rule
    for (const rule of sortedRules) {
      if (this.matchesCondition(rule.when, input)) {
        return {
          strategyId: strategy.id,
          strategyName: strategy.name,
          verdict: rule.then.verdict,
          risk: rule.then.risk,
          horizon: rule.then.horizon,
          reasons: rule.then.reasons,
          matchedRule: rule.id,
          confidence: this.calculateConfidence(input, rule),
          timestamp: Date.now(),
        };
      }
    }

    // No rule matched - return default
    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      verdict: strategy.defaultOutcome.verdict,
      risk: strategy.defaultOutcome.risk,
      horizon: strategy.defaultOutcome.horizon,
      reasons: strategy.defaultOutcome.reasons,
      confidence: 'LOW',
      timestamp: Date.now(),
    };
  }

  /**
   * Evaluate all strategies for a network
   */
  evaluateAll(input: StrategyEvaluationInput): MultiStrategyResult {
    const strategies = getStrategiesForNetwork(input.network);
    const results: StrategyEvaluationResult[] = [];

    for (const strategy of strategies) {
      results.push(this.evaluateStrategy(strategy, input));
    }

    // Determine primary verdict (first non-WAIT verdict, or WAIT if all are WAIT)
    const primaryVerdict = this.determinePrimaryVerdict(results);

    return {
      network: input.network,
      strategies: results,
      primaryVerdict,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if input matches a condition
   */
  private matchesCondition(
    condition: StrategyCondition,
    input: StrategyEvaluationInput
  ): boolean {
    // Check quality
    if (condition.quality && !condition.quality.includes(input.quality)) {
      return false;
    }

    // Check specific drivers
    if (condition.drivers) {
      for (const driverCond of condition.drivers) {
        if (!this.matchesDriverCondition(driverCond, input)) {
          return false;
        }
      }
    }

    // Check min bullish drivers
    if (condition.minBullishDrivers !== undefined) {
      const bullishCount = this.countBullishDrivers(input);
      if (bullishCount < condition.minBullishDrivers) {
        return false;
      }
    }

    // Check min bearish drivers
    if (condition.minBearishDrivers !== undefined) {
      const bearishCount = this.countBearishDrivers(input);
      if (bearishCount < condition.minBearishDrivers) {
        return false;
      }
    }

    // Check exclude states
    if (condition.excludeStates) {
      for (const excl of condition.excludeStates) {
        const driver = input.drivers[excl.driver];
        if (driver && driver.state === excl.state) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a specific driver matches condition
   */
  private matchesDriverCondition(
    condition: DriverCondition,
    input: StrategyEvaluationInput
  ): boolean {
    const driver = input.drivers[condition.driver];
    if (!driver) {
      return false;
    }

    // Check state
    const states = Array.isArray(condition.state) ? condition.state : [condition.state];
    if (!states.includes(driver.state)) {
      return false;
    }

    // Check strength if specified
    if (condition.strength) {
      const strengths = Array.isArray(condition.strength) ? condition.strength : [condition.strength];
      if (!strengths.includes(driver.strength)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Count bullish drivers
   */
  private countBullishDrivers(input: StrategyEvaluationInput): number {
    let count = 0;
    for (const driver of Object.values(input.drivers)) {
      if (BULLISH_STATES.has(driver.state)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Count bearish drivers
   */
  private countBearishDrivers(input: StrategyEvaluationInput): number {
    let count = 0;
    for (const driver of Object.values(input.drivers)) {
      if (BEARISH_STATES.has(driver.state)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Calculate confidence based on match quality
   */
  private calculateConfidence(
    input: StrategyEvaluationInput,
    rule: StrategyRule
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    // Base confidence on quality
    if (input.quality === 'HIGH') {
      return 'HIGH';
    }
    if (input.quality === 'MEDIUM') {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  /**
   * Determine primary verdict from all results
   */
  private determinePrimaryVerdict(results: StrategyEvaluationResult[]): StrategyVerdict {
    // Priority order for verdicts
    const verdictPriority: StrategyVerdict[] = [
      'AVOID',
      'EXIT',
      'ACCUMULATE',
      'HIGH_RISK',
      'WAIT',
    ];

    for (const verdict of verdictPriority) {
      const found = results.find(r => r.verdict === verdict && r.matchedRule);
      if (found) {
        return verdict;
      }
    }

    return 'WAIT';
  }

  /**
   * Static convenience method
   */
  static evaluate(input: StrategyEvaluationInput): MultiStrategyResult {
    const service = new StrategyEvaluationService();
    return service.evaluateAll(input);
  }

  /**
   * Get all available strategies
   */
  static getCatalog(): StrategyDefinition[] {
    return [...STRATEGY_CATALOG];
  }
}

export default StrategyEvaluationService;
