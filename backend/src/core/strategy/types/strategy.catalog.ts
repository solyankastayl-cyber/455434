/**
 * S1.1 - Strategy Catalog
 * 
 * Pre-defined strategies for signal interpretation.
 * Each strategy uses drivers A-F to determine actionable verdicts.
 */
import type { StrategyDefinition } from './strategy.types.js';

/**
 * Strategy 1: Accumulation Play
 * 
 * Identifies when signals suggest gradual accumulation is favorable.
 */
export const ACCUMULATION_STRATEGY: StrategyDefinition = {
  id: 'accumulation_play_v1',
  name: 'Accumulation Play',
  description: 'Identifies favorable conditions for gradual position building',
  version: '1.0.0',
  networks: ['ethereum', 'bnb'],
  active: true,
  rules: [
    {
      id: 'strong_accumulation',
      priority: 100,
      when: {
        quality: ['HIGH', 'MEDIUM'],
        drivers: [
          { driver: 'A', state: 'ACCUMULATION', strength: ['HIGH', 'MEDIUM'] },
          { driver: 'B', state: 'ACCUMULATION' },
        ],
      },
      then: {
        verdict: 'ACCUMULATE',
        risk: 'LOW',
        horizon: 'MEDIUM',
        reasons: [
          'Exchange flows indicate sustained accumulation',
          'Price is within demand zones',
          'Multiple signals align for position building',
        ],
      },
    },
    {
      id: 'moderate_accumulation',
      priority: 80,
      when: {
        quality: ['HIGH', 'MEDIUM'],
        drivers: [
          { driver: 'A', state: 'ACCUMULATION' },
        ],
        minBullishDrivers: 2,
      },
      then: {
        verdict: 'ACCUMULATE',
        risk: 'MEDIUM',
        horizon: 'MEDIUM',
        reasons: [
          'Exchange pressure favors accumulation',
          'Supporting signals present',
        ],
      },
    },
  ],
  defaultOutcome: {
    verdict: 'WAIT',
    risk: 'LOW',
    horizon: 'SHORT',
    reasons: ['Accumulation conditions not met'],
  },
};

/**
 * Strategy 2: Distribution / Exit
 * 
 * Identifies when signals suggest reducing or exiting positions.
 */
export const EXIT_STRATEGY: StrategyDefinition = {
  id: 'exit_distribution_v1',
  name: 'Distribution / Exit',
  description: 'Identifies conditions suggesting position reduction',
  version: '1.0.0',
  networks: ['ethereum', 'bnb'],
  active: true,
  rules: [
    {
      id: 'strong_distribution',
      priority: 100,
      when: {
        quality: ['HIGH', 'MEDIUM'],
        drivers: [
          { driver: 'A', state: 'DISTRIBUTION', strength: ['HIGH', 'MEDIUM'] },
          { driver: 'D', state: 'REMOVAL' },
        ],
      },
      then: {
        verdict: 'EXIT',
        risk: 'HIGH',
        horizon: 'SHORT',
        reasons: [
          'Strong exchange inflows detected',
          'Liquidity being removed from pools',
          'Multiple bearish signals present',
        ],
      },
    },
    {
      id: 'moderate_distribution',
      priority: 80,
      when: {
        drivers: [
          { driver: 'A', state: 'DISTRIBUTION' },
        ],
        minBearishDrivers: 2,
      },
      then: {
        verdict: 'EXIT',
        risk: 'MEDIUM',
        horizon: 'SHORT',
        reasons: [
          'Exchange flows indicate distribution',
          'Consider reducing exposure',
        ],
      },
    },
  ],
  defaultOutcome: {
    verdict: 'WAIT',
    risk: 'LOW',
    horizon: 'SHORT',
    reasons: ['No clear exit signals'],
  },
};

/**
 * Strategy 3: Liquidity Event
 * 
 * Identifies significant liquidity movements.
 */
export const LIQUIDITY_STRATEGY: StrategyDefinition = {
  id: 'liquidity_event_v1',
  name: 'Liquidity Event',
  description: 'Tracks significant pool liquidity changes',
  version: '1.0.0',
  networks: ['ethereum', 'bnb'],
  active: true,
  rules: [
    {
      id: 'liquidity_addition',
      priority: 90,
      when: {
        quality: ['HIGH', 'MEDIUM'],
        drivers: [
          { driver: 'D', state: 'ADDITION', strength: ['HIGH'] },
        ],
      },
      then: {
        verdict: 'ACCUMULATE',
        risk: 'MEDIUM',
        horizon: 'MEDIUM',
        reasons: [
          'Significant liquidity being added',
          'LPs showing confidence',
          'Potential for improved trading conditions',
        ],
      },
    },
    {
      id: 'liquidity_removal',
      priority: 90,
      when: {
        drivers: [
          { driver: 'D', state: 'REMOVAL', strength: ['HIGH'] },
        ],
      },
      then: {
        verdict: 'AVOID',
        risk: 'HIGH',
        horizon: 'SHORT',
        reasons: [
          'Major liquidity withdrawal detected',
          'Increased slippage risk',
          'LPs exiting positions',
        ],
      },
    },
  ],
  defaultOutcome: {
    verdict: 'WAIT',
    risk: 'LOW',
    horizon: 'SHORT',
    reasons: ['Liquidity stable'],
  },
};

/**
 * Strategy 4: Actor-Driven Opportunity
 * 
 * Follows significant wallet behavior patterns.
 */
