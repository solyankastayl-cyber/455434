/**
 * BLOCK 37.3 — Phase Classification Contracts
 * 
 * Local market phase classification for diversity filtering:
 * - ACCUMULATION: low vol, sideways, moderate DD
 * - MARKUP: uptrend, moderate vol rise
 * - DISTRIBUTION: peak/overbought, vol rising, weakness
 * - MARKDOWN: downtrend, high vol/dd
 * - CAPITULATION: extreme dd/vol, panic
 * - RECOVERY: exit from dd, uptrend but vol still high
 */

export type PhaseBucket =
  | "ACCUMULATION"   // low vol, sideways, DD moderate
  | "MARKUP"         // uptrend, moderate vol
  | "DISTRIBUTION"   // peak/overbought, vol rising
  | "MARKDOWN"       // downtrend, high vol/dd
  | "CAPITULATION"   // extreme dd/vol, panic
  | "RECOVERY"       // exit from dd, uptrend, high vol
  | "UNKNOWN";

export interface PhaseClassifierConfig {
  // lookbacks in days
  maFast: number;     // 20
  maSlow: number;     // 200
  volLookback: number; // 14
  ddLookback: number;  // 90

  // thresholds
  trendUpSlope: number;     // +0.0005
  trendDownSlope: number;   // -0.0005
  volHighZ: number;         // 1.0
  ddCapitulation: number;   // 0.35 (35%)
  ddMarkdown: number;       // 0.20 (20%)
  overExtBubble: number;    // 2.6 (price/MA200)
}

export interface PhaseDiversityConfig {
  enabled: boolean;
  maxPerPhase: number;       // default 3
  maxTotal: number;          // final cap after filters
  preferSamePhase?: boolean; // if currentPhase known, keep more same-phase
}

// Default phase classifier configuration
export const DEFAULT_PHASE_CLASSIFIER_CONFIG: PhaseClassifierConfig = {
  maFast: 20,
  maSlow: 200,
  volLookback: 14,
  ddLookback: 90,
  trendUpSlope: 0.0005,
  trendDownSlope: -0.0005,
  volHighZ: 1.0,
  ddCapitulation: 0.35,
  ddMarkdown: 0.20,
  overExtBubble: 2.6,
};

export const DEFAULT_PHASE_DIVERSITY_CONFIG: PhaseDiversityConfig = {
  enabled: true,
  maxPerPhase: 3,
  maxTotal: 25,
  preferSamePhase: true,
};
