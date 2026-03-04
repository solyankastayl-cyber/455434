/**
 * SPX GUARDRAILS — Service
 * 
 * BLOCK B6.7 — Institutional Anti-Harm Guardrails
 * 
 * Builds guardrail policy from rules extraction (B6.6)
 * and applies it to consensus decisions.
 */

import { spxRulesService } from '../spx-rules/spx-rules.service.js';
import type { RuleCell } from '../spx-rules/spx-rules.types.js';
import type {
  GuardrailStatus,
  GuardrailDecision,
  GuardrailPolicy,
  ReasonCode,
  GuardrailCaps,
} from './spx-guardrails.types.js';
import { 
  GUARDRAIL_THRESHOLDS, 
  CONFIRMED_EDGE_HORIZONS 
} from './spx-guardrails.types.js';

const HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'];

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS SERVICE
// ═══════════════════════════════════════════════════════════════

export class SpxGuardrailsService {
  
  /**
   * Build guardrail policy from rules extraction
   */
  async buildPolicy(preset = 'BALANCED'): Promise<GuardrailPolicy> {
    const {
      MIN_SAMPLES,
      EDGE_STRONG,
      HARM_THRESHOLD,
      BLOCK_SIZE_MULT,
      CAUTION_SIZE_MULT,
      ALLOW_SIZE_MULT,
      BLOCK_CONFIDENCE,
      CAUTION_CONFIDENCE,
      ALLOW_CONFIDENCE,
    } = GUARDRAIL_THRESHOLDS;

    // Get rules extraction
    let rulesData;
    try {
      rulesData = await spxRulesService.extract('skillTotal');
    } catch (err) {
      console.error('[SPX Guardrails] Failed to extract rules:', err);
      return this.emptyPolicy(preset);
    }

    const { matrix } = rulesData;
    if (!matrix || matrix.length === 0) {
      return this.emptyPolicy(preset);
    }

    // Group by horizon (aggregate across decades)
    const horizonAgg = new Map<string, {
      totalSamples: number;
      skillSum: number;
      cells: RuleCell[];
    }>();

    for (const cell of matrix) {
      const agg = horizonAgg.get(cell.horizon) ?? { 
        totalSamples: 0, 
        skillSum: 0, 
        cells: [] 
      };
      agg.totalSamples += cell.total;
      agg.skillSum += cell.skillTotal * cell.total;
      agg.cells.push(cell);
      horizonAgg.set(cell.horizon, agg);
    }

    // Build decisions per horizon
    const decisions: GuardrailDecision[] = [];
    const allowedHorizons: string[] = [];
    const blockedHorizons: string[] = [];
    const cautionHorizons: string[] = [];

    for (const horizon of HORIZONS) {
      const agg = horizonAgg.get(horizon);
      
      if (!agg || agg.totalSamples < MIN_SAMPLES) {
        // Low sample → CAUTION
        const decision = this.buildDecision(
          horizon,
          'CAUTION',
          ['LOW_SAMPLE'],
          {
            skill: 0,
            hitRate: 0.5,
            baselineRate: 0.5,
            samples: agg?.totalSamples ?? 0,
          }
        );
        decisions.push(decision);
        cautionHorizons.push(horizon);
        continue;
      }

      const avgSkill = agg.skillSum / agg.totalSamples;
      const avgHitRate = agg.cells.reduce((s, c) => s + c.hitTotal * c.total, 0) / agg.totalSamples;
      const avgBaseline = agg.cells.reduce((s, c) => s + c.baseUpRate * c.total, 0) / agg.totalSamples;

      // Determine status
      let status: GuardrailStatus = 'CAUTION';
      const reasons: ReasonCode[] = [];

      // Check for harmful skill
      if (avgSkill <= HARM_THRESHOLD) {
        status = 'BLOCK';
        reasons.push('NEG_SKILL');
      } else if (avgSkill >= EDGE_STRONG) {
        // Constitutional rule: only 90d has confirmed edge (from B6.6)
        if (CONFIRMED_EDGE_HORIZONS.includes(horizon)) {
          status = 'ALLOW';
        } else {
          status = 'CAUTION';
          reasons.push('EDGE_NOT_CONFIRMED_GLOBAL');
        }
      } else {
        status = 'CAUTION';
      }

      // Check for decade-specific harm
      const harmfulDecades = agg.cells.filter(c => c.skillTotal <= -0.03);
      if (harmfulDecades.length > 0 && status !== 'BLOCK') {
        reasons.push('DECADE_HARMFUL');
        if (status === 'ALLOW') {
          status = 'CAUTION';
        }
      }

      // Build decision
      const decision = this.buildDecision(
        horizon,
        status,
        reasons,
        {
          skill: Math.round(avgSkill * 10000) / 10000,
          hitRate: Math.round(avgHitRate * 10000) / 10000,
          baselineRate: Math.round(avgBaseline * 10000) / 10000,
          samples: agg.totalSamples,
        }
      );
      decisions.push(decision);

      // Track by status
      if (status === 'ALLOW') allowedHorizons.push(horizon);
      else if (status === 'BLOCK') blockedHorizons.push(horizon);
      else cautionHorizons.push(horizon);
    }

    // Global status: if any horizon blocked, global is CAUTION
    let globalStatus: GuardrailStatus = 'ALLOW';
    if (blockedHorizons.length > 0) {
      globalStatus = blockedHorizons.length >= 3 ? 'BLOCK' : 'CAUTION';
    } else if (cautionHorizons.length >= 4) {
      globalStatus = 'CAUTION';
    }

    // Compute policy hash
    const policyHash = this.computeHash(decisions);

    return {
      version: 'B6.7.1',
      policyHash,
      computedAt: new Date().toISOString(),
      preset,
      globalStatus,
      allowedHorizons,
      blockedHorizons,
      cautionHorizons,
      decisions,
    };
  }

