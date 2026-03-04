/**
 * Stress Simulation — Black Swan Library
 * 
 * Predefined stress scenario presets for institutional crash-testing.
 */

export interface BlackSwanPreset {
  name: string;
  description: string;
  overrides: {
    forceRegime?: string;
    forceCrossAsset?: string;
    forceTailRisk?: number;
    forceVolSpike?: number;
    forceLiquidityImpulse?: number;
    forceGuardLevel?: string;
    forceContagionScore?: number;
    forceCorrBtcSpx?: number;
    forceCorrDxySpx?: number;
    forceSpread?: number;
  };
}

export const BLACK_SWAN_LIBRARY: Record<string, BlackSwanPreset> = {
  COVID_CRASH: {
    name: 'COVID_CRASH',
    description: 'March 2020-style pandemic crash: extreme volatility, risk-off sync, liquidity freeze',
    overrides: {
      forceRegime: 'STRESS',
      forceCrossAsset: 'RISK_OFF_SYNC',
      forceTailRisk: 0.65,
      forceVolSpike: 0.8,
      forceLiquidityImpulse: -0.7,
    },
  },
  '2008_STYLE': {
    name: '2008_STYLE',
    description: 'GFC-style systemic crisis: extreme contagion, guard CRISIS, maximum tail risk',
    overrides: {
      forceRegime: 'STRESS',
      forceCrossAsset: 'RISK_OFF_SYNC',
      forceTailRisk: 0.8,
      forceGuardLevel: 'CRISIS',
      forceContagionScore: 0.9,
      forceCorrBtcSpx: 0.85,
    },
  },
  USD_SPIKE: {
    name: 'USD_SPIKE',
    description: 'Dollar spike: DXY up sharply, equities crash, strong inverse correlation',
    overrides: {
      forceRegime: 'TIGHTENING',
      forceCrossAsset: 'FLIGHT_TO_QUALITY',
      forceTailRisk: 0.45,
      forceCorrDxySpx: -0.7,
      forceVolSpike: 0.5,
    },
  },
  LIQUIDITY_FREEZE: {
    name: 'LIQUIDITY_FREEZE',
    description: 'Liquidity freeze: contraction, guard WARN, wide spreads, high uncertainty',
    overrides: {
      forceRegime: 'STRESS',
      forceCrossAsset: 'DECOUPLED',
      forceTailRisk: 0.50,
      forceLiquidityImpulse: -0.9,
      forceGuardLevel: 'WARN',
      forceSpread: 0.25,
      forceVolSpike: 0.6,
    },
  },
};

export function getPresetNames(): string[] {
  return Object.keys(BLACK_SWAN_LIBRARY);
}
