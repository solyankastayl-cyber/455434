/**
 * Phase I.0: Regime Types
 */

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'TRANSITION';
export type VolRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export interface RegimeSignals {
  maAlignment?: 'BULL' | 'BEAR' | 'MIXED';
  maSlope20?: number;
  maSlope50?: number;
  structure?: 'HH_HL' | 'LH_LL' | 'MIXED' | 'UNKNOWN';
  compression?: number;      // 0..1
  atrPercentile?: number;    // 0..1
}

export interface RegimeLabel {
  marketRegime: MarketRegime;
  volRegime: VolRegime;
  confidence: number;  // 0..1
  signals: RegimeSignals;
}