  /**
   * Get guardrail decision for a specific horizon
   */
  async getHorizonGuardrail(horizon: string, preset = 'BALANCED'): Promise<GuardrailDecision | null> {
    const policy = await this.buildPolicy(preset);
    return policy.decisions.find(d => d.horizon === horizon) ?? null;
  }

  /**
   * Apply guardrails to consensus votes
   * Returns modified votes with guardrail info
   */
  async applyToVotes(votes: any[]): Promise<{
    modifiedVotes: any[];
    guardrailsApplied: boolean;
    summary: string;
  }> {
    const policy = await this.buildPolicy();
    let guardrailsApplied = false;
    const appliedTo: string[] = [];

    const modifiedVotes = votes.map(vote => {
      const decision = policy.decisions.find(d => d.horizon === vote.horizon);
      if (!decision) return vote;

      const modified = { ...vote };
      modified.guardrailStatus = decision.status;
      modified.guardrailReasons = decision.reasons;

      if (decision.status === 'BLOCK') {
        modified.action = 'WAIT';
        modified.sizeMult = 0;
        modified.confidence = Math.min(vote.confidence || 1, decision.caps.maxConfidence);
        guardrailsApplied = true;
        appliedTo.push(`${vote.horizon}:BLOCKED`);
      } else if (decision.status === 'CAUTION') {
        modified.sizeMult = (vote.sizeMult || 1) * decision.caps.maxSizeMult;
        modified.confidence = Math.min(vote.confidence || 1, decision.caps.maxConfidence);
        guardrailsApplied = true;
        appliedTo.push(`${vote.horizon}:CAUTION`);
      }

      return modified;
    });

    return {
      modifiedVotes,
      guardrailsApplied,
      summary: appliedTo.length > 0 
        ? `Guardrails applied: ${appliedTo.join(', ')}`
        : 'No guardrails applied',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private buildDecision(
    horizon: string,
    status: GuardrailStatus,
    reasons: ReasonCode[],
    evidence: {
      skill: number;
      hitRate: number;
      baselineRate: number;
      samples: number;
    }
  ): GuardrailDecision {
    const {
      BLOCK_SIZE_MULT,
      CAUTION_SIZE_MULT,
      ALLOW_SIZE_MULT,
      BLOCK_CONFIDENCE,
      CAUTION_CONFIDENCE,
      ALLOW_CONFIDENCE,
    } = GUARDRAIL_THRESHOLDS;

    let caps: GuardrailCaps;

    switch (status) {
      case 'BLOCK':
        caps = {
          maxSizeMult: BLOCK_SIZE_MULT,
          maxConfidence: BLOCK_CONFIDENCE,
          allowedDirections: ['UP'], // only long allowed, no shorts
        };
        break;
      case 'CAUTION':
        caps = {
          maxSizeMult: CAUTION_SIZE_MULT,
          maxConfidence: CAUTION_CONFIDENCE,
          allowedDirections: ['UP', 'DOWN'],
        };
        break;
      case 'ALLOW':
      default:
        caps = {
          maxSizeMult: ALLOW_SIZE_MULT,
          maxConfidence: ALLOW_CONFIDENCE,
          allowedDirections: ['UP', 'DOWN'],
        };
    }

    return {
      horizon,
      status,
      reasons,
      caps,
      evidence,
    };
  }

  private emptyPolicy(preset: string): GuardrailPolicy {
    return {
      version: 'B6.7.1',
      policyHash: 'EMPTY',
      computedAt: new Date().toISOString(),
      preset,
      globalStatus: 'CAUTION',
      allowedHorizons: [],
      blockedHorizons: [],
      cautionHorizons: HORIZONS,
      decisions: HORIZONS.map(h => this.buildDecision(
        h,
        'CAUTION',
        ['LOW_SAMPLE'],
        { skill: 0, hitRate: 0.5, baselineRate: 0.5, samples: 0 }
      )),
    };
  }

  private computeHash(decisions: GuardrailDecision[]): string {
    const key = decisions.map(d => `${d.horizon}:${d.status}`).join('|');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8).toUpperCase();
  }
}

export const spxGuardrailsService = new SpxGuardrailsService();
export default SpxGuardrailsService;
