/**
 * C3 — Causal Graph Service
 * Builds rule-based causal links with dynamic weights
 */

import type { AeStateVector } from '../contracts/ae_state.contract.js';
import type { AeCausalGraph, AeLink } from '../contracts/ae_causal.contract.js';
import { BASE_CAUSAL_LINKS } from '../contracts/ae_causal.contract.js';
import { clamp } from '../utils/ae_math.js';

/**
 * Build causal graph with dynamic weights based on state
 * 
 * Weight calculation:
 * - baseWeight: fixed relationship strength
 * - guardMultiplier: stress amplifies stress-related links
 * - confidenceMultiplier: higher macro confidence = stronger links
 */
export function buildCausalGraph(state: AeStateVector): AeCausalGraph {
  const { vector } = state;
  
  // Multipliers based on current state
  const guardMultiplier = 1 + 0.3 * vector.guardLevel;  // 1.0 - 1.3
  const confidenceMultiplier = 0.7 + 0.3 * vector.macroConfidence;  // 0.7 - 1.0
  
  const links: AeLink[] = BASE_CAUSAL_LINKS.map(link => {
    let strength = link.baseWeight;
    
    // Amplify stress-related links when guard is elevated
    if (link.from === 'CreditStress' || link.to === 'BTC' || link.to === 'SPX') {
      strength *= guardMultiplier;
    }
    
    // Apply confidence multiplier
    strength *= confidenceMultiplier;
    
    // Clamp to [0..1]
    strength = clamp(strength, 0, 1);
    
    // Round for cleaner output
    strength = Math.round(strength * 100) / 100;
    
    return {
      from: link.from,
      to: link.to,
      impact: link.impact,
      strength,
      reason: link.reason,
    };
  });
  
  return {
    links,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get key causal drivers based on current state
 */
export function getKeyDrivers(graph: AeCausalGraph, limit: number = 3): string[] {
  // Sort by strength descending
  const sorted = [...graph.links].sort((a, b) => b.strength - a.strength);
  
  return sorted.slice(0, limit).map(link => 
    `${link.from} ${link.impact === '+' ? '->' : '-|'} ${link.to}`
  );
}
