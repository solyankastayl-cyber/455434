/**
 * BLOCK 34.1: Experiment Profiles
 * A/B test configurations for simulation
 */

export type SimExperiment =
  | 'E0'      // Baseline (current settings)
  | 'R1'      // Risk: hard DD 18%
  | 'R2'      // Risk: per-regime DD
  | 'R3'      // Risk: early taper (soft DD 8%, hard DD 18%)
  | 'D1'      // Drift: recentN=180
  | 'D2'      // Drift: CRITICAL requires 2 confirmations
  | 'D3'      // Drift: rollback cooldown 30 days
  | 'A1'      // Autolearn: retrain only after 3x DEGRADED
  | 'A2'      // Autolearn: retrain budget 1/30 days
  | 'A3'      // Autolearn: auto-window stability check
  | 'H1'      // Horizon: adaptive ON
  | 'H2'      // Horizon: fixed 30
  | 'H3'      // Horizon: hysteresis 14 days
  | 'D3_R3'   // Combo: D3 + R3
  | 'D3_H3'   // Combo: D3 + H3
  | 'R3_H3'   // Combo: R3 + H3
  | 'D3_R3_H3'; // Combo: all three

export interface ExperimentOverrides {
  dd: {
    soft: number;
    hard: number;
    perRegime?: {
      crash: number;
      sideways: number;
      trend: number;
    };
  };
  drift: {
    recentN: number;
    rollbackCooldownDays: number;
    criticalConfirmations: number;
  };
  horizon: {
    adaptive: boolean;
    fixed: number;
    hysteresisDays: number;
  };
  autolearn: {
    degradedThreshold: number;  // times DEGRADED before retrain
    minRetrainIntervalDays: number;
    windowStabilityCheck: boolean;
  };
}

const BASE_OVERRIDES: ExperimentOverrides = {
  dd: { soft: 0.12, hard: 0.25 },
  drift: { recentN: 90, rollbackCooldownDays: 0, criticalConfirmations: 1 },
  horizon: { adaptive: true, fixed: 30, hysteresisDays: 0 },
  autolearn: { degradedThreshold: 1, minRetrainIntervalDays: 0, windowStabilityCheck: false }
};

export function getExperimentOverrides(exp: SimExperiment): ExperimentOverrides {
  // Deep clone base
  const base = JSON.parse(JSON.stringify(BASE_OVERRIDES)) as ExperimentOverrides;

  switch (exp) {
    // Risk experiments
    case 'R1':
      return { ...base, dd: { soft: 0.10, hard: 0.18 } };

    case 'R2':
      return {
        ...base,
        dd: {
          soft: 0.12,
          hard: 0.25,
          perRegime: { crash: 0.12, sideways: 0.15, trend: 0.25 }
        }
      };

    case 'R3':
      return { ...base, dd: { soft: 0.08, hard: 0.18 } };

    // Drift experiments
    case 'D1':
      return {
        ...base,
        drift: { recentN: 180, rollbackCooldownDays: 0, criticalConfirmations: 1 }
      };

    case 'D2':
      return {
        ...base,
        drift: { recentN: 90, rollbackCooldownDays: 0, criticalConfirmations: 2 }
      };

    case 'D3':
      return {
        ...base,
        drift: { recentN: 180, rollbackCooldownDays: 30, criticalConfirmations: 1 }
      };

    // Autolearn experiments
    case 'A1':
      return {
        ...base,
        autolearn: { degradedThreshold: 3, minRetrainIntervalDays: 0, windowStabilityCheck: false }
      };

    case 'A2':
      return {
        ...base,
        autolearn: { degradedThreshold: 1, minRetrainIntervalDays: 30, windowStabilityCheck: false }
      };

    case 'A3':
      return {
        ...base,
        autolearn: { degradedThreshold: 1, minRetrainIntervalDays: 0, windowStabilityCheck: true }
      };

    // Horizon experiments
    case 'H1':
      return {
        ...base,
        horizon: { adaptive: true, fixed: 30, hysteresisDays: 0 }
      };

    case 'H2':
      return {
        ...base,
        horizon: { adaptive: false, fixed: 30, hysteresisDays: 0 }
      };

    case 'H3':
      return {
        ...base,
        horizon: { adaptive: true, fixed: 30, hysteresisDays: 14 }
      };

    // Combos
    case 'D3_R3':
      return {
        dd: { soft: 0.08, hard: 0.18 },
        drift: { recentN: 180, rollbackCooldownDays: 30, criticalConfirmations: 1 },
        horizon: base.horizon,
        autolearn: base.autolearn
      };

    case 'D3_H3':
      return {
        dd: base.dd,
        drift: { recentN: 180, rollbackCooldownDays: 30, criticalConfirmations: 1 },
        horizon: { adaptive: true, fixed: 30, hysteresisDays: 14 },
        autolearn: base.autolearn
      };

    case 'R3_H3':
      return {
        dd: { soft: 0.08, hard: 0.18 },
        drift: base.drift,
        horizon: { adaptive: true, fixed: 30, hysteresisDays: 14 },
        autolearn: base.autolearn
      };

    case 'D3_R3_H3':
      return {
        dd: { soft: 0.08, hard: 0.18 },
        drift: { recentN: 180, rollbackCooldownDays: 30, criticalConfirmations: 1 },
        horizon: { adaptive: true, fixed: 30, hysteresisDays: 14 },
        autolearn: { degradedThreshold: 1, minRetrainIntervalDays: 0, windowStabilityCheck: false }
      };

    // E0 = baseline
    case 'E0':
    default:
      return base;
  }
}

export function getExperimentDescription(exp: SimExperiment): string {
  const descriptions: Record<SimExperiment, string> = {
    'E0': 'Baseline - current production settings',
    'R1': 'Risk: tighter hard DD (18%)',
    'R2': 'Risk: per-regime DD limits',
    'R3': 'Risk: early taper (soft 8%, hard 18%)',
    'D1': 'Drift: longer baseline (recentN=180)',
    'D2': 'Drift: require 2x CRITICAL confirmation',
    'D3': 'Drift: 30-day rollback cooldown',
    'A1': 'Autolearn: retrain only after 3x DEGRADED',
    'A2': 'Autolearn: max 1 retrain per 30 days',
    'A3': 'Autolearn: window stability check',
    'H1': 'Horizon: adaptive enabled',
    'H2': 'Horizon: fixed 30 days',
    'H3': 'Horizon: 14-day hysteresis',
    'D3_R3': 'Combo: drift cooldown + early taper',
    'D3_H3': 'Combo: drift cooldown + horizon hysteresis',
    'R3_H3': 'Combo: early taper + horizon hysteresis',
    'D3_R3_H3': 'Full combo: D3 + R3 + H3'
  };
  return descriptions[exp] || 'Unknown experiment';
}
