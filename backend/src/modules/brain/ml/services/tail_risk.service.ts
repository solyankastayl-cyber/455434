/**
 * P8.0-B2 — Tail Risk Service
 * 
 * Derives tailRisk from quantiles per horizon.
 * 
 * tailRisk = clamp01( (q50 - q05) / riskBand[h] )
 */

import { Horizon } from '../contracts/quantile_forecast.contract.js';

// Risk bands per horizon (how much downside spread is "normal")
const RISK_BAND: Record<Horizon, number> = {
  '30D': 0.04,
  '90D': 0.08,
  '180D': 0.12,
  '365D': 0.18,
};

/**
 * Compute tail risk from quantile spread
 */
export function computeTailRiskFromQuantiles(
  q05: number,
  q50: number,
  horizon: Horizon
): number {
  const spread = q50 - q05;
  const band = RISK_BAND[horizon];
  return Math.max(0, Math.min(1, spread / band));
}

/**
 * Get risk band for horizon
 */
export function getRiskBand(horizon: Horizon): number {
  return RISK_BAND[horizon];
}
