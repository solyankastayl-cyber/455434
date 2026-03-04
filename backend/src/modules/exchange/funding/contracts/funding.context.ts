/**
 * БЛОК 1.3 — Funding Context Types
 * =================================
 * Режимы рынка на основе funding
 */

export type FundingContextLabel =
  | 'NEUTRAL'           // около нуля
  | 'OVERLONG'          // funding сильно + (рынок перегружен лонгами)
  | 'OVERSHORT'         // funding сильно - (рынок перегружен шортами)
  | 'LONG_UNWIND'       // funding падает из + в 0- (разгрузка лонгов)
  | 'SHORT_COVER'       // funding растёт из - в 0+ (покрытие шортов)
  | 'DIVERGENT_VENUES'  // биржи не согласны (сильный dispersion)
  | 'NO_DATA';

export interface FundingContext {
  symbol: string;
  ts: number;

  label: FundingContextLabel;

  // основные числа для ML
  fundingScore: number;        // [-1..1] из нормализатора
  fundingTrend: number;        // [-1..1] скорость изменения
  fundingDispersion: number;   // разброс бирж
  confidence: number;          // [0..1]

  // пояснение/диагностика
  reasons: string[];
}

console.log('[Funding] Context types loaded');
