/**
 * C1 — Alignment Diagnostics
 * 
 * Summarize alignment results for analysis.
 */

import {
  AlignmentResult,
  AlignmentDiagnostics,
  AlignmentType,
} from './alignment.contracts.js';

const ALL_TYPES: AlignmentType[] = [
  'CONFIRMED',
  'CONTRADICTED',
  'IGNORED',
  'EXCHANGE_ONLY',
  'SENTIMENT_ONLY',
  'NO_DATA',
];

/**
 * Summarize a batch of alignment results.
 */
export function summarizeAlignments(results: AlignmentResult[]): AlignmentDiagnostics {
  const counts: Record<AlignmentType, number> = {
    CONFIRMED: 0,
    CONTRADICTED: 0,
    IGNORED: 0,
    EXCHANGE_ONLY: 0,
    SENTIMENT_ONLY: 0,
    NO_DATA: 0,
  };
  
  let strengthSum = 0;
  let trustSum = 0;
  
  for (const r of results) {
    const type = r.alignment.type;
    counts[type] = (counts[type] ?? 0) + 1;
    strengthSum += r.alignment.strength;
    trustSum += r.alignment.trustShift;
  }
  
  const total = results.length;
  
  return {
    counts,
    rates: {
      confirmationRate: total > 0 ? counts.CONFIRMED / total : 0,
      contradictionRate: total > 0 ? counts.CONTRADICTED / total : 0,
    },
    avgStrength: total > 0 ? strengthSum / total : 0,
    avgTrustShift: total > 0 ? trustSum / total : 0,
    totalItems: total,
  };
}

/**
 * Get distribution by type as percentages.
 */
export function getDistribution(results: AlignmentResult[]): Record<AlignmentType, number> {
  const total = results.length;
  if (total === 0) {
    return {
      CONFIRMED: 0,
      CONTRADICTED: 0,
      IGNORED: 0,
      EXCHANGE_ONLY: 0,
      SENTIMENT_ONLY: 0,
      NO_DATA: 0,
    };
  }
  
  const counts: Record<AlignmentType, number> = {
    CONFIRMED: 0,
    CONTRADICTED: 0,
    IGNORED: 0,
    EXCHANGE_ONLY: 0,
    SENTIMENT_ONLY: 0,
    NO_DATA: 0,
  };
  
  for (const r of results) {
    counts[r.alignment.type]++;
  }
  
  const distribution: Record<AlignmentType, number> = {} as any;
  for (const type of ALL_TYPES) {
    distribution[type] = counts[type] / total;
  }
  
  return distribution;
}

/**
 * Generate insights from diagnostics.
 */
export function generateInsights(diagnostics: AlignmentDiagnostics): string[] {
  const insights: string[] = [];
  
  if (diagnostics.rates.confirmationRate > 0.5) {
    insights.push('Sentiment is well-aligned with market mechanics (>50% confirmation).');
  } else if (diagnostics.rates.confirmationRate < 0.2) {
    insights.push('Sentiment rarely matches market mechanics (<20% confirmation).');
  }
  
  if (diagnostics.rates.contradictionRate > 0.3) {
    insights.push(`High contradiction rate (${(diagnostics.rates.contradictionRate * 100).toFixed(0)}%): sentiment may be noise.`);
  }
  
  if (diagnostics.avgTrustShift < -0.2) {
    insights.push('Average trust shift is negative: sentiment degrades overall confidence.');
  } else if (diagnostics.avgTrustShift > 0.2) {
    insights.push('Average trust shift is positive: sentiment reinforces market view.');
  }
  
  const exchangeOnlyRate = diagnostics.counts.EXCHANGE_ONLY / diagnostics.totalItems;
  if (exchangeOnlyRate > 0.4) {
    insights.push('Exchange often provides signal without sentiment backing.');
  }
  
  return insights;
}

console.log('[C1] Alignment Diagnostics loaded');
