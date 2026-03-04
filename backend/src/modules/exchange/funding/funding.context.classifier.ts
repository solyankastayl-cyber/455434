/**
 * БЛОК 1.3 — Funding Context Classifier
 * ======================================
 * Определяет режим рынка на основе funding
 */

import type { FundingContext, FundingContextLabel } from './contracts/funding.context.js';
import type { NormalizedFunding } from './contracts/funding.normalized.js';

// Пороги
const TH = {
  over: 0.55,          // перегруз (55% от max)
  neutral: 0.15,       // около нуля
  trend: 0.12,         // движение funding
  dispersion: 0.02,    // если std высокий, биржи расходятся
};

export class FundingContextClassifier {
  /**
   * Классифицирует funding состояние
   * @param now текущее нормализованное значение
   * @param prev предыдущее состояние (для trend)
   */
  classify(now: NormalizedFunding, prev?: FundingContext | null): FundingContext {
    const reasons: string[] = [];

    const fundingScore = now.fundingScore;
    const fundingDispersion = now.dispersion;
    const confidence = now.confidence;

    // NO_DATA
    if (!now.raw.length || confidence < 0.2) {
      return {
        symbol: now.symbol,
        ts: now.ts,
        label: 'NO_DATA',
        fundingScore,
        fundingTrend: 0,
        fundingDispersion,
        confidence,
        reasons: ['insufficient venue coverage'],
      };
    }

    // Trend (разница с предыдущим)
    const prevScore = prev?.fundingScore ?? fundingScore;
    const fundingTrend = this.clamp(fundingScore - prevScore, -1, 1);

    // DIVERGENT_VENUES
    if (fundingDispersion >= TH.dispersion) {
      reasons.push(`dispersion_high=${fundingDispersion.toFixed(4)}`);
      return {
        symbol: now.symbol,
        ts: now.ts,
        label: 'DIVERGENT_VENUES',
        fundingScore,
        fundingTrend,
        fundingDispersion,
        confidence: this.clamp(confidence * 0.7, 0, 1),
        reasons,
      };
    }

    const label = this.pickLabel(fundingScore, fundingTrend, reasons);

    return {
      symbol: now.symbol,
      ts: now.ts,
      label,
      fundingScore,
      fundingTrend,
      fundingDispersion,
      confidence,
      reasons,
    };
  }

  private pickLabel(
    score: number,
    trend: number,
    reasons: string[]
  ): FundingContextLabel {
    // NEUTRAL
    if (Math.abs(score) <= TH.neutral) {
      reasons.push('score_near_zero');
      
      // С трендом
      if (trend >= TH.trend) {
        reasons.push('trend_up_from_neutral');
        return 'SHORT_COVER';
      }
      if (trend <= -TH.trend) {
        reasons.push('trend_down_from_neutral');
        return 'LONG_UNWIND';
      }
      return 'NEUTRAL';
    }

    // OVERLONG
    if (score >= TH.over) {
      reasons.push(`overlong_score=${score.toFixed(2)}`);
      return 'OVERLONG';
    }

    // OVERSHORT
    if (score <= -TH.over) {
      reasons.push(`overshort_score=${score.toFixed(2)}`);
      return 'OVERSHORT';
    }

    // Промежуточные зоны: тренд важнее
    if (trend >= TH.trend) {
      reasons.push('trend_up');
      return 'SHORT_COVER';
    }
    if (trend <= -TH.trend) {
      reasons.push('trend_down');
      return 'LONG_UNWIND';
    }

    reasons.push('mid_zone');
    return 'NEUTRAL';
  }

  private clamp(x: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, x));
  }
}

export const fundingContextClassifier = new FundingContextClassifier();

console.log('[Funding] Context Classifier loaded');
