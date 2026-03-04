/**
 * Risk Explain Service (P1.7 + STABILIZATION)
 * 
 * Generates human-readable explanations for why a route is risky.
 * Deterministic rules only, no ML.
 * 
 * STABILIZATION: Summary-only mode when truncated=true
 */

import { 
  ExplainBlock, 
  ExplainReason, 
  ExplainAmplifier,
  ExplainSeverity,
  RiskSummary,
  GraphEdge
} from '../storage/graph_types.js';

// ============================================
// Explain Rules
// ============================================

interface ExplainRule {
  code: string;
  title: string;
  description: string;
  check: (summary: RiskSummary, edges: GraphEdge[]) => boolean;
  severity: (summary: RiskSummary) => ExplainSeverity;
  evidence?: (summary: RiskSummary, edges: GraphEdge[]) => string[];
}

const EXPLAIN_RULES: ExplainRule[] = [
  {
    code: 'EXIT_TO_CEX',
    title: 'Exit to Centralized Exchange',
    description: 'Funds are moving to a known CEX address, indicating potential sell-off.',
    check: (s, edges) => edges.some(e => e.type === 'DEPOSIT'),
    severity: s => s.exitProbability > 0.7 ? 'HIGH' : 'MEDIUM',
    evidence: (s, edges) => {
      const deposits = edges.filter(e => e.type === 'DEPOSIT');
      return deposits.map(d => `Deposit to ${d.meta?.protocol || 'CEX'}`);
    }
  },
  {
    code: 'CROSS_CHAIN_EXIT',
    title: 'Cross-chain Migration Before Exit',
    description: 'Assets bridged across chains before reaching CEX, common exit pattern.',
    check: (s, edges) => edges.some(e => e.type === 'BRIDGE') && s.exitProbability > 0.5,
    severity: s => s.exitProbability > 0.8 ? 'HIGH' : 'MEDIUM',
    evidence: (s, edges) => {
      const bridges = edges.filter(e => e.type === 'BRIDGE');
      return bridges.map(b => `Bridge ${b.chainFrom} → ${b.chainTo}`);
    }
  },
  {
    code: 'PRE_EXIT_SWAP',
    title: 'Token Swap Before Exit',
    description: 'Converting tokens before exit, possibly to realize gains or hide trail.',
    check: (s, edges) => {
      const hasSwap = edges.some(e => e.type === 'SWAP');
      const hasDeposit = edges.some(e => e.type === 'DEPOSIT');
      return hasSwap && hasDeposit;
    },
    severity: s => s.dumpRiskScore > 70 ? 'HIGH' : 'MEDIUM'
  },
  {
    code: 'HIGH_DUMP_RISK',
    title: 'High Dump Risk Score',
    description: 'Route characteristics indicate high probability of large-scale sell-off.',
    check: s => s.dumpRiskScore >= 70,
    severity: s => s.dumpRiskScore >= 85 ? 'CRITICAL' : 'HIGH',
    evidence: s => [`Risk score: ${s.dumpRiskScore}/100`]
  },
  {
    code: 'LOW_PATH_ENTROPY',
    title: 'Direct Exit Path',
    description: 'Low path entropy indicates a direct, planned exit route.',
    check: s => s.pathEntropy < 0.3 && s.exitProbability > 0.5,
    severity: s => s.exitProbability > 0.7 ? 'HIGH' : 'MEDIUM',
    evidence: s => [`Path entropy: ${(s.pathEntropy * 100).toFixed(0)}%`]
  },
  {
    code: 'MARKET_STRESS_CONTEXT',
    title: 'Exit During Market Stress',
    description: 'Route activity during stressed market conditions amplifies risk.',
    check: s => s.marketRegime === 'STRESSED',
    severity: s => s.contextualRiskScore > 80 ? 'CRITICAL' : 'HIGH',
    evidence: s => [`Market regime: ${s.marketRegime}`]
  },
  {
    code: 'AMPLIFIED_BY_MARKET',
    title: 'Risk Amplified by Market Context',
    description: 'Market conditions are increasing the perceived risk of this route.',
    check: s => s.marketAmplifier > 1.1,
    severity: s => s.marketAmplifier > 1.3 ? 'HIGH' : 'MEDIUM',
    evidence: s => [`Market amplifier: ${s.marketAmplifier}x`]
  }
];

// ============================================
// Risk Explain Service
// ============================================

export class RiskExplainService {
  
  /**
   * Generate full explanation block
   * STABILIZATION: Summary-only mode when truncated
   */
  generateExplanation(
    riskSummary: RiskSummary,
    edges: GraphEdge[],
    truncated: boolean = false
  ): ExplainBlock {
    // STABILIZATION: If truncated, return summary-only explain
    if (truncated) {
      return this.buildSummaryOnlyExplanation(riskSummary);
    }
    
    const reasons = this.buildReasons(riskSummary, edges);
    const amplifiers = this.buildAmplifiers(riskSummary);
    const suppressors = this.buildSuppressors(riskSummary);
    
    return {
      reasons,
      amplifiers,
      suppressors
    };
  }
  
