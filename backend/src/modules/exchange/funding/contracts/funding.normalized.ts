/**
 * БЛОК 1.2 — Normalized Funding Types
 * ====================================
 */

import type { FundingVenue } from './funding.types.js';

export interface NormalizedFunding {
  symbol: string;
  ts: number;

  // агрегированное значение (основное)
  fundingScore: number;      // [-1 … +1]

  // детализация по биржам
  raw: Array<{
    venue: FundingVenue;
    fundingRate: number;
    zScore: number;
    weight: number;
  }>;

  // диагностика
  dispersion: number;        // разброс между биржами
  confidence: number;        // [0..1] доверие к сигналу
}

console.log('[Funding] Normalized types loaded');
