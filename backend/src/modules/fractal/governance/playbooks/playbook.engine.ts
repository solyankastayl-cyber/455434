/**
 * BLOCK 48.3 — Playbook Engine
 * Orchestrates rule evaluation
 */

import {
  PlaybookContext,
  PlaybookDecision,
} from './playbook.types.js';

import {
  ruleFreezeOnly,
  ruleProtectionEscalation,
  ruleRecalibration,
  ruleRecovery,
  ruleInvestigation,
} from './playbook.rules.js';

// ═══════════════════════════════════════════════════════════════
// ORDERED RULES (priority matters)
// ═══════════════════════════════════════════════════════════════

const ORDERED_RULES = [
  ruleFreezeOnly,           // Priority 1: Catastrophic
  ruleProtectionEscalation, // Priority 2: High risk
  ruleRecalibration,        // Priority 3: Calibration issues
  ruleRecovery,             // Priority 4: Recovery opportunity
  ruleInvestigation,        // Priority 5: Watch/investigate
];

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE FUNCTION
// ═══════════════════════════════════════════════════════════════

export function recommendPlaybook(ctx: PlaybookContext): PlaybookDecision {
  // Evaluate rules in priority order
  for (const rule of ORDERED_RULES) {
    const decision = rule(ctx);
    if (decision) {
      return decision;
    }
  }
  
  // No action needed - system is healthy
  return {
    type: 'NO_ACTION',
    severity: 'LOW',
    rationale: [
      'System operating normally',
      'No action required at this time',
    ],
    recommendedActions: [
      { type: 'NO_ACTION', description: 'Continue normal operations' },
    ],
    risks: [],
    alternatives: [],
    requiresConfirmation: false,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE ALL RULES (for visibility)
// ═══════════════════════════════════════════════════════════════

export interface AllRulesResult {
  triggered: PlaybookDecision[];
  notTriggered: string[];
  recommendation: PlaybookDecision;
}

export function evaluateAllRules(ctx: PlaybookContext): AllRulesResult {
  const triggered: PlaybookDecision[] = [];
  const notTriggered: string[] = [];
  
  const ruleNames = [
    'FREEZE_ONLY',
    'PROTECTION_ESCALATION', 
    'RECALIBRATION',
    'RECOVERY',
    'INVESTIGATION',
  ];
  
  for (let i = 0; i < ORDERED_RULES.length; i++) {
    const decision = ORDERED_RULES[i](ctx);
    if (decision) {
      triggered.push(decision);
    } else {
      notTriggered.push(ruleNames[i]);
    }
  }
  
  return {
    triggered,
    notTriggered,
    recommendation: recommendPlaybook(ctx),
  };
}
