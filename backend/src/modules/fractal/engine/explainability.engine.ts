/**
 * BLOCK 13: Explainability Layer
 * 
 * Breaks down WHY a match was selected, providing:
 * - Score decomposition (similarity, quality, regime)
 * - Human-readable context for each match
 * - Confidence factors breakdown
 * - UI-ready explanations
 */

import { RegimeEngine, RegimeState } from './regime.engine.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ScoreBreakdown {
  raw: number;           // Raw cosine similarity (0-1)
  qualityAdjusted: number;  // After quality penalty
  regimeAdjusted: number;   // After regime modifier
  final: number;         // Final composite score
}

export interface MatchExplanation {
  rank: number;
  period: {
    start: string;  // ISO date
    end: string;    // ISO date
    label: string;  // Human readable: "Jul 2016"
  };
  scores: ScoreBreakdown;
  regime: {
    current: RegimeState;
    historical: RegimeState;
    match: 'FULL' | 'PARTIAL' | 'NONE';
    matchScore: number;  // 0, 0.5, or 1
  };
  quality: {
    avgScore: number;  // 0-1
    flags: string[];   // Any quality issues
  };
  context: {
    marketEvent?: string;    // Known event if any
    priceAtStart: number;
    priceAtEnd: number;
    periodReturn: string;    // "+15.3%"
  };
  humanSummary: string;  // One-liner explanation
}

export interface ConfidenceBreakdown {
  overall: number;  // 0-1
  factors: {
    sampleSize: { value: number; score: number; weight: number };
    scoreDispersion: { value: number; score: number; weight: number };
    regimeAlignment: { value: number; score: number; weight: number };
    dataQuality: { value: number; score: number; weight: number };
  };
  warnings: string[];
}

export interface ExplainabilityResult {
  asOf: string;
  windowLen: number;
  currentRegime: RegimeState;
  matches: MatchExplanation[];
  confidence: ConfidenceBreakdown;
  forwardContext: {
    horizonDays: number;
    expectedReturn: {
      bullCase: string;  // p90
      baseCase: string;  // p50
      bearCase: string;  // p10
    };
    riskMetrics: {
      typicalDrawdown: string;
      worstDrawdown: string;
    };
  };
  narrative: string;  // Full paragraph explanation
}

// ═══════════════════════════════════════════════════════════════
// KNOWN MARKET EVENTS (for context)
// ═══════════════════════════════════════════════════════════════

const KNOWN_EVENTS: Record<string, string> = {
  '2014-12': 'Post Mt.Gox crash recovery',
  '2015-01': 'Bear market bottom',
  '2015-08': 'China devaluation & BTC dump',
  '2016-07': 'Post-halving rally',
  '2017-01': 'China exchange crackdown',
  '2017-12': 'All-time high & ICO mania',
  '2018-01': 'Crypto winter begins',
  '2018-11': 'BCH hash war crash',
  '2020-03': 'COVID crash (Black Thursday)',
  '2020-12': 'Institutional adoption wave',
  '2021-04': 'Coinbase IPO peak',
  '2021-11': 'All-time high $69k',
  '2022-05': 'LUNA/UST collapse',
  '2022-11': 'FTX collapse',
  '2023-03': 'Banking crisis rally',
  '2024-01': 'ETF approval rally',
  '2024-04': 'Fourth halving'
};

// ═══════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════

export class ExplainabilityEngine {
  private regimeEngine = new RegimeEngine();

  /**
   * Build full explanation for match results
   */
  buildExplanation(
    matches: Array<{
      startTs: Date;
      endTs: Date;
      score: number;
      rank: number;
    }>,
    closes: number[],
    ts: Date[],
    forwardStats: {
      return: { p10: number; p50: number; p90: number };
      maxDrawdown: { p10: number; p50: number; p90: number };
    },
    windowLen: number,
    horizonDays: number
  ): ExplainabilityResult {
    const currentRegime = this.regimeEngine.buildCurrentRegime(closes);
    const asOf = ts[ts.length - 1];

    // Build match explanations
    const matchExplanations = matches.map((m, idx) => 
      this.explainMatch(m, idx, closes, ts, currentRegime)
    );

    // Build confidence breakdown
    const confidence = this.buildConfidenceBreakdown(
      matchExplanations,
      currentRegime
    );

    // Build forward context
    const forwardContext = this.buildForwardContext(forwardStats, horizonDays);

    // Generate narrative
    const narrative = this.generateNarrative(
      matchExplanations,
      currentRegime,
      confidence,
      forwardContext
    );

    return {
      asOf: asOf.toISOString(),
      windowLen,
      currentRegime,
      matches: matchExplanations,
      confidence,
      forwardContext,
      narrative
    };
  }

