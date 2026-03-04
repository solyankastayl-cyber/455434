/**
 * Phase D: Hypothesis Types
 * 
 * Core data structures for hypothesis building
 */

export type HypothesisDirection = 'BULL' | 'BEAR' | 'NEUTRAL';

export type PatternCandidate = {
  id: string;
  type: string;
  group: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL' | 'BOTH';
  
  // Scores
  baseScore: number;     // 0..1 from detector
  finalScore: number;    // 0..1 after confluence
  
  // From registry
  exclusivityKey: string;
  priority?: number;
  implemented?: boolean;
  
  // Optional metadata
  metrics?: Record<string, any>;
  tags?: string[];
};

export type GroupBucket = {
  group: string;
  candidates: PatternCandidate[];
};

export type Hypothesis = {
  id: string;
  symbol: string;
  timeframe: string;
  
  direction: HypothesisDirection;
  
  // Max 1 candidate per group
  components: PatternCandidate[];
  
  // Aggregates
  score: number;           // 0..1 ranking score
  probability?: number;    // score→prob from calibration
  
  // Explainability
  reasons: string[];
  dropped?: Array<{ group: string; reason: string }>;
};
