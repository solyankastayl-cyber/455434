/**
 * P1.4 — Verdict Explainability Service
 * ======================================
 * 
 * Generates human-readable explanations for decisions.
 * Text does NOT influence logic — it REFLECTS backend state.
 * 
 * All text in English.
 */

import { ExplainBlock, VerdictExplainability, VerdictAttribution, LabSignal } from '../../contracts/lab-signal.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface VerdictContext {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  confidence: number;
  action: 'BUY' | 'SELL' | 'AVOID';
  macroContext: {
    regime: string;
    riskLevel: string;
    blocked: boolean;
    confidenceMultiplier: number;
    flags: string[];
  };
  attribution: VerdictAttribution;
  risks: string[];
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPLAINABILITY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function generateExplainability(ctx: VerdictContext): VerdictExplainability {
  return {
    decision: generateDecisionBlock(ctx),
    macroContext: generateMacroBlock(ctx),
    labsImpact: generateLabsBlock(ctx),
    risks: generateRisksBlock(ctx),
    confidence: generateConfidenceBlock(ctx),
  };
}

// ═══════════════════════════════════════════════════════════════
// DECISION BLOCK (WHY BUY / WHY NOT)
// ═══════════════════════════════════════════════════════════════

function generateDecisionBlock(ctx: VerdictContext): ExplainBlock {
  const { action, direction, strength, confidence } = ctx;
  
  if (action === 'BUY') {
    return {
      title: 'WHY BUY',
      summary: generateBuySummary(ctx),
      bullets: generateBuyBullets(ctx),
      tone: 'positive',
    };
  }
  
  if (action === 'SELL') {
    return {
      title: 'WHY SELL',
      summary: generateSellSummary(ctx),
      bullets: generateSellBullets(ctx),
      tone: 'negative',
    };
  }
  
  // AVOID
  return {
    title: 'WHY AVOID',
    summary: generateAvoidSummary(ctx),
    bullets: generateAvoidBullets(ctx),
    tone: 'warning',
  };
}

function generateBuySummary(ctx: VerdictContext): string {
  const { strength, attribution, macroContext } = ctx;
  
  if (strength === 'STRONG') {
    return 'Strong bullish signals detected with supporting market conditions.';
  }
  if (strength === 'MODERATE') {
    return 'Moderate bullish setup with acceptable risk profile.';
  }
  return 'Weak bullish signal, consider smaller position size.';
}

function generateBuyBullets(ctx: VerdictContext): string[] {
  const bullets: string[] = [];
  const { attribution, macroContext } = ctx;
  
  // Add supporting labs
  const topSupporting = attribution.supporting.slice(0, 3);
  for (const lab of topSupporting) {
    bullets.push(`${capitalizeFirst(lab.labId)} confirms: ${lab.context[0] || 'bullish signal'}`);
  }
  
  // Add macro context
  if (!macroContext.blocked) {
    bullets.push(`Macro regime (${formatRegime(macroContext.regime)}) allows aggressive actions`);
  }
  
  // Add confidence note
  if (ctx.confidence >= 0.7) {
    bullets.push('High confidence in current setup');
  }
  
  return bullets.slice(0, 4);
}

function generateSellSummary(ctx: VerdictContext): string {
  const { strength } = ctx;
  
  if (strength === 'STRONG') {
    return 'Strong bearish signals with distribution or stress indicators.';
  }
  if (strength === 'MODERATE') {
    return 'Moderate selling pressure detected.';
  }
  return 'Weak bearish signal, monitor for confirmation.';
}

function generateSellBullets(ctx: VerdictContext): string[] {
  const bullets: string[] = [];
  const { attribution, macroContext } = ctx;
  
  // Add supporting labs (for SELL, "supporting" means bearish)
  const topSupporting = attribution.supporting.slice(0, 3);
  for (const lab of topSupporting) {
    bullets.push(`${capitalizeFirst(lab.labId)}: ${lab.context[0] || 'bearish signal'}`);
  }
  
  // Add stress indicators
  if (macroContext.flags.includes('MACRO_PANIC')) {
    bullets.push('Market in panic mode — elevated selling pressure');
  }
  
  return bullets.slice(0, 4);
}

