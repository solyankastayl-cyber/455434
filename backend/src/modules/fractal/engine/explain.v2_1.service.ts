/**
 * BLOCK 40.1-40.5 — Fractal Explainability Service V2.1
 * 
 * Makes Fractal a fully transparent, white-box module:
 * - 40.1: Structured Explainability Payload
 * - 40.2: TopMatches + Why This Match
 * - 40.3: Counterfactual Scenarios
 * - 40.4: Influence Attribution + No-Trade Reasons
 * - 40.5: Institutional Badge Explainer
 */

import {
  FractalExplainV21,
  FractalSide,
  FractalAction,
  InstitutionalScoreLabel,
  ExplainAssembly,
  ExplainHorizonNode,
  ExplainPatternLayer,
  ExplainReliability,
  ExplainConfidenceDecomp,
  ExplainRiskLayer,
  ExplainMatches,
  ExplainHorizonMatches,
  ExplainMatch,
  CounterfactualExplain,
  CounterfactualScenario,
  CounterfactualToggles,
  InfluenceAttribution,
  NoTradeExplain,
  StatusBadge,
} from '../contracts/explain.contracts.js';

import {
  computeHorizonInfluence,
  computeLayerInfluence,
  computeInfluenceAttribution,
  computeNoTradeReasons,
  computeInstitutionalBreakdown,
  InstitutionalBadgeBreakdown,
  DEFAULT_NO_TRADE_THRESHOLDS,
} from './explain.influence.service.js';

// ═══════════════════════════════════════════════════════════════
// Dependencies Interface
// ═══════════════════════════════════════════════════════════════

export interface ExplainDeps {
  /**
   * Get full multi-horizon signal with all components
   * This should return the complete state from the institutional pipeline
   */
  getMultiHorizonSignal: (args: {
    asOfTs?: number;
    symbol: string;
    overrides?: CounterfactualToggles;
  }) => Promise<MultiHorizonSignalData>;
}

export interface MultiHorizonSignalData {
  asOfTs: number;
  symbol: string;
  
  // Final signal
  finalSide: FractalSide;
  finalConfidence: number;
  finalExposure: number;
  
  // Horizons
  horizons: Array<{
    horizonDays: number;
    side: FractalSide;
    rawScore: number;
    weight: number;
    confidence: number;
    reliability?: number;
    topMatches?: TopMatchData[];
  }>;
  
  // Assembly
  entropy: number;
  sizeMultiplier: number;
  enterThreshold: number;
  fullThreshold: number;
  dominantHorizonDays: number | null;
  budgetWasCapped: boolean;
  
  // Pattern layer
  pattern: {
    effectiveN: number;
    stabilityPSS: number;
    phase: string;
    phaseMultiplier: number;
    dynamicFloorUsed: boolean;
    temporalDispersionUsed: boolean;
    matchCountBeforeFilters: number;
    matchCountAfterFilters: number;
  };
  
  // Reliability
  reliability: {
    score: number;
    badge: StatusBadge;
    components: { drift: number; calibration: number; rolling: number; mcTail: number };
    modifier: number;
    calibrationStatus: StatusBadge;
    driftStatus: StatusBadge;
  };
  
  // Confidence decomposition
  confidenceDecomp: {
    rawConfidence: number;
    evidenceScore: number;
    effectiveNCap: number;
    reliabilityModifier: number;
    finalConfidence: number;
  };
  
  // Risk
  risk: {
    tailRiskScore: number;
    mcP95MaxDD?: number;
    mcP10Sharpe?: number;
  };
  
  // Institutional
  institutionalScore: number;
  institutionalLabel: InstitutionalScoreLabel;
  consensusScore?: number;
  calibrationQuality?: number;
  
  // Position
  position: {
    state: 'FLAT' | 'LONG' | 'SHORT';
    action: FractalAction;
  };
  
  // Freeze
  freezeActive?: boolean;
}

