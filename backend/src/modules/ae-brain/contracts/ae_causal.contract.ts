/**
 * C3 — Causal Graph Contract
 * Rule-based causal links between macro factors
 */

export type CausalNode = 
  | 'Rates'
  | 'Inflation'
  | 'Liquidity'
  | 'CreditStress'
  | 'Activity'
  | 'USD'
  | 'SPX'
  | 'BTC';

export interface AeLink {
  from: CausalNode;
  to: CausalNode;
  impact: '+' | '-';        // Positive or negative influence
  strength: number;         // [0..1]
  reason: string;
}

export interface AeCausalGraph {
  links: AeLink[];
  timestamp: string;
}

// Base causal relationships (fixed graph structure)
export const BASE_CAUSAL_LINKS: Array<{
  from: CausalNode;
  to: CausalNode;
  impact: '+' | '-';
  baseWeight: number;
  reason: string;
}> = [
  { from: 'Rates', to: 'USD', impact: '+', baseWeight: 0.75, reason: 'Higher rates attract USD flows' },
  { from: 'Rates', to: 'SPX', impact: '-', baseWeight: 0.60, reason: 'Higher rates compress equity valuations' },
  { from: 'CreditStress', to: 'SPX', impact: '-', baseWeight: 0.80, reason: 'Credit stress reduces risk appetite' },
  { from: 'CreditStress', to: 'BTC', impact: '-', baseWeight: 0.70, reason: 'Stress triggers risk-off in crypto' },
  { from: 'Liquidity', to: 'SPX', impact: '+', baseWeight: 0.75, reason: 'Liquidity expansion supports equities' },
  { from: 'Liquidity', to: 'BTC', impact: '+', baseWeight: 0.80, reason: 'Liquidity expansion drives crypto' },
  { from: 'USD', to: 'BTC', impact: '-', baseWeight: 0.65, reason: 'Strong USD pressures BTC (inverse correlation)' },
  { from: 'USD', to: 'SPX', impact: '-', baseWeight: 0.50, reason: 'Strong USD headwind for multinationals' },
  { from: 'Inflation', to: 'Rates', impact: '+', baseWeight: 0.85, reason: 'Higher inflation leads to rate hikes' },
  { from: 'Activity', to: 'SPX', impact: '+', baseWeight: 0.65, reason: 'Strong activity supports earnings' },
];
