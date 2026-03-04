/**
 * HYBRID PACK V2
 * 
 * Symbiosis of Replay + Synthetic with divergence guard.
 */

import { PathPoint } from '../index.types.js';

export interface HybridPackV2 {
  anchorPrice: number;
  path: PathPoint[];            // blended path
  
  weights: {
    wReplay: number;            // 0..1
    wSynthetic: number;         // 0..1 (sum = 1)
    method: 'SIMILARITY_ENTROPY' | 'FIXED' | 'LEARNED';
  };
  
  divergence: {
    replayVsSynthetic: number;  // L2 distance
    isAnomalous: boolean;       // divergence > threshold
    divergenceGuard: boolean;   // if true, reduce replay weight
  };
  
  breakdown: {
    replayPath: PathPoint[];
    syntheticMean: PathPoint[];
  };
  
  validation: {
    isValid: boolean;
    reason?: string;
  };
}
