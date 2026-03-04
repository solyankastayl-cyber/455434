/**
 * C3.3 — Decision Engine
 * =======================
 * 
 * Core Meta-Brain v2 decision logic.
 * 
 * Execution order:
 * 1. Normalize verdicts
 * 2. Determine alignment
 * 3. Calculate base confidence
 * 4. Apply validation multiplier
 * 5. Run decision matrix
 * 6. Apply guards
 * 7. Build reason tree
 * 8. Return final decision
 */

import {
  MetaBrainV2Context,
  MetaBrainV2Decision,
  ReasonNode,
  AlignmentType,
  FinalVerdict,
  VerdictDirection,
  VALIDATION_MULTIPLIERS,
} from '../contracts/metaBrainV2.types.js';

import { runDecisionMatrix, MatrixInput } from '../matrix/decision-matrix.v1.js';
import { applyAllGuards } from './guards.engine.js';

// ═══════════════════════════════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Process context and produce decision
 */
export function processDecision(ctx: MetaBrainV2Context): MetaBrainV2Decision {
  const startTime = Date.now();
  
  // 1. Determine alignment
  const alignment = determineAlignment(ctx);
  
  // 2. Calculate base confidence
  const baseConfidence = Math.min(ctx.sentiment.confidence, ctx.exchange.confidence);
  
  // 3. Apply validation multiplier
  const validationMultiplier = VALIDATION_MULTIPLIERS[ctx.validation.status];
  const confAfterValidation = baseConfidence * validationMultiplier;
  
  // 4. Determine primary direction (Exchange wins in conflicts)
  const primaryDirection = getPrimaryDirection(ctx, alignment);
  
  // 5. Run decision matrix
  const matrixInput: MatrixInput = {
    alignment,
    validation: ctx.validation.status,
    confAfterValidation,
    exchangeReadiness: ctx.exchange.readiness,
    direction: primaryDirection,
  };
  
  const matrixOutput = runDecisionMatrix(matrixInput);
  
  // 6. Apply guards
  const guardResults = applyAllGuards(
    matrixOutput.rawVerdict,
    confAfterValidation,
    ctx,
    alignment
  );
  
  // 7. Build reason tree
  const reasonTree = buildReasonTree(ctx, alignment, matrixOutput, guardResults);
  
  // 8. Build final decision
  const decision: MetaBrainV2Decision = {
    symbol: ctx.symbol,
    t0: ctx.t0,
    
    finalVerdict: guardResults.finalVerdict,
    finalConfidence: guardResults.finalConfidence,
    
    reasonTree,
    
    debug: {
      alignment,
      baseConfidence,
      validationMultiplier,
      confAfterValidation: Math.round(confAfterValidation * 100) / 100,
      matrixRuleId: matrixOutput.ruleId,
      matrixOutput: matrixOutput.rawVerdict,
      guardsApplied: guardResults.guardsApplied,
    },
    
    createdAt: Date.now(),
  };
  
  return decision;
}

/**
 * Determine alignment between Sentiment and Exchange
 */
function determineAlignment(ctx: MetaBrainV2Context): AlignmentType {
  const S = ctx.sentiment.direction;
  const E = ctx.exchange.direction;
  
  // Same direction = ALIGNED
  if (S === E) return 'ALIGNED';
  
  // One is NEUTRAL = PARTIAL
  if (S === 'NEUTRAL' || E === 'NEUTRAL') return 'PARTIAL';
  
  // Both directional but different = CONFLICT
  return 'CONFLICT';
}

/**
 * Get primary direction for matrix
 * - ALIGNED: use common direction
 * - PARTIAL: use non-neutral direction
 * - CONFLICT: use Exchange direction (Truth > Mechanics > Intent)
 */
function getPrimaryDirection(
  ctx: MetaBrainV2Context, 
  alignment: AlignmentType
): 'BULLISH' | 'BEARISH' {
  if (alignment === 'ALIGNED') {
    // Both same, use either
    return ctx.exchange.direction === 'NEUTRAL' ? 'BULLISH' : ctx.exchange.direction as 'BULLISH' | 'BEARISH';
  }
  
  if (alignment === 'PARTIAL') {
    // Use non-neutral direction
    if (ctx.exchange.direction !== 'NEUTRAL') {
      return ctx.exchange.direction as 'BULLISH' | 'BEARISH';
    }
    if (ctx.sentiment.direction !== 'NEUTRAL') {
      return ctx.sentiment.direction as 'BULLISH' | 'BEARISH';
    }
  }
  
  // CONFLICT: Exchange wins
  return ctx.exchange.direction as 'BULLISH' | 'BEARISH';
}

/**
 * Build reason tree for explainability
 */
function buildReasonTree(
  ctx: MetaBrainV2Context,
  alignment: AlignmentType,
  matrixOutput: { ruleId: string; rawVerdict: FinalVerdict; description: string },
  guardResults: { finalVerdict: FinalVerdict; finalConfidence: number; guardsApplied: any[] }
): ReasonNode[] {
  const nodes: ReasonNode[] = [];
  
  // 1. Sentiment node
  nodes.push({
    layer: 'sentiment',
    verdict: ctx.sentiment.direction,
    confidenceImpact: ctx.sentiment.confidence,
    explanation: `Sentiment is ${ctx.sentiment.direction} with confidence ${(ctx.sentiment.confidence * 100).toFixed(0)}%`,
  });
  
  // 2. Exchange node
  nodes.push({
    layer: 'exchange',
    verdict: ctx.exchange.direction,
    confidenceImpact: ctx.exchange.confidence,
    explanation: `Exchange is ${ctx.exchange.direction} with confidence ${(ctx.exchange.confidence * 100).toFixed(0)}%, readiness: ${ctx.exchange.readiness}${ctx.exchange.whaleRisk ? `, whale risk: ${ctx.exchange.whaleRisk}` : ''}`,
  });
  
  // 3. Validation node
  nodes.push({
    layer: 'validation',
    status: ctx.validation.status,
    confidenceImpact: ctx.validation.status === 'CONFIRMS' ? 0 : 
                      ctx.validation.status === 'NO_DATA' ? -0.3 : -0.6,
    explanation: `On-chain validation: ${ctx.validation.status}${ctx.validation.strength ? ` (strength: ${(ctx.validation.strength * 100).toFixed(0)}%)` : ''}`,
  });
  
  // 4. Matrix node
  nodes.push({
    layer: 'matrix',
    verdict: matrixOutput.rawVerdict,
    confidenceImpact: 0,
    explanation: `Matrix rule ${matrixOutput.ruleId}: ${matrixOutput.description}`,
  });
  
  // 5. Guard nodes
  const triggeredGuards = guardResults.guardsApplied.filter(g => g.triggered);
  for (const guard of triggeredGuards) {
    nodes.push({
      layer: 'guard',
      status: guard.guardName,
      confidenceImpact: guard.confidenceDelta,
      explanation: `${guard.guardName}: ${guard.reason}${guard.verdictChange ? ` (${guard.verdictChange})` : ''}`,
    });
  }
  
  return nodes;
}

console.log('[C3] Decision Engine loaded');
