/**
 * Macro Signal Service
 * 
 * Generates MacroSignal from MacroSnapshot using deterministic rules.
 * 
 * RULES (v1.0 LOCKED):
 * ❌ Macro НЕ решает BUY/SELL
 * ❌ Macro НЕ повышает confidence
 * ❌ Macro НЕ зависит от ML
 * ✅ Только контекст
 * ✅ Только фильтр
 * ✅ Только explainability
 */

import {
  MacroSnapshot,
  MacroSignal,
  MacroFlag,
  MacroImpact,
  FEAR_GREED_RULES,
  MACRO_THRESHOLDS,
} from '../contracts/macro.types.js';
import { getMacroSnapshot } from './macro.snapshot.service.js';

function generateFlags(snapshot: MacroSnapshot): MacroFlag[] {
  const flags: MacroFlag[] = [];
  
  // Check data quality first
  if (snapshot.quality.mode === 'NO_DATA') {
    return ['MACRO_NO_DATA'];
  }
  
  const { fearGreed, dominance, rsi } = snapshot;
  
  // 1. Fear & Greed flags (from rule table)
  const fgRule = FEAR_GREED_RULES[fearGreed.label];
  if (fgRule) {
    flags.push(...fgRule.flags);
  }
  
  // 2. BTC Dominance flags
  if (dominance.btcDelta24h !== undefined) {
    if (dominance.btcDelta24h > MACRO_THRESHOLDS.BTC_DOM_DELTA_THRESHOLD) {
      flags.push('BTC_DOM_UP');
    } else if (dominance.btcDelta24h < -MACRO_THRESHOLDS.BTC_DOM_DELTA_THRESHOLD) {
      flags.push('BTC_DOM_DOWN');
    }
  }
  
  // BTC Dominance RSI flags
  if (rsi.btcDomRsi14 !== undefined) {
    if (rsi.btcDomRsi14 > MACRO_THRESHOLDS.RSI_OVERBOUGHT) {
      flags.push('BTC_DOM_OVERBOUGHT');
    } else if (rsi.btcDomRsi14 < MACRO_THRESHOLDS.RSI_OVERSOLD) {
      flags.push('BTC_DOM_OVERSOLD');
    }
  }
  
  // 3. Stablecoin Dominance flags
  if (dominance.stableDelta24h !== undefined) {
    if (dominance.stableDelta24h > MACRO_THRESHOLDS.STABLE_DOM_DELTA_THRESHOLD) {
      flags.push('STABLE_INFLOW');
    } else if (dominance.stableDelta24h < -MACRO_THRESHOLDS.STABLE_DOM_DELTA_THRESHOLD) {
      flags.push('STABLE_OUTFLOW');
    }
  }
  
  // Stablecoin Dominance RSI flags
  if (rsi.stableDomRsi14 !== undefined) {
    if (rsi.stableDomRsi14 > MACRO_THRESHOLDS.RSI_OVERBOUGHT) {
      flags.push('STABLE_OVERBOUGHT');
    } else if (rsi.stableDomRsi14 < MACRO_THRESHOLDS.RSI_OVERSOLD) {
      flags.push('STABLE_OVERSOLD');
    }
  }
  
  // 4. Risk reversal detection
  // When fear/greed and dominance signals conflict, potential reversal
  const hasRiskOn = flags.includes('MACRO_RISK_ON') || flags.includes('MACRO_EUPHORIA');
  const hasRiskOff = flags.includes('MACRO_RISK_OFF') || flags.includes('MACRO_PANIC');
  const btcRising = flags.includes('BTC_DOM_UP');
  const stableInflow = flags.includes('STABLE_INFLOW');
  
  if ((hasRiskOn && (btcRising || stableInflow)) || 
      (hasRiskOff && !btcRising && !stableInflow)) {
    flags.push('RISK_REVERSAL');
  }
  
  return [...new Set(flags)]; // Remove duplicates
}

function calculateScores(snapshot: MacroSnapshot, flags: MacroFlag[]): {
  riskOffScore: number;
  riskOnScore: number;
  confidencePenalty: number;
} {
  // Start with Fear & Greed base scores
  const fgRule = FEAR_GREED_RULES[snapshot.fearGreed.label];
  let riskOffScore = fgRule?.riskOffScore || 0.3;
  let riskOnScore = fgRule?.riskOnScore || 0.3;
  let confidencePenalty = fgRule?.confidencePenalty || 0.95;
  
  // Adjust for BTC dominance
  if (flags.includes('BTC_DOM_UP')) {
    riskOffScore += 0.1;
    riskOnScore -= 0.05;
  } else if (flags.includes('BTC_DOM_DOWN')) {
    riskOnScore += 0.1;
    riskOffScore -= 0.05;
  }
  
  // Adjust for stablecoin flows
  if (flags.includes('STABLE_INFLOW')) {
    riskOffScore += 0.15;
    confidencePenalty *= 0.95;
  } else if (flags.includes('STABLE_OUTFLOW')) {
    riskOnScore += 0.1;
  }
  
  // RSI extremes add uncertainty
  if (flags.includes('BTC_DOM_OVERBOUGHT') || flags.includes('STABLE_OVERBOUGHT')) {
    confidencePenalty *= 0.95;
  }
  if (flags.includes('BTC_DOM_OVERSOLD') || flags.includes('STABLE_OVERSOLD')) {
    confidencePenalty *= 0.95;
  }
  
  // Risk reversal adds uncertainty
  if (flags.includes('RISK_REVERSAL')) {
    confidencePenalty *= 0.90;
  }
  
  // No data = maximum penalty
  if (flags.includes('MACRO_NO_DATA')) {
    confidencePenalty = 0.80;
  }
  
  // Clamp values
  return {
    riskOffScore: Math.max(0, Math.min(1, riskOffScore)),
    riskOnScore: Math.max(0, Math.min(1, riskOnScore)),
    confidencePenalty: Math.max(
      MACRO_THRESHOLDS.CONFIDENCE_MIN,
      Math.min(MACRO_THRESHOLDS.CONFIDENCE_MAX, confidencePenalty)
    ),
  };
}