export interface TopMatchData {
  startTs: number;
  endTs: number;
  ageDays: number;
  phase: string;
  regime?: string;
  futureHorizonDays: number;
  sim: { retSim: number; volSim: number; ddSim: number; blendedSim: number };
  direction: { mu: number; baseline: number; excess: number };
  quality: {
    ageWeight: number;
    stabilityWeight: number;
    reliabilityWeight: number;
    dispersionPenalty: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Explain Service
// ═══════════════════════════════════════════════════════════════

export interface ExplainOptions {
  symbol: string;
  asOfTs?: number;
  includeDebug?: boolean;
  includeMatches?: boolean;
  includeCounterfactual?: boolean;
  includeInfluence?: boolean;
}

export class FractalExplainV21Service {
  constructor(private readonly deps: ExplainDeps) {}

  /**
   * Build complete explainability payload
   */
  async explain(opts: ExplainOptions): Promise<FractalExplainV21> {
    const res = await this.deps.getMultiHorizonSignal({
      symbol: opts.symbol,
      asOfTs: opts.asOfTs,
    });

    // Build horizon nodes
    const horizons = this.buildHorizonNodes(res);

    // Build assembly notes
    const assemblyNotes = this.buildAssemblyNotes(res);

    // Build risk notes
    const riskNotes = this.buildRiskNotes(res);

    // Base payload
    const payload: FractalExplainV21 = {
      asOfTs: res.asOfTs,
      symbol: res.symbol,

      signal: res.finalSide,
      action: res.position.action,
      confidence: clamp01(res.finalConfidence),
      reliability: clamp01(res.reliability.score),
      institutionalScore: res.institutionalLabel,

      assembly: {
        dominantHorizonDays: res.dominantHorizonDays,
        entropy: clamp01(res.entropy),
        sizeMultiplier: clamp01(res.sizeMultiplier),
        enterThreshold: res.enterThreshold,
        fullThreshold: res.fullThreshold,
        budgetWasCapped: res.budgetWasCapped,
        horizons,
        notes: assemblyNotes,
      },

      patternLayer: {
        effectiveN: res.pattern.effectiveN,
        stabilityPSS: clamp01(res.pattern.stabilityPSS),
        phase: res.pattern.phase,
        phaseMultiplier: res.pattern.phaseMultiplier,
        dynamicFloorUsed: res.pattern.dynamicFloorUsed,
        temporalDispersionUsed: res.pattern.temporalDispersionUsed,
        matchCountBeforeFilters: res.pattern.matchCountBeforeFilters,
        matchCountAfterFilters: res.pattern.matchCountAfterFilters,
      },

      reliabilityLayer: {
        score: clamp01(res.reliability.score),
        badge: res.reliability.badge,
        components: res.reliability.components,
        modifier: res.reliability.modifier,
        calibrationStatus: res.reliability.calibrationStatus,
        driftStatus: res.reliability.driftStatus,
      },

      confidenceDecomposition: {
        rawConfidence: clamp01(res.confidenceDecomp.rawConfidence),
        evidenceScore: clamp01(res.confidenceDecomp.evidenceScore),
        effectiveNCap: clamp01(res.confidenceDecomp.effectiveNCap),
        reliabilityModifier: clamp01(res.confidenceDecomp.reliabilityModifier),
        finalConfidence: clamp01(res.confidenceDecomp.finalConfidence),
      },

      riskLayer: {
        tailRiskScore: clamp01(res.risk.tailRiskScore),
        mcP95MaxDD: res.risk.mcP95MaxDD,
        mcP10Sharpe: res.risk.mcP10Sharpe,
        notes: riskNotes,
      },
    };

    // 40.2: Add matches if requested
    if (opts.includeMatches !== false) {
      payload.matches = this.buildMatchesPayload(res);
    }

    // 40.3: Add counterfactual if requested
    let counterfactual: CounterfactualExplain | undefined;
    if (opts.includeCounterfactual) {
      counterfactual = await this.runCounterfactualAnalysis(res, opts);
      payload.counterfactual = counterfactual;
    }

    // 40.4: Add influence attribution if requested
    if (opts.includeInfluence !== false) {
      payload.influence = this.buildInfluenceAttribution(res, counterfactual?.scenarios);
      payload.noTrade = this.buildNoTradeExplain(res, payload);
    }

    // Debug
    if (opts.includeDebug) {
      payload.debug = { raw: res };
    }

    return payload;
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.1 — Build Horizon Nodes
  // ═══════════════════════════════════════════════════════════════

  private buildHorizonNodes(res: MultiHorizonSignalData): ExplainHorizonNode[] {
    return res.horizons.map(h => ({
      horizonDays: h.horizonDays,
      rawScore: h.rawScore,
      weight: h.weight,
      contribution: h.rawScore * h.weight,
      side: h.side,
      confidence: h.confidence,
      reliability: h.reliability ?? res.reliability.score,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.1 — Assembly Notes
  // ═══════════════════════════════════════════════════════════════

  private buildAssemblyNotes(res: MultiHorizonSignalData): string[] {
    const notes: string[] = [];
    
    if (res.entropy >= 0.75) {
      notes.push('High entropy: horizon disagreement -> exposure scaled down');
    }
    if (res.dominantHorizonDays != null) {
      notes.push(`Dominant horizon: ${res.dominantHorizonDays}d`);
    }
    if (res.budgetWasCapped) {
      notes.push('Budget cap applied: no single horizon dominates');
    }
    if (res.pattern.dynamicFloorUsed) {
      notes.push('Dynamic floor applied to similarity threshold');
    }
    if (res.pattern.temporalDispersionUsed) {
      notes.push('Temporal dispersion penalty active');
    }
    
    return notes;
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.1 — Risk Notes
  // ═══════════════════════════════════════════════════════════════

  private buildRiskNotes(res: MultiHorizonSignalData): string[] {
    const notes: string[] = [];
    
    if ((res.risk.mcP95MaxDD ?? 0) >= 0.40) {
      notes.push('Elevated tail risk: MC P95 drawdown high');
    }
    if (res.reliability.badge === 'CRITICAL') {
      notes.push('Reliability CRITICAL: policy may freeze/degrade confidence');
    }
    if (res.pattern.phase === 'CAPITULATION') {
      notes.push('Market in CAPITULATION phase: extreme uncertainty');
    }
    if (res.risk.tailRiskScore > 0.6) {
      notes.push('Tail risk score elevated: consider reducing exposure');
    }
    
    return notes;
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.2 — Matches Payload
  // ═══════════════════════════════════════════════════════════════

  private buildMatchesPayload(res: MultiHorizonSignalData): ExplainMatches {
    const perHorizon: ExplainHorizonMatches[] = res.horizons.map(h => {
      const topMatches = (h.topMatches ?? []).slice(0, 12).map((m, idx) =>
        this.buildExplainMatch(m, idx, h.side)
      );

      return {
        horizonDays: h.horizonDays,
        side: h.side,
        confidence: clamp01(h.confidence),
        weight: h.weight,
        topMatches,
      };
    });

    const mergedTop = this.mergeTopMatches(perHorizon, 15);

    return { perHorizon, mergedTop };
  }

  private buildExplainMatch(m: TopMatchData, idx: number, side: FractalSide): ExplainMatch {
    return {
      rank: idx + 1,
      matchId: `${m.startTs}-${m.endTs}-h${m.futureHorizonDays}`,
      startTs: m.startTs,
      endTs: m.endTs,
      ageDays: m.ageDays,
      similarity: {
        retSim: m.sim.retSim,
        volSim: m.sim.volSim,
        ddSim: m.sim.ddSim,
        blendedSim: m.sim.blendedSim,
      },
      phase: m.phase,
      regime: m.regime,
      futureHorizonDays: m.futureHorizonDays,
      why: {
        reasons: this.buildWhyReasons(m, side),
        direction: m.direction,
        quality: m.quality,
      },
    };
  }

  private buildWhyReasons(m: TopMatchData, side: FractalSide): string[] {
    const reasons: string[] = [];
    
    if (m.sim.blendedSim >= 0.50) reasons.push('high similarity');
    if (m.quality.ageWeight >= 0.75) reasons.push('recent pattern');
    if (m.quality.stabilityWeight >= 0.75) reasons.push('stable pattern');
    if (side === 'LONG' && m.direction.excess > 0) reasons.push('positive excess vs baseline');
    if (side === 'SHORT' && m.direction.excess < 0) reasons.push('negative excess vs baseline');
    if (m.sim.retSim >= 0.60) reasons.push('strong return similarity');
    if (m.sim.volSim >= 0.60) reasons.push('volatility structure match');
    
    return reasons;
  }

  private mergeTopMatches(perHorizon: ExplainHorizonMatches[], topN: number): ExplainMatch[] {
    const all = perHorizon.flatMap(h =>
      h.topMatches.map(m => ({
        ...m,
        _score: (m.similarity?.blendedSim ?? 0) * (h.weight ?? 1) / Math.max(1, m.rank ?? 1),
      }))
    );

    all.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    
    // Deduplicate by matchId
    const seen = new Set<string>();
    const unique: ExplainMatch[] = [];
    
    for (const match of all) {
      if (!seen.has(match.matchId)) {
        seen.add(match.matchId);
        const { _score, ...rest } = match as any;
        unique.push(rest);
      }
      if (unique.length >= topN) break;
    }
    
    return unique;
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.3 — Counterfactual Analysis
  // ═══════════════════════════════════════════════════════════════

  private async runCounterfactualAnalysis(
    baseRes: MultiHorizonSignalData,
    opts: ExplainOptions
  ): Promise<CounterfactualExplain> {
    const base = {
      side: baseRes.finalSide,
      confidence: baseRes.finalConfidence,
      exposure: baseRes.finalExposure,
    };

    const scenarios: CounterfactualScenario[] = [];

    const variants: Array<{ name: string; toggles: CounterfactualToggles }> = [
      { name: 'No Age Decay', toggles: { disableAgeDecay: true } },
      { name: 'No Phase Diversity', toggles: { disablePhaseDiversity: true } },
      { name: 'No Entropy Guard', toggles: { disableEntropyGuard: true } },
      { name: 'No Horizon Budget', toggles: { disableHorizonBudget: true } },
      { name: 'No Reliability Modifier', toggles: { disableReliabilityModifier: true } },
    ];

    for (const v of variants) {
      try {
        const alt = await this.deps.getMultiHorizonSignal({
          symbol: opts.symbol,
          asOfTs: opts.asOfTs,
          overrides: v.toggles,
        });

        scenarios.push({
          name: v.name,
          toggles: v.toggles,
          signal: {
            side: alt.finalSide,
            confidence: alt.finalConfidence,
            exposure: alt.finalExposure,
          },
          deltaVsBase: {
            confidenceDelta: alt.finalConfidence - base.confidence,
            exposureDelta: alt.finalExposure - base.exposure,
            sideChanged: alt.finalSide !== base.side,
          },
        });
      } catch (err) {
        // If variant fails, skip it
        console.warn(`[Explain] Counterfactual variant "${v.name}" failed:`, err);
      }
    }

    // Find fragile layer (first one that flips signal)
    const fragileLayer = scenarios.find(s => s.deltaVsBase.sideChanged)?.name;

    return { base, scenarios, fragileLayer };
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.4 — Influence Attribution
  // ═══════════════════════════════════════════════════════════════

  private buildInfluenceAttribution(
    res: MultiHorizonSignalData,
    scenarios?: CounterfactualScenario[]
  ): InfluenceAttribution {
    return computeInfluenceAttribution({
      horizons: res.horizons.map(h => ({
        horizonDays: h.horizonDays,
        rawScore: h.rawScore,
        weight: h.weight,
        contribution: h.rawScore * h.weight,
        side: h.side,
        confidence: h.confidence,
      })),
      finalSide: res.finalSide,
      finalConfidence: res.finalConfidence,
      finalExposure: res.finalExposure,
      entropy: res.entropy,
      reliability: res.reliability.score,
      effectiveN: res.pattern.effectiveN,
      phase: res.pattern.phase,
      calibrationStatus: res.reliability.calibrationStatus,
      driftStatus: res.reliability.driftStatus,
      counterfactuals: scenarios,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.4 — No Trade Explain
  // ═══════════════════════════════════════════════════════════════

  private buildNoTradeExplain(
    res: MultiHorizonSignalData,
    payload: FractalExplainV21
  ): NoTradeExplain {
    return computeNoTradeReasons({
      signal: res.finalSide,
      action: res.position.action,
      effectiveN: res.pattern.effectiveN,
      entropy: res.entropy,
      confidence: res.finalConfidence,
      reliability: res.reliability.score,
      calibrationStatus: res.reliability.calibrationStatus,
      driftStatus: res.reliability.driftStatus,
      phase: res.pattern.phase,
      freezeActive: res.freezeActive,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 40.5 — Institutional Breakdown (separate method)
  // ═══════════════════════════════════════════════════════════════

  buildInstitutionalBreakdown(res: MultiHorizonSignalData): InstitutionalBadgeBreakdown {
    return computeInstitutionalBreakdown({
      reliability: res.reliability.score,
      effectiveN: res.pattern.effectiveN,
      stability: res.pattern.stabilityPSS,
      entropy: res.entropy,
      calibrationQuality: res.calibrationQuality ?? 0.5,
      tailRiskScore: res.risk.tailRiskScore,
      consensusScore: res.consensusScore ?? 0.5,
      institutionalScore: res.institutionalScore,
      institutionalLabel: res.institutionalLabel,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// ═══════════════════════════════════════════════════════════════
// Mock Implementation for Standalone Usage
// ═══════════════════════════════════════════════════════════════

/**
 * Create a mock deps implementation for testing/demo
 */
export function createMockExplainDeps(): ExplainDeps {
  return {
    getMultiHorizonSignal: async ({ symbol, asOfTs, overrides }) => {
      // Return mock data structure
      const now = asOfTs ?? Date.now();
      
      return {
        asOfTs: now,
        symbol,
        finalSide: 'LONG' as FractalSide,
        finalConfidence: 0.64,
        finalExposure: 0.52,
        
        horizons: [
          { horizonDays: 7, side: 'LONG' as FractalSide, rawScore: 0.12, weight: 0.14, confidence: 0.55, topMatches: [] },
          { horizonDays: 14, side: 'LONG' as FractalSide, rawScore: 0.28, weight: 0.43, confidence: 0.68, topMatches: [] },
          { horizonDays: 30, side: 'LONG' as FractalSide, rawScore: 0.19, weight: 0.29, confidence: 0.61, topMatches: [] },
          { horizonDays: 60, side: 'NEUTRAL' as FractalSide, rawScore: 0.05, weight: 0.14, confidence: 0.42, topMatches: [] },
        ],
        
        entropy: overrides?.disableEntropyGuard ? 0.20 : 0.41,
        sizeMultiplier: 0.73,
        enterThreshold: 0.08,
        fullThreshold: 0.28,
        dominantHorizonDays: 14,
        budgetWasCapped: overrides?.disableHorizonBudget ? false : true,
        
        pattern: {
          effectiveN: 38,
          stabilityPSS: 0.84,
          phase: 'MARKUP',
          phaseMultiplier: 1.1,
          dynamicFloorUsed: true,
          temporalDispersionUsed: true,
          matchCountBeforeFilters: 120,
          matchCountAfterFilters: 38,
        },
        
        reliability: {
          score: 0.72,
          badge: 'OK' as StatusBadge,
          components: { drift: 0.85, calibration: 0.78, rolling: 0.68, mcTail: 0.55 },
          modifier: overrides?.disableReliabilityModifier ? 1.0 : 0.88,
          calibrationStatus: 'OK' as StatusBadge,
          driftStatus: 'OK' as StatusBadge,
        },
        
        confidenceDecomp: {
          rawConfidence: 0.72,
          evidenceScore: 0.68,
          effectiveNCap: 0.94,
          reliabilityModifier: overrides?.disableReliabilityModifier ? 1.0 : 0.88,
          finalConfidence: 0.64,
        },
        
        risk: {
          tailRiskScore: 0.22,
          mcP95MaxDD: 0.32,
          mcP10Sharpe: 0.45,
        },
        
        institutionalScore: 0.68,
        institutionalLabel: 'MODERATE' as InstitutionalScoreLabel,
        consensusScore: 0.75,
        calibrationQuality: 0.78,
        
        position: {
          state: 'FLAT' as const,
          action: 'ENTER' as FractalAction,
        },
        
        freezeActive: false,
      };
    },
  };
}
