/**
 * BLOCK 55 — Strategy Engine v2 (with Presets)
 * 
 * GET /api/fractal/v2.1/strategy?symbol=BTC&preset=balanced
 * GET /api/fractal/v2.1/strategy/presets
 * 
 * Presets: conservative, balanced, aggressive
 * Each preset has different thresholds, sizing, and rules
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

// ═══════════════════════════════════════════════════════════════
// PRESET DEFINITIONS
// ═══════════════════════════════════════════════════════════════

type StrategyPresetKey = 'conservative' | 'balanced' | 'aggressive';

interface StrategyPreset {
  key: StrategyPresetKey;
  label: string;
  description: string;
  
  thresholds: {
    minConfidence: number;
    minReliability: number;
    maxEntropy: number;
    minStability: number;
    maxTailP95DD: number;
  };
  
  sizing: {
    baseRisk: number;
    maxSize: number;
    sizeMultiplierCap: number;
  };
  
  rules: {
    requireStrongEdge: boolean;
    allowWeakEdge: boolean;
    blockIfHighEntropy: boolean;
    blockIfLowConfidence: boolean;
  };
}

const STRATEGY_PRESETS: Record<StrategyPresetKey, StrategyPreset> = {
  conservative: {
    key: 'conservative',
    label: 'Conservative',
    description: 'High confidence required, minimal risk exposure',
    thresholds: {
      minConfidence: 0.10,
      minReliability: 0.75,
      maxEntropy: 0.40,
      minStability: 0.75,
      maxTailP95DD: 0.45,
    },
    sizing: {
      baseRisk: 0.6,
      maxSize: 0.6,
      sizeMultiplierCap: 0.5,
    },
    rules: {
      requireStrongEdge: true,
      allowWeakEdge: false,
      blockIfHighEntropy: true,
      blockIfLowConfidence: true,
    },
  },
  
  balanced: {
    key: 'balanced',
    label: 'Balanced',
    description: 'Moderate thresholds, balanced risk/reward',
    thresholds: {
      minConfidence: 0.05,
      minReliability: 0.60,
      maxEntropy: 0.60,
      minStability: 0.65,
      maxTailP95DD: 0.55,
    },
    sizing: {
      baseRisk: 0.8,
      maxSize: 0.8,
      sizeMultiplierCap: 0.75,
    },
    rules: {
      requireStrongEdge: false,
      allowWeakEdge: false,
      blockIfHighEntropy: true,
      blockIfLowConfidence: true,
    },
  },
  
  aggressive: {
    key: 'aggressive',
    label: 'Aggressive',
    description: 'Lower thresholds, higher risk tolerance',
    thresholds: {
      minConfidence: 0.02,
      minReliability: 0.50,
      maxEntropy: 0.80,
      minStability: 0.55,
      maxTailP95DD: 0.65,
    },
    sizing: {
      baseRisk: 1.0,
      maxSize: 1.0,
      sizeMultiplierCap: 1.0,
    },
    rules: {
      requireStrongEdge: false,
      allowWeakEdge: true,
      blockIfHighEntropy: false,
      blockIfLowConfidence: true,
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface StrategyInputs {
  confidence: number;
  reliability: number;
  entropy: number;
  expectedReturn30d: number;
  maxDD_WF: number;
  mcP95_DD: number;
  regime: string;
  stability: number;
}

interface DiagnosticItem {
  value: number;
  status: 'ok' | 'warn' | 'block';
  threshold: number;
}

// ═══════════════════════════════════════════════════════════════
// POLICY APPLICATION
// ═══════════════════════════════════════════════════════════════

function applyPresetPolicy(
  inputs: StrategyInputs,
  preset: StrategyPreset
): {
  allowTrade: boolean;
  blockers: string[];
  mode: 'NO_TRADE' | 'MICRO' | 'PARTIAL' | 'FULL';
  adjustedSize: number;
  reason: string;
} {
  const { thresholds, sizing, rules } = preset;
  const blockers: string[] = [];

  // Check confidence
  if (rules.blockIfLowConfidence && inputs.confidence < thresholds.minConfidence) {
    blockers.push('LOW_CONFIDENCE');
  }

  // Check entropy
  if (rules.blockIfHighEntropy && inputs.entropy > thresholds.maxEntropy) {
    blockers.push('HIGH_ENTROPY');
  }

  // Check reliability
  if (inputs.reliability < thresholds.minReliability) {
    blockers.push('LOW_RELIABILITY');
  }

  // Check stability
  if (inputs.stability < thresholds.minStability) {
    blockers.push('LOW_STABILITY');
  }

  // Check tail risk
  if (inputs.mcP95_DD > thresholds.maxTailP95DD) {
    blockers.push('HIGH_TAIL_RISK');
  }

  const allowTrade = blockers.length === 0;

  // Determine mode based on confidence levels (relative to preset thresholds)
  let mode: 'NO_TRADE' | 'MICRO' | 'PARTIAL' | 'FULL' = 'NO_TRADE';
  let reason = '';

  if (!allowTrade) {
    mode = 'NO_TRADE';
    reason = `Blocked: ${blockers.join(', ')}`;
  } else if (inputs.confidence >= thresholds.minConfidence * 3) {
    mode = 'FULL';
    reason = 'Strong confidence relative to threshold';
  } else if (inputs.confidence >= thresholds.minConfidence * 2) {
    mode = 'PARTIAL';
    reason = 'Moderate confidence';
  } else {
    mode = 'MICRO';
    reason = 'Meets minimum threshold only';
  }

  // Calculate adjusted size
  const rawSize = inputs.confidence * inputs.reliability * (1 - inputs.entropy) * 3;
  const adjustedSize = allowTrade
    ? Math.min(rawSize * sizing.baseRisk, sizing.maxSize, sizing.sizeMultiplierCap)
    : 0;

  return { allowTrade, blockers, mode, adjustedSize, reason };
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY COMPUTATION
// ═══════════════════════════════════════════════════════════════

function computeStrategy(
  symbol: string,
  inputs: StrategyInputs,
  preset: StrategyPreset
) {
  const { thresholds } = preset;

  // Risk/Reward
  const risk = Math.abs(inputs.maxDD_WF);
  const reward = inputs.expectedReturn30d;
  const riskReward = risk > 0 ? reward / risk : 0;

  // Edge Score (0-100)
  const rrNormalized = Math.min(riskReward / 3, 1);
  const edgeScore = Math.round(
    (0.4 * Math.min(inputs.confidence * 10, 1) +
     0.2 * inputs.reliability +
     0.2 * (1 - inputs.entropy) +
     0.2 * rrNormalized) * 100
  );

  // Edge Grade
  let edgeGrade: 'WEAK' | 'NEUTRAL' | 'STRONG' | 'INSTITUTIONAL' = 'WEAK';
  if (edgeScore >= 80) edgeGrade = 'INSTITUTIONAL';
  else if (edgeScore >= 60) edgeGrade = 'STRONG';
  else if (edgeScore >= 30) edgeGrade = 'NEUTRAL';

  // Apply preset policy
  const policy = applyPresetPolicy(inputs, preset);

  // Statistical edge check (relative to preset)
  const hasStatisticalEdge =
    inputs.confidence >= thresholds.minConfidence &&
    inputs.entropy <= thresholds.maxEntropy &&
    inputs.expectedReturn30d > 0 &&
    riskReward >= 0.5;

  // Diagnostics with preset-aware thresholds
  const diagnostics = {
    confidence: {
      value: inputs.confidence,
      status: inputs.confidence >= thresholds.minConfidence * 2 ? 'ok' as const :
              inputs.confidence >= thresholds.minConfidence ? 'warn' as const : 'block' as const,
      threshold: thresholds.minConfidence
    },
    reliability: {
      value: inputs.reliability,
      status: inputs.reliability >= thresholds.minReliability ? 'ok' as const :
              inputs.reliability >= thresholds.minReliability * 0.8 ? 'warn' as const : 'block' as const,
      threshold: thresholds.minReliability
    },
    entropy: {
      value: inputs.entropy,
      status: inputs.entropy <= thresholds.maxEntropy ? 'ok' as const :
              inputs.entropy <= thresholds.maxEntropy * 1.2 ? 'warn' as const : 'block' as const,
      threshold: thresholds.maxEntropy
    },
    stability: {
      value: inputs.stability,
      status: inputs.stability >= thresholds.minStability ? 'ok' as const :
              inputs.stability >= thresholds.minStability * 0.8 ? 'warn' as const : 'block' as const,
      threshold: thresholds.minStability
    }
  };

  return {
    symbol,
    asOf: new Date().toISOString(),
    regime: inputs.regime,
    
    preset: preset.key,
    appliedPreset: preset,

    decision: {
      mode: policy.mode,
      positionSize: Number(policy.adjustedSize.toFixed(3)),
      softStop: -inputs.maxDD_WF,
      tailRisk: -inputs.mcP95_DD,
      expectedReturn: inputs.expectedReturn30d,
      riskReward: Number(riskReward.toFixed(2)),
      reason: policy.reason,
      blockers: policy.blockers
    },

    edge: {
      score: edgeScore,
      grade: edgeGrade,
      hasStatisticalEdge
    },

    diagnostics,
    inputs
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function fractalStrategyRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/strategy/presets
   * Returns list of available strategy presets
   */
  fastify.get('/api/fractal/v2.1/strategy/presets', async () => {
    return {
      presets: Object.values(STRATEGY_PRESETS),
      default: 'balanced'
    };
  });

  /**
   * GET /api/fractal/v2.1/strategy
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   preset: 'conservative' | 'balanced' | 'aggressive' (default: balanced)
   */
  fastify.get('/api/fractal/v2.1/strategy', async (
    request: FastifyRequest<{ 
      Querystring: { symbol?: string; preset?: string } 
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const presetKey = (request.query.preset as StrategyPresetKey) || 'balanced';
    
    // Validate preset
    const preset = STRATEGY_PRESETS[presetKey] || STRATEGY_PRESETS.balanced;
    
    // Fetch signal data for inputs
    let signalData: any = null;
    try {
      const signalUrl = `http://localhost:8002/api/fractal/v2.1/signal?symbol=${symbol}`;
      const response = await fetch(signalUrl);
      if (response.ok) {
        signalData = await response.json();
      }
    } catch (err) {
      console.error('[Strategy] Failed to fetch signal:', err);
    }

    // Extract inputs from signal
    const inputs: StrategyInputs = {
      confidence: signalData?.assembled?.confidence ?? 0.01,
      reliability: signalData?.reliability?.score ?? 0.75,
      entropy: signalData?.assembled?.entropy ?? 0.98,
      expectedReturn30d: signalData?.signalsByHorizon?.['30d']?.expectedReturn ?? 0,
      maxDD_WF: signalData?.risk?.maxDD_WF ?? 0.08,
      mcP95_DD: signalData?.risk?.mcP95_DD ?? 0.5,
      regime: signalData?.meta?.phase ?? 'UNKNOWN',
      stability: 0.89 // TODO: Calculate from actual data
    };

    return computeStrategy(symbol, inputs, preset);
  });
}