export const ACTOR_STRATEGY: StrategyDefinition = {
  id: 'actor_opportunity_v1',
  name: 'Actor-Driven Opportunity',
  description: 'Identifies opportunities from key wallet behavior',
  version: '1.0.0',
  networks: ['ethereum', 'bnb'],
  active: true,
  rules: [
    {
      id: 'actor_consolidation',
      priority: 85,
      when: {
        quality: ['HIGH', 'MEDIUM'],
        drivers: [
          { driver: 'E', state: 'CONSOLIDATION', strength: ['HIGH', 'MEDIUM'] },
          { driver: 'C', state: 'PERSISTENT' },
        ],
      },
      then: {
        verdict: 'ACCUMULATE',
        risk: 'MEDIUM',
        horizon: 'LONG',
        reasons: [
          'Key actors reducing activity variance',
          'Persistent transaction corridors maintained',
          'Smart money positioning observed',
        ],
      },
    },
    {
      id: 'actor_distribution',
      priority: 85,
      when: {
        drivers: [
          { driver: 'E', state: 'DISTRIBUTION' },
          { driver: 'A', state: 'DISTRIBUTION' },
        ],
      },
      then: {
        verdict: 'EXIT',
        risk: 'HIGH',
        horizon: 'SHORT',
        reasons: [
          'Key actors distributing',
          'Combined with exchange pressure',
          'Consider risk reduction',
        ],
      },
    },
  ],
  defaultOutcome: {
    verdict: 'WAIT',
    risk: 'LOW',
    horizon: 'SHORT',
    reasons: ['No clear actor-driven signal'],
  },
};

/**
 * Strategy 5: No-Trade / Avoid
 * 
 * Identifies conditions where staying out is recommended.
 */
export const AVOID_STRATEGY: StrategyDefinition = {
  id: 'avoid_notrade_v1',
  name: 'No-Trade / Avoid',
  description: 'Identifies high-risk or unclear conditions',
  version: '1.0.0',
  networks: ['ethereum', 'bnb'],
  active: true,
  rules: [
    {
      id: 'low_quality',
      priority: 100,
      when: {
        quality: ['LOW'],
      },
      then: {
        verdict: 'AVOID',
        risk: 'HIGH',
        horizon: 'SHORT',
        reasons: [
          'Signal quality too low for reliable decisions',
          'Wait for better data coverage',
        ],
      },
    },
    {
      id: 'event_alert',
      priority: 90,
      when: {
        drivers: [
          { driver: 'F', state: 'ALERT', strength: ['HIGH'] },
        ],
      },
      then: {
        verdict: 'AVOID',
        risk: 'HIGH',
        horizon: 'SHORT',
        reasons: [
          'Unusual on-chain activity detected',
          'Wait for clarity before acting',
        ],
      },
    },
    {
      id: 'conflicting_signals',
      priority: 80,
      when: {
        minBullishDrivers: 2,
        minBearishDrivers: 2,
      },
      then: {
        verdict: 'WAIT',
        risk: 'MEDIUM',
        horizon: 'SHORT',
        reasons: [
          'Conflicting signals present',
          'Market direction unclear',
          'Monitor for resolution',
        ],
      },
    },
  ],
  defaultOutcome: {
    verdict: 'WAIT',
    risk: 'LOW',
    horizon: 'SHORT',
    reasons: ['No strong avoid signal'],
  },
};

/**
 * Strategy 6: High-Risk Momentum
 * 
 * Identifies speculative opportunities with higher risk.
 */
export const MOMENTUM_STRATEGY: StrategyDefinition = {
  id: 'high_risk_momentum_v1',
  name: 'High-Risk Momentum',
  description: 'Speculative opportunities with elevated risk',
  version: '1.0.0',
  networks: ['ethereum', 'bnb'],
  active: true,
  rules: [
    {
      id: 'strong_momentum',
      priority: 70,
      when: {
        quality: ['HIGH'],
        minBullishDrivers: 4,
      },
      then: {
        verdict: 'HIGH_RISK',
        risk: 'HIGH',
        horizon: 'SHORT',
        reasons: [
          'Strong bullish alignment across drivers',
          'Momentum conditions present',
          'Higher risk, shorter timeframe',
        ],
      },
    },
  ],
  defaultOutcome: {
    verdict: 'WAIT',
    risk: 'LOW',
    horizon: 'SHORT',
    reasons: ['Momentum conditions not met'],
  },
};

/**
 * All available strategies
 */
export const STRATEGY_CATALOG: StrategyDefinition[] = [
  AVOID_STRATEGY,         // Priority: Check avoid conditions first
  EXIT_STRATEGY,          // Then exit conditions
  ACCUMULATION_STRATEGY,  // Then accumulation
  LIQUIDITY_STRATEGY,     // Liquidity events
  ACTOR_STRATEGY,         // Actor-driven
  MOMENTUM_STRATEGY,      // High-risk last
];

/**
 * Get strategy by ID
 */
export function getStrategyById(id: string): StrategyDefinition | undefined {
  return STRATEGY_CATALOG.find(s => s.id === id);
}

/**
 * Get all active strategies
 */
export function getActiveStrategies(): StrategyDefinition[] {
  return STRATEGY_CATALOG.filter(s => s.active);
}

/**
 * Get strategies for network
 */
export function getStrategiesForNetwork(network: string): StrategyDefinition[] {
  return STRATEGY_CATALOG.filter(s => s.active && s.networks.includes(network));
}