  /**
   * STABILIZATION: Summary-only explanation for truncated graphs
   * No per-edge reasoning, only high-level summary
   */
  private buildSummaryOnlyExplanation(summary: RiskSummary): ExplainBlock {
    const reasons: ExplainReason[] = [];
    
    // Only add high-level summary reasons
    if (summary.dumpRiskScore >= 70) {
      reasons.push({
        code: 'HIGH_DUMP_RISK',
        title: 'High Dump Risk Score',
        description: 'Route shows high sell-off probability. Full graph truncated due to size.',
        severity: summary.dumpRiskScore >= 85 ? 'CRITICAL' : 'HIGH',
        evidence: [`Risk score: ${summary.dumpRiskScore}/100`, 'Graph truncated - summary mode']
      });
    }
    
    if (summary.marketRegime === 'STRESSED') {
      reasons.push({
        code: 'MARKET_STRESS_CONTEXT',
        title: 'Exit During Market Stress',
        description: 'Activity during stressed market conditions.',
        severity: 'HIGH',
        evidence: [`Market regime: STRESSED`]
      });
    }
    
    if (summary.exitProbability > 0.7) {
      reasons.push({
        code: 'HIGH_EXIT_PROBABILITY',
        title: 'High Exit Probability',
        description: 'Route characteristics indicate high probability of CEX exit.',
        severity: 'MEDIUM',
        evidence: [`Exit probability: ${(summary.exitProbability * 100).toFixed(0)}%`]
      });
    }
    
    // Add truncation notice
    reasons.push({
      code: 'TRUNCATED_GRAPH',
      title: 'Graph Truncated',
      description: 'Full graph exceeded size limits. Showing summary analysis only.',
      severity: 'LOW',
      evidence: ['Highlighted path preserved', 'Detailed per-edge analysis unavailable']
    });
    
    return {
      reasons,
      amplifiers: summary.marketAmplifier > 1 ? [{
        tag: 'market_conditions',
        multiplier: summary.marketAmplifier,
        source: 'MARKET'
      }] : [],
      suppressors: summary.marketAmplifier < 1 ? [{
        tag: 'stable_market',
        multiplier: summary.marketAmplifier,
        source: 'MARKET'
      }] : []
    };
  }
  
  /**
   * Build reason list from rules
   */
  private buildReasons(
    summary: RiskSummary,
    edges: GraphEdge[]
  ): ExplainReason[] {
    const reasons: ExplainReason[] = [];
    
    for (const rule of EXPLAIN_RULES) {
      if (rule.check(summary, edges)) {
        reasons.push({
          code: rule.code,
          title: rule.title,
          description: rule.description,
          severity: rule.severity(summary),
          evidence: rule.evidence?.(summary, edges)
        });
      }
    }
    
    // Sort by severity
    const severityOrder: Record<ExplainSeverity, number> = {
      'CRITICAL': 0,
      'HIGH': 1,
      'MEDIUM': 2,
      'LOW': 3
    };
    
    reasons.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    
    return reasons;
  }
  
  /**
   * Build amplifier list
   */
  private buildAmplifiers(summary: RiskSummary): ExplainAmplifier[] {
    const amplifiers: ExplainAmplifier[] = [];
    
    // Market amplifier
    if (summary.marketAmplifier > 1) {
      amplifiers.push({
        tag: 'market_conditions',
        multiplier: summary.marketAmplifier,
        source: 'MARKET'
      });
    }
    
    // Confidence impact
    if (summary.confidenceImpact > 0) {
      amplifiers.push({
        tag: 'ml_confidence_boost',
        multiplier: 1 + summary.confidenceImpact,
        source: 'ROUTE'
      });
    }
    
    // Context tags as amplifiers
    for (const tag of summary.contextTags) {
      if (['VOLUME_SPIKE_EXIT', 'THIN_LIQUIDITY_EXIT', 'MARKET_STRESS'].includes(tag)) {
        amplifiers.push({
          tag: tag.toLowerCase(),
          multiplier: 1.1,
          source: 'MARKET'
        });
      }
    }
    
    return amplifiers;
  }
  
  /**
   * Build suppressor list
   */
  private buildSuppressors(summary: RiskSummary): ExplainAmplifier[] {
    const suppressors: ExplainAmplifier[] = [];
    
    // Market dampener
    if (summary.marketAmplifier < 1) {
      suppressors.push({
        tag: 'stable_market',
        multiplier: summary.marketAmplifier,
        source: 'MARKET'
      });
    }
    
    // Negative confidence impact
    if (summary.confidenceImpact < 0) {
      suppressors.push({
        tag: 'ml_confidence_reduce',
        multiplier: 1 + summary.confidenceImpact,
        source: 'ROUTE'
      });
    }
    
    // Context tags as suppressors
    for (const tag of summary.contextTags) {
      if (['STABLE_MARKET', 'HIGH_VOL_LOW_ENTROPY'].includes(tag)) {
        suppressors.push({
          tag: tag.toLowerCase(),
          multiplier: 0.9,
          source: 'MARKET'
        });
      }
    }
    
    return suppressors;
  }
}

// Singleton
export const riskExplainService = new RiskExplainService();
