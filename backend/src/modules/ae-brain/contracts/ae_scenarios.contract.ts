/**
 * C4 — Scenario Engine Contract
 * Three scenarios with probabilities and tilts
 */

export type ScenarioName = 'BASE' | 'BULL_RISK_ON' | 'BEAR_STRESS';

export type TiltDirection = 'UP' | 'DOWN' | 'FLAT';

export interface AeScenario {
  name: ScenarioName;
  prob: number;             // [0..1], sum of all = 1
  tilt: {
    DXY: TiltDirection;
    SPX: TiltDirection;
    BTC: TiltDirection;
  };
  notes: string[];
  volatilityExpectation: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface AeScenarioPack {
  scenarios: AeScenario[];
  timestamp: string;
}

// Scenario descriptions
export const SCENARIO_DESCRIPTIONS: Record<ScenarioName, string> = {
  'BASE': 'Neutral continuation of current trends',
  'BULL_RISK_ON': 'Liquidity improvement, risk assets rally',
  'BEAR_STRESS': 'Stress escalation, risk-off environment',
};
