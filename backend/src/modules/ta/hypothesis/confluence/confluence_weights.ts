/**
 * Phase C: Confluence Weights
 * 
 * Total sum = 1.0 (normalized)
 * These can be tuned via calibration later
 */

export const CONFLUENCE_WEIGHTS = {
  geometry: 0.20,    // Pattern geometric quality
  touches: 0.10,     // Level/line touch strength
  regime: 0.15,      // Market structure alignment
  ma: 0.15,          // Moving average alignment
  fib: 0.10,         // Fibonacci confluence
  volatility: 0.10,  // Volatility gate
  agreement: 0.10,   // Signal confirmations
  rr: 0.10,          // Risk/Reward quality
} as const;

// Verify sum = 1.0
const sum = Object.values(CONFLUENCE_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(sum - 1.0) > 0.001) {
  console.warn(`[Confluence] Weights sum to ${sum}, expected 1.0`);
}

export type ConfluenceWeightKey = keyof typeof CONFLUENCE_WEIGHTS;