  /**
   * Explain a single match
   */
  private explainMatch(
    match: { startTs: Date; endTs: Date; score: number; rank: number },
    idx: number,
    closes: number[],
    ts: Date[],
    currentRegime: RegimeState
  ): MatchExplanation {
    // Find index in data
    const endIdx = ts.findIndex(t => t.getTime() === match.endTs.getTime());
    const startIdx = ts.findIndex(t => t.getTime() === match.startTs.getTime());

    // Historical regime
    const historicalRegime = endIdx > 0 
      ? this.regimeEngine.buildHistoricalRegime(closes, endIdx)
      : currentRegime;

    // Regime match
    const regimeMatchScore = this.regimeEngine.matchScore(currentRegime, historicalRegime);
    const regimeMatch = regimeMatchScore === 1 ? 'FULL' 
      : regimeMatchScore === 0.5 ? 'PARTIAL' 
      : 'NONE';

    // Score breakdown (simplified - quality not yet integrated)
    const rawScore = match.score;
    const regimeMultiplier = this.regimeEngine.multiplier(regimeMatchScore);
    const qualityScore = 1.0; // Placeholder until quality layer is integrated

    const scores: ScoreBreakdown = {
      raw: Math.round(rawScore * 1000) / 1000,
      qualityAdjusted: Math.round(rawScore * qualityScore * 1000) / 1000,
      regimeAdjusted: Math.round(rawScore * regimeMultiplier * 1000) / 1000,
      final: Math.round(rawScore * qualityScore * regimeMultiplier * 1000) / 1000
    };

    // Period info
    const label = this.formatPeriodLabel(match.startTs);
    const priceAtStart = startIdx >= 0 ? closes[startIdx] : 0;
    const priceAtEnd = endIdx >= 0 ? closes[endIdx] : 0;
    const periodReturn = priceAtStart > 0 
      ? this.formatPercent((priceAtEnd - priceAtStart) / priceAtStart)
      : 'N/A';

    // Check for known event
    const eventKey = `${match.startTs.getFullYear()}-${String(match.startTs.getMonth() + 1).padStart(2, '0')}`;
    const marketEvent = KNOWN_EVENTS[eventKey];

    // Human summary
    const humanSummary = this.buildMatchSummary(
      label,
      rawScore,
      regimeMatch,
      marketEvent
    );

    return {
      rank: match.rank,
      period: {
        start: match.startTs.toISOString(),
        end: match.endTs.toISOString(),
        label
      },
      scores,
      regime: {
        current: currentRegime,
        historical: historicalRegime,
        match: regimeMatch,
        matchScore: regimeMatchScore
      },
      quality: {
        avgScore: qualityScore,
        flags: []
      },
      context: {
        marketEvent,
        priceAtStart: Math.round(priceAtStart * 100) / 100,
        priceAtEnd: Math.round(priceAtEnd * 100) / 100,
        periodReturn
      },
      humanSummary
    };
  }

  /**
   * Build confidence breakdown
   */
  private buildConfidenceBreakdown(
    matches: MatchExplanation[],
    currentRegime: RegimeState
  ): ConfidenceBreakdown {
    const warnings: string[] = [];

    // Sample size factor
    const sampleSize = matches.length;
    const sampleSizeScore = Math.min(1, sampleSize / 25);
    if (sampleSize < 10) warnings.push('Small sample size - results may be unstable');

    // Score dispersion (lower is better - means consistent matches)
    const scores = matches.map(m => m.scores.raw);
    const scoreStd = this.standardDeviation(scores);
    const dispersionScore = Math.max(0, 1 - scoreStd * 5);
    if (scoreStd > 0.15) warnings.push('High score dispersion - matches vary significantly');

    // Regime alignment
    const regimeMatches = matches.filter(m => m.regime.match !== 'NONE').length;
    const regimeScore = regimeMatches / Math.max(1, matches.length);
    if (regimeScore < 0.3) warnings.push('Few matches in similar market regime');

    // Data quality (placeholder)
    const qualityScore = 1.0;

    // Weighted overall
    const weights = { sample: 0.3, dispersion: 0.25, regime: 0.25, quality: 0.2 };
    const overall = 
      sampleSizeScore * weights.sample +
      dispersionScore * weights.dispersion +
      regimeScore * weights.regime +
      qualityScore * weights.quality;

    return {
      overall: Math.round(overall * 100) / 100,
      factors: {
        sampleSize: { value: sampleSize, score: sampleSizeScore, weight: weights.sample },
        scoreDispersion: { value: Math.round(scoreStd * 1000) / 1000, score: dispersionScore, weight: weights.dispersion },
        regimeAlignment: { value: regimeMatches, score: regimeScore, weight: weights.regime },
        dataQuality: { value: 1, score: qualityScore, weight: weights.quality }
      },
      warnings
    };
  }