function generateAvoidSummary(ctx: VerdictContext): string {
  const { macroContext, attribution } = ctx;
  
  if (macroContext.blocked) {
    return `Macro regime (${formatRegime(macroContext.regime)}) blocks aggressive actions.`;
  }
  
  if (attribution.summary.opposingCount > attribution.summary.supportingCount) {
    return 'Conflicting signals — waiting for clarity.';
  }
  
  return 'Insufficient conviction for directional trade.';
}

function generateAvoidBullets(ctx: VerdictContext): string[] {
  const bullets: string[] = [];
  const { macroContext, attribution } = ctx;
  
  if (macroContext.blocked) {
    bullets.push(`Strong actions blocked in ${formatRegime(macroContext.regime)}`);
    bullets.push(`Confidence capped at ${Math.round(macroContext.confidenceMultiplier * 100)}%`);
  }
  
  if (attribution.summary.opposingCount > 0) {
    bullets.push(`${attribution.summary.opposingCount} labs show opposing signals`);
  }
  
  if (macroContext.flags.includes('EXTREME_FEAR')) {
    bullets.push('Extreme fear detected — risk-off environment');
  }
  
  if (macroContext.flags.includes('RISK_REVERSAL')) {
    bullets.push('Potential regime change in progress');
  }
  
  return bullets.slice(0, 4);
}

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT BLOCK
// ═══════════════════════════════════════════════════════════════

function generateMacroBlock(ctx: VerdictContext): ExplainBlock {
  const { macroContext } = ctx;
  
  const regime = formatRegime(macroContext.regime);
  const risk = macroContext.riskLevel.toLowerCase();
  
  let summary: string;
  let tone: ExplainBlock['tone'] = 'neutral';
  
  if (macroContext.blocked) {
    summary = `Market in ${regime}. Strong actions blocked until conditions improve.`;
    tone = 'warning';
  } else if (macroContext.riskLevel === 'LOW') {
    summary = `Market in ${regime}. Risk appetite is healthy.`;
    tone = 'positive';
  } else if (macroContext.riskLevel === 'EXTREME') {
    summary = `Market in ${regime}. Extreme caution advised.`;
    tone = 'negative';
  } else {
    summary = `Market in ${regime}. ${capitalizeFirst(risk)} risk environment.`;
  }
  
  const bullets: string[] = [];
  
  bullets.push(`Risk level: ${macroContext.riskLevel}`);
  bullets.push(`Confidence multiplier: ${Math.round(macroContext.confidenceMultiplier * 100)}%`);
  
  if (macroContext.flags.length > 0) {
    bullets.push(`Active flags: ${macroContext.flags.join(', ')}`);
  }
  
  return {
    title: 'MACRO CONTEXT',
    summary,
    bullets,
    tone,
  };
}

// ═══════════════════════════════════════════════════════════════
// LABS IMPACT BLOCK
// ═══════════════════════════════════════════════════════════════

