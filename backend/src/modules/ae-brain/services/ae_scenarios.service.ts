/**
 * C4 — Scenario Engine Service
 * Generates 3 scenarios with probabilities using softmax
 */

import type { AeStateVector } from '../contracts/ae_state.contract.js';
import type { AeRegimeResult } from '../contracts/ae_regime.contract.js';
import type { AeScenario, AeScenarioPack, TiltDirection } from '../contracts/ae_scenarios.contract.js';
import { softmax, clamp } from '../utils/ae_math.js';

/**
 * Build scenarios based on state and regime
 * 
 * Score calculation:
 * - BASE: favors neutral state
 * - BULL_RISK_ON: favors low stress, dovish macro
 * - BEAR_STRESS: favors high stress, hawkish macro
 */
export function buildScenarios(
  state: AeStateVector,
  regime: AeRegimeResult
): AeScenarioPack {
  const { vector } = state;
  
  const g = vector.guardLevel;         // [0..1]
  const m = vector.macroSigned;        // [-1..1]
  const d = vector.dxySignalSigned;    // [-1..1]
  const c = vector.macroConfidence;    // [0..1]
  
  // Raw scenario scores
  const baseScore = 
    0.40 * (1 - g) +           // Lower stress = higher base prob
    0.30 * (1 - Math.abs(m)) + // Neutral macro = higher base prob
    0.30 * (1 - Math.abs(d));  // Neutral DXY = higher base prob
  
  const bullScore = 
    -0.60 * g +                // Low stress = bull
    -0.50 * m +                // Dovish macro = bull
    -0.30 * d +                // Weak USD = bull
    0.20 * (1 - c);            // Low confidence adds uncertainty
  
  const bearScore = 
    0.70 * g +                 // High stress = bear
    0.50 * m +                 // Hawkish macro = bear
    0.30 * d +                 // Strong USD = bear
    0.10 * c;                  // High confidence amplifies trend
  
  // Softmax for probabilities
  const probs = softmax([baseScore, bullScore, bearScore]);
  
  // Determine tilts
  const dxyTilt: TiltDirection = d > 0.15 ? 'UP' : d < -0.15 ? 'DOWN' : 'FLAT';
  const spxTiltBase: TiltDirection = g > 0.5 ? 'DOWN' : m > 0.15 ? 'DOWN' : 'FLAT';
  const btcTiltBase: TiltDirection = g > 0.5 ? 'DOWN' : d > 0.2 ? 'DOWN' : 'FLAT';
  
  // Volatility expectation
  const getVolatility = (prob: number, stress: number): 'LOW' | 'MEDIUM' | 'HIGH' => {
    if (stress > 0.66) return 'HIGH';
    if (stress > 0.33 || prob < 0.3) return 'MEDIUM';
    return 'LOW';
  };
  
  const scenarios: AeScenario[] = [
    {
      name: 'BASE',
      prob: Math.round(probs[0] * 1000) / 1000,
      tilt: {
        DXY: dxyTilt,
        SPX: spxTiltBase,
        BTC: btcTiltBase,
      },
      notes: buildBaseNotes(regime, vector),
      volatilityExpectation: getVolatility(probs[0], g),
    },
    {
      name: 'BULL_RISK_ON',
      prob: Math.round(probs[1] * 1000) / 1000,
      tilt: {
        DXY: 'DOWN',
        SPX: 'UP',
        BTC: 'UP',
      },
      notes: buildBullNotes(regime, vector),
      volatilityExpectation: 'MEDIUM',
    },
    {
      name: 'BEAR_STRESS',
      prob: Math.round(probs[2] * 1000) / 1000,
      tilt: {
        DXY: 'UP',
        SPX: 'DOWN',
        BTC: 'DOWN',
      },
      notes: buildBearNotes(regime, vector),
      volatilityExpectation: 'HIGH',
    },
  ];
  
  return {
    scenarios,
    timestamp: new Date().toISOString(),
  };
}

// Helper: Build BASE scenario notes
function buildBaseNotes(regime: AeRegimeResult, v: AeStateVector['vector']): string[] {
  const notes = ['Continuation of current trends'];
  if (Math.abs(v.macroSigned) < 0.15) {
    notes.push('Macro signals near neutral');
  }
  if (v.guardLevel < 0.33) {
    notes.push('Low stress supports stability');
  }
  return notes;
}

// Helper: Build BULL scenario notes
function buildBullNotes(regime: AeRegimeResult, v: AeStateVector['vector']): string[] {
  const notes = ['Risk appetite improves'];
  if (v.macroSigned < 0) {
    notes.push('Dovish macro supports risk');
  }
  if (v.guardLevel < 0.5) {
    notes.push('Stress normalization expected');
  }
  if (regime.regime === 'LIQUIDITY_EXPANSION') {
    notes.push('Liquidity regime supports rally');
  }
  return notes;
}

// Helper: Build BEAR scenario notes
function buildBearNotes(regime: AeRegimeResult, v: AeStateVector['vector']): string[] {
  const notes = ['Risk-off escalation'];
  if (v.guardLevel > 0.5) {
    notes.push('Elevated stress persists');
  }
  if (v.macroSigned > 0.2) {
    notes.push('Tightening continues');
  }
  if (regime.regime === 'RISK_OFF_STRESS') {
    notes.push('Crisis conditions dominate');
  }
  return notes;
}