  /**
   * Build forward context from stats
   */
  private buildForwardContext(
    stats: {
      return: { p10: number; p50: number; p90: number };
      maxDrawdown: { p10: number; p50: number; p90: number };
    },
    horizonDays: number
  ) {
    return {
      horizonDays,
      expectedReturn: {
        bullCase: this.formatPercent(stats.return.p90),
        baseCase: this.formatPercent(stats.return.p50),
        bearCase: this.formatPercent(stats.return.p10)
      },
      riskMetrics: {
        typicalDrawdown: this.formatPercent(stats.maxDrawdown.p50),
        worstDrawdown: this.formatPercent(stats.maxDrawdown.p10)
      }
    };
  }

  /**
   * Generate narrative explanation
   */
  private generateNarrative(
    matches: MatchExplanation[],
    currentRegime: RegimeState,
    confidence: ConfidenceBreakdown,
    forward: ReturnType<typeof this.buildForwardContext>
  ): string {
    if (matches.length === 0) {
      return 'Insufficient data to generate pattern analysis.';
    }

    const topMatches = matches.slice(0, 3);
    const periods = topMatches.map(m => m.period.label).join(', ');
    
    const regimeDesc = this.describeRegime(currentRegime);
    const confLevel = confidence.overall >= 0.7 ? 'high' 
      : confidence.overall >= 0.5 ? 'moderate' 
      : 'limited';

    const eventMentions = topMatches
      .filter(m => m.context.marketEvent)
      .map(m => m.context.marketEvent)
      .slice(0, 2);

    let narrative = `The current market pattern (${regimeDesc}) most closely resembles ${periods}. `;

    if (eventMentions.length > 0) {
      narrative += `Notable historical context: ${eventMentions.join('; ')}. `;
    }

    narrative += `Based on ${matches.length} similar periods, the ${forward.horizonDays}-day outlook shows: `;
    narrative += `base case ${forward.expectedReturn.baseCase}, `;
    narrative += `bull case ${forward.expectedReturn.bullCase}, `;
    narrative += `bear case ${forward.expectedReturn.bearCase}. `;
    narrative += `Typical drawdown: ${forward.riskMetrics.typicalDrawdown}. `;
    narrative += `Analysis confidence: ${confLevel} (${Math.round(confidence.overall * 100)}%).`;

    if (confidence.warnings.length > 0) {
      narrative += ` Note: ${confidence.warnings[0]}`;
    }

    return narrative;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private formatPeriodLabel(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  private formatPercent(value: number): string {
    const pct = value * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  }

  private describeRegime(regime: RegimeState): string {
    const vol = regime.volatility === 'LOW_VOL' ? 'low volatility'
      : regime.volatility === 'HIGH_VOL' ? 'high volatility'
      : 'normal volatility';
    
    const trend = regime.trend === 'UP_TREND' ? 'uptrend'
      : regime.trend === 'DOWN_TREND' ? 'downtrend'
      : 'sideways';
    
    return `${vol}, ${trend}`;
  }

  private buildMatchSummary(
    label: string,
    score: number,
    regimeMatch: 'FULL' | 'PARTIAL' | 'NONE',
    event?: string
  ): string {
    const similarity = score >= 0.8 ? 'very similar' 
      : score >= 0.6 ? 'similar' 
      : 'somewhat similar';
    
    const regimeNote = regimeMatch === 'FULL' ? ', same market regime'
      : regimeMatch === 'PARTIAL' ? ', partially matching regime'
      : '';
    
    const eventNote = event ? ` (${event})` : '';
    
    return `${similarity} to ${label}${regimeNote}${eventNote}`;
  }

  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((s, x) => s + x, 0) / values.length;
    const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }
}
