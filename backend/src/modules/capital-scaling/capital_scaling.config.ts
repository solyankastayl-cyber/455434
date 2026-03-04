/**
 * CAPITAL SCALING CONFIG — v2.3
 * 
 * Risk Budget Targeting Configuration
 * Adjustable via admin endpoints without redeploy
 */

export interface CapitalScalingConfig {
  // Base risk allocation (default 65%)
  baseRiskBudget: number;
  
  // Vol targeting
  targetVol: number;      // Target annualized volatility (12%)
  volClampMin: number;    // Minimum vol scale (0.80)
  volClampMax: number;    // Maximum vol scale (1.20)
  
  // Tail risk penalty
  tailPenaltyMax: number; // Max penalty for tail risk (25%)
  
  // Risk budget bounds
  minRiskBudget: number;  // Minimum risk allocation (10%)
  maxRiskBudget: number;  // Maximum risk allocation (80%)
  
  // Guard level caps
  guardCaps: {
    BLOCK: number;    // Max risk in BLOCK state (10%)
    CRISIS: number;   // Max risk in CRISIS state (25%)
  };
  
  // Delta limits
  maxDeltaNormal: number; // Max allocation delta in normal conditions (10%)
  maxDeltaCrisis: number; // Max allocation delta in crisis (15%)
}

export const CAPITAL_CONFIG: CapitalScalingConfig = {
  baseRiskBudget: 0.65,
  targetVol: 0.12,
  volClampMin: 0.80,
  volClampMax: 1.20,
  tailPenaltyMax: 0.25,
  minRiskBudget: 0.10,
  maxRiskBudget: 0.80,
  guardCaps: {
    BLOCK: 0.10,
    CRISIS: 0.25
  },
  maxDeltaNormal: 0.10,
  maxDeltaCrisis: 0.15
};

// Runtime config storage (can be updated via API)
let runtimeConfig: CapitalScalingConfig = { ...CAPITAL_CONFIG };

export function getCapitalConfig(): CapitalScalingConfig {
  return { ...runtimeConfig };
}

export function updateCapitalConfig(updates: Partial<CapitalScalingConfig>): CapitalScalingConfig {
  runtimeConfig = { ...runtimeConfig, ...updates };
  if (updates.guardCaps) {
    runtimeConfig.guardCaps = { ...runtimeConfig.guardCaps, ...updates.guardCaps };
  }
  return { ...runtimeConfig };
}

export function resetCapitalConfig(): CapitalScalingConfig {
  runtimeConfig = { ...CAPITAL_CONFIG };
  return { ...runtimeConfig };
}
