/**
 * REPLAY PACK V2
 * 
 * Best historical fractal match + forward path.
 */

import { PathPoint } from '../index.types.js';

export interface ReplayPackV2 {
  matchId: string;
  similarity: number;           // 0..1
  anchorPrice: number;
  path: PathPoint[];            // ABSOLUTE forward path
  sourceWindow: {
    start: string;
    end: string;
    decade: string;             // e.g. "1970s"
  };
  validation: {
    pathLength: number;
    pathStd: number;            // must be > 0 (not collapsed)
    isValid: boolean;
  };
}

export interface TopMatch {
  matchId: string;
  startDate: string;
  endDate: string;
  similarity: number;
  forwardReturn: number;
  decade: string;
}
