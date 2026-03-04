/**
 * META-BRAIN INVARIANT ENFORCER
 * =============================
 * 
 * The HEART of system protection.
 * Called BEFORE any verdict is finalized.
 * 
 * Any HARD violation = forced AVOID
 * Any SOFT violation = confidence penalty
 * 
 * @sealed v1.0
 */

import {
  InvariantLevel,
  InvariantViolation,
  InvariantCheckContext,
  EnforcerResult,
  InvariantViolationError,
} from './invariants.types.js';
import { META_BRAIN_INVARIANTS } from './invariant.registry.js';

// ═══════════════════════════════════════════════════════════════
// MAIN ENFORCER
// ═══════════════════════════════════════════════════════════════

export function enforceInvariants(ctx: InvariantCheckContext): EnforcerResult {
  const violations: InvariantViolation[] = [];
  const now = Date.now();
  let confidencePenalty = 1.0;
  
  // P1.5: Track coverage (async, non-blocking)
  const { recordInvariantTrigger, recordInvariantPass } = require('./invariant.coverage.service.js');
  
  // Check all invariants
  for (const inv of META_BRAIN_INVARIANTS) {
    try {
      const passed = inv.rule(ctx);
      
      if (!passed) {
        violations.push({
          id: inv.id,
          level: inv.level,
          reason: inv.description,
          source: inv.source,
          timestamp: now,
          context: {
            macroRegime: ctx.macroRegime,
            macroRisk: ctx.macroRisk,
            baseAction: ctx.baseAction,
            finalAction: ctx.finalAction,
            baseConfidence: ctx.baseConfidence,
            finalConfidence: ctx.finalConfidence,
          },
        });
        
        // P1.5: Record trigger (async)
        recordInvariantTrigger(inv.id, inv.level).catch(() => {});
        
        // Apply soft penalty
        if (inv.level === InvariantLevel.SOFT && inv.penalty) {
          confidencePenalty *= inv.penalty;
        }
      } else {
        // P1.5: Record pass (async)
        recordInvariantPass(inv.id).catch(() => {});
      }
    } catch (err: any) {
      // Rule evaluation error = treat as violation
      violations.push({
        id: inv.id,
        level: InvariantLevel.HARD,
        reason: `Rule evaluation failed: ${err.message}`,
        source: inv.source,
        timestamp: now,
      });
      recordInvariantTrigger(inv.id, InvariantLevel.HARD).catch(() => {});
    }
  }
  
  // Check for HARD violations
  const hardViolations = violations.filter(v => v.level === InvariantLevel.HARD);
  const hasHardViolation = hardViolations.length > 0;
  
  // Calculate adjusted confidence
  let adjustedConfidence = ctx.finalConfidence;
  if (hasHardViolation) {
    // Force minimum confidence
    adjustedConfidence = Math.min(adjustedConfidence, 0.25);
  } else {
    // Apply soft penalties
    adjustedConfidence = adjustedConfidence * confidencePenalty;
  }
  
  return {
    violations,
    hasHardViolation,
    forceDecision: hasHardViolation ? 'AVOID' : undefined,
    confidencePenalty,
    adjustedConfidence,
    proceed: !hasHardViolation,
    audit: {
      checkedAt: now,
      invariantsChecked: META_BRAIN_INVARIANTS.length,
      passed: META_BRAIN_INVARIANTS.length - violations.length,
      softViolations: violations.filter(v => v.level === InvariantLevel.SOFT).length,
      hardViolations: hardViolations.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// STRICT ENFORCER (throws on violation)
// ═══════════════════════════════════════════════════════════════

export function enforceInvariantsStrict(ctx: InvariantCheckContext): void {
  const result = enforceInvariants(ctx);
  
  if (result.hasHardViolation) {
    throw new InvariantViolationError(
      result.violations.filter(v => v.level === InvariantLevel.HARD)
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE: BUILD CONTEXT FROM VERDICT
// ═══════════════════════════════════════════════════════════════

export interface VerdictSnapshot {
  // Base input
  baseAction: 'BUY' | 'SELL' | 'AVOID';
  baseConfidence: number;
  baseStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  // Final output
  finalAction: 'BUY' | 'SELL' | 'AVOID';
  finalConfidence: number;
  finalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  // Macro
  macroRegime: string;
  macroRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  macroConfidenceMultiplier: number;
  macroFlags: string[];
  
  // ML
  mlApplied: boolean;
  mlModifier: number;
  mlRequestedAction?: 'BUY' | 'SELL' | 'AVOID';
  
  // Conflict
  hasConflict: boolean;
}

export function buildInvariantContext(snapshot: VerdictSnapshot): InvariantCheckContext {
  return {
    baseAction: snapshot.baseAction,
    baseConfidence: snapshot.baseConfidence,
    baseStrength: snapshot.baseStrength,
    
    finalAction: snapshot.finalAction,
    finalConfidence: snapshot.finalConfidence,
    finalStrength: snapshot.finalStrength,
    
    macroRegime: snapshot.macroRegime,
    macroRisk: snapshot.macroRisk,
    macroPenalty: snapshot.macroConfidenceMultiplier,
    macroFlags: snapshot.macroFlags,
    
    mlApplied: snapshot.mlApplied,
    mlModifier: snapshot.mlModifier,
    mlAction: snapshot.mlRequestedAction,
    
    labsInfluence: 0, // Labs are always READ-ONLY
    labsConflict: snapshot.hasConflict,
    
    hasConflict: snapshot.hasConflict,
    decision: snapshot.finalAction,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUICK CHECKS
// ═══════════════════════════════════════════════════════════════

/**
 * Quick check: Can STRONG action be taken?
 */
export function canDoStrongAction(
  macroRegime: string,
  macroRisk: string,
  macroFlags: string[]
): boolean {
  // Check extreme regimes
  const blockedRegimes = ['PANIC_SELL_OFF', 'CAPITAL_EXIT', 'FULL_RISK_OFF'];
  if (blockedRegimes.includes(macroRegime)) return false;
  
  // Check EXTREME risk
  if (macroRisk === 'EXTREME') return false;
  
  // Check blocking flags
  const blockingFlags = ['MACRO_PANIC', 'EXTREME_FEAR', 'STRONG_BLOCK'];
  if (macroFlags.some(f => blockingFlags.includes(f))) return false;
  
  return true;
}

/**
 * Quick check: Is action allowed?
 */
export function isActionAllowed(
  action: 'BUY' | 'SELL' | 'AVOID',
  macroRegime: string
): boolean {
  // FULL_RISK_OFF only allows AVOID
  if (macroRegime === 'FULL_RISK_OFF' && action !== 'AVOID') {
    return false;
  }
  return true;
}

/**
 * Quick check: Get confidence cap
 */
export function getConfidenceCap(macroRisk: string): number {
  const caps: Record<string, number> = {
    'LOW': 0.85,
    'MEDIUM': 0.70,
    'HIGH': 0.55,
    'EXTREME': 0.45,
  };
  return caps[macroRisk] || 1.0;
}

console.log('[Meta-Brain] Invariant enforcer loaded');
