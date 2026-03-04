/**
 * SPX RULES — Types
 * 
 * BLOCK B6.6 — Rule Extraction Engine (Skill-first)
 */

export type SkillMetric = 'skillTotal' | 'skillUp' | 'skillDown';

export interface RuleCell {
  decade: string;           // "1950s", "1960s"...
  horizon: string;          // "7d" | "14d" | "30d" | "90d" | "180d" | "365d"

  total: number;

  // Prediction distribution
  predUp: number;
  predDown: number;
  predNeutral: number;
  predUpShare: number;

  // Realized distribution (baseline)
  realizedUp: number;
  realizedDown: number;
  realizedNeutral: number;
  baseUpRate: number;
  baseDownRate: number;

  // Hit rates
  hitTotal: number;     // hits / total
  hitUp: number;        // hits among predicted UP
  hitDown: number;      // hits among predicted DOWN

  // Skills (the real edge)
  skillTotal: number;   // weighted skill
  skillUp: number;      // hitUp - baseUpRate
  skillDown: number;    // hitDown - baseDownRate
}

export interface ExtractedRules {
  strongEdgeCells: RuleCell[];   // skill >= +3pp
  brokenCells: RuleCell[];       // skill <= -3pp
  cautionCells: RuleCell[];      // |skill| >= 1.5pp but < 3pp
  weakEdgeCells: RuleCell[];     // skill >= 0.5pp but < 3pp
}

export interface RulesExtractResponse {
  diagnostics: {
    metric: SkillMetric;
    minTotal: number;
    eligibleCells: number;
    totalCells: number;
    totalOutcomes: number;
    predUpShare: number;      // Bull bias indicator
    avgSkillTotal: number;
  };
  matrix: RuleCell[];
  winners: RuleCell[];
  losers: RuleCell[];
  rules: ExtractedRules;
  horizonSummary: Array<{ horizon: string; samples: number; avgSkill: number }>;
  decadeSummary: Array<{ decade: string; samples: number; avgSkill: number }>;
}