function generateLabsBlock(ctx: VerdictContext): ExplainBlock {
  const { attribution } = ctx;
  const { supportingCount, opposingCount, neutralCount, confidenceAdjustment } = attribution.summary;
  
  let summary: string;
  let tone: ExplainBlock['tone'] = 'neutral';
  
  if (supportingCount > opposingCount * 2) {
    summary = 'Labs consensus strongly supports the decision.';
    tone = 'positive';
  } else if (opposingCount > supportingCount * 2) {
    summary = 'Labs show significant opposition to the move.';
    tone = 'negative';
  } else if (opposingCount > 0) {
    summary = 'Mixed signals from labs — proceed with caution.';
    tone = 'warning';
  } else {
    summary = 'Labs provide moderate support.';
  }
  
  const bullets: string[] = [];
  
  bullets.push(`${supportingCount} supporting, ${opposingCount} opposing, ${neutralCount} neutral`);
  
  if (confidenceAdjustment !== 0) {
    const adj = confidenceAdjustment > 0 ? `+${Math.round(confidenceAdjustment * 100)}%` : `${Math.round(confidenceAdjustment * 100)}%`;
    bullets.push(`Labs adjustment to confidence: ${adj}`);
  }
  
  // Top contributors
  const topLabs = [...attribution.supporting, ...attribution.opposing]
    .slice(0, 2)
    .map(l => l.labId);
  if (topLabs.length > 0) {
    bullets.push(`Key contributors: ${topLabs.join(', ')}`);
  }
  
  return {
    title: 'LABS ANALYSIS',
    summary,
    bullets,
    tone,
  };
}

// ═══════════════════════════════════════════════════════════════
// RISKS BLOCK
// ═══════════════════════════════════════════════════════════════

function generateRisksBlock(ctx: VerdictContext): ExplainBlock {
  const { risks, macroContext, attribution } = ctx;
  
  const allRisks = [...risks];
  
  // Add macro-derived risks
  if (macroContext.riskLevel === 'EXTREME') {
    allRisks.push('Extreme market conditions');
  }
  if (macroContext.flags.includes('MACRO_PANIC')) {
    allRisks.push('Panic selling in progress');
  }
  
  // Add lab-derived risks
  for (const lab of attribution.opposing) {
    if (lab.labId === 'liquidation' && lab.context.includes('CASCADE_RISK')) {
      allRisks.push('Liquidation cascade risk');
    }
    if (lab.labId === 'manipulation') {
      allRisks.push('Manipulation risk detected');
    }
  }
  
  if (allRisks.length === 0) {
    return {
      title: 'RISKS',
      summary: 'No significant risks identified.',
      bullets: ['Standard market risk applies'],
      tone: 'neutral',
    };
  }
  
  return {
    title: 'RISKS',
    summary: `${allRisks.length} risk factor${allRisks.length > 1 ? 's' : ''} identified.`,
    bullets: allRisks.slice(0, 4),
    tone: allRisks.length > 2 ? 'warning' : 'neutral',
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE BLOCK
// ═══════════════════════════════════════════════════════════════

function generateConfidenceBlock(ctx: VerdictContext): ExplainBlock {
  const { confidence, macroContext, attribution } = ctx;
  
  let summary: string;
  let tone: ExplainBlock['tone'] = 'neutral';
  
  if (confidence >= 0.7) {
    summary = 'High confidence in this analysis.';
    tone = 'positive';
  } else if (confidence >= 0.5) {
    summary = 'Moderate confidence — some uncertainty remains.';
  } else {
    summary = 'Low confidence — proceed with extreme caution.';
    tone = 'warning';
  }
  
  const bullets: string[] = [];
  
  bullets.push(`Final confidence: ${Math.round(confidence * 100)}%`);
  
  if (macroContext.confidenceMultiplier < 1) {
    bullets.push(`Macro reduced confidence by ${Math.round((1 - macroContext.confidenceMultiplier) * 100)}%`);
  }
  
  if (attribution.summary.confidenceAdjustment !== 0) {
    const adj = attribution.summary.confidenceAdjustment > 0 ? 'boosted' : 'reduced';
    bullets.push(`Labs ${adj} confidence by ${Math.abs(Math.round(attribution.summary.confidenceAdjustment * 100))}%`);
  }
  
  return {
    title: 'CONFIDENCE',
    summary,
    bullets,
    tone,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatRegime(regime: string): string {
  return regime.split('_').map(w => capitalizeFirst(w.toLowerCase())).join(' ');
}

console.log('[P1.4] Verdict Explainability Service loaded');