function generateExplanation(snapshot: MacroSnapshot, flags: MacroFlag[]): {
  summary: string;
  bullets: string[];
} {
  const bullets: string[] = [];
  
  // Fear & Greed explanation
  const fgLabel = snapshot.fearGreed.label;
  const fgValue = snapshot.fearGreed.value;
  bullets.push(`Fear & Greed: ${fgValue} (${fgLabel.replace('_', ' ')})`);
  
  // BTC Dominance
  const btcPct = snapshot.dominance.btcPct.toFixed(1);
  const btcDelta = snapshot.dominance.btcDelta24h;
  if (btcDelta !== undefined) {
    const direction = btcDelta > 0 ? '+' : '';
    bullets.push(`BTC Dominance: ${btcPct}% (${direction}${btcDelta.toFixed(2)}% 24h)`);
  } else {
    bullets.push(`BTC Dominance: ${btcPct}%`);
  }
  
  // Stablecoin Dominance
  const stablePct = snapshot.dominance.stablePct.toFixed(1);
  const stableDelta = snapshot.dominance.stableDelta24h;
  if (stableDelta !== undefined) {
    const direction = stableDelta > 0 ? '+' : '';
    bullets.push(`Stablecoin Dominance: ${stablePct}% (${direction}${stableDelta.toFixed(2)}% 24h)`);
  } else {
    bullets.push(`Stablecoin Dominance: ${stablePct}%`);
  }
  
  // RSI if available
  if (snapshot.rsi.btcDomRsi14 !== undefined) {
    bullets.push(`BTC Dom RSI(14): ${snapshot.rsi.btcDomRsi14.toFixed(1)}`);
  }
  
  // Active flags
  const activeFlags = flags.filter(f => f !== 'MACRO_NO_DATA');
  if (activeFlags.length > 0) {
    bullets.push(`Active signals: ${activeFlags.join(', ')}`);
  }
  
  // Generate summary
  let summary: string;
  if (flags.includes('MACRO_PANIC')) {
    summary = 'Market in extreme fear. Risk-off environment. Confidence penalties applied.';
  } else if (flags.includes('MACRO_EUPHORIA')) {
    summary = 'Market in extreme greed. Elevated risk of correction. Confidence reduced.';
  } else if (flags.includes('MACRO_RISK_OFF')) {
    summary = 'Risk-off environment. Caution advised. Moderate confidence penalty.';
  } else if (flags.includes('MACRO_RISK_ON')) {
    summary = 'Risk-on environment. Market favorable for exposure.';
  } else if (flags.includes('RISK_REVERSAL')) {
    summary = 'Mixed signals suggest potential regime change. Increased uncertainty.';
  } else if (flags.includes('MACRO_NO_DATA')) {
    summary = 'Macro data unavailable. Operating with reduced confidence.';
  } else {
    summary = 'Neutral macro environment. No significant bias detected.';
  }
  
  return { summary, bullets };
}

export async function getMacroSignal(forceRefresh = false): Promise<MacroSignal> {
  const snapshot = await getMacroSnapshot(forceRefresh);
  const flags = generateFlags(snapshot);
  const scores = calculateScores(snapshot, flags);
  const explain = generateExplanation(snapshot, flags);
  
  const signal: MacroSignal = {
    ts: Date.now(),
    flags,
    scores,
    explain,
  };
  
  console.log(`[MacroSignal] Generated: flags=[${flags.join(',')}], penalty=${scores.confidencePenalty.toFixed(2)}`);
  
  return signal;
}

/**
 * Calculate macro impact for Meta-Brain integration
 */
export function calculateMacroImpact(signal: MacroSignal): MacroImpact {
  const addedRiskFlags: string[] = [];
  
  // Map macro flags to risk flags
  if (signal.flags.includes('MACRO_PANIC')) {
    addedRiskFlags.push('MACRO_PANIC');
  }
  if (signal.flags.includes('MACRO_EUPHORIA')) {
    addedRiskFlags.push('MACRO_EUPHORIA');
  }
  if (signal.flags.includes('STABLE_INFLOW')) {
    addedRiskFlags.push('STABLE_INFLOW');
  }
  if (signal.flags.includes('RISK_REVERSAL')) {
    addedRiskFlags.push('RISK_REVERSAL');
  }
  
  // Block STRONG actions during extreme sentiment
  const blockedStrong = signal.flags.includes('MACRO_PANIC') || 
                        signal.flags.includes('MACRO_EUPHORIA');
  
  // Determine reason
  let reason: string;
  if (blockedStrong) {
    reason = 'Extreme macro sentiment blocks STRONG actions';
  } else if (signal.scores.confidencePenalty < 0.9) {
    reason = `Confidence reduced by ${((1 - signal.scores.confidencePenalty) * 100).toFixed(0)}% due to macro context`;
  } else {
    reason = 'Macro context neutral, minimal impact';
  }
  
  return {
    ts: Date.now(),
    applied: signal.scores.confidencePenalty < 1.0 || addedRiskFlags.length > 0,
    confidenceMultiplier: signal.scores.confidencePenalty,
    addedRiskFlags,
    blockedStrong,
    reason,
  };
}
