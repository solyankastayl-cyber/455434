/**
 * C5 — Novelty Detection Contract
 * Detects unseen/rare configurations using KNN
 */

export type NoveltyLevel = 'KNOWN' | 'RARE' | 'UNSEEN';

export interface AeNovelty {
  novelty: NoveltyLevel;
  score: number;              // [0..1] mean cosine distance
  nearest: string[];          // Top 5 nearest historical dates
  timestamp: string;
}

// Novelty thresholds (cosine distance)
export const NOVELTY_THRESHOLDS = {
  UNSEEN: 0.18,    // > 0.18 = UNSEEN
  RARE: 0.12,      // 0.12-0.18 = RARE
                   // < 0.12 = KNOWN
};

// KNN parameters
export const KNN_CONFIG = {
  K: 20,                     // Number of neighbors
  MIN_HISTORY: 30,           // Minimum historical points needed
  MAX_NEAREST_DISPLAY: 5,    // Max nearest dates to return
};
