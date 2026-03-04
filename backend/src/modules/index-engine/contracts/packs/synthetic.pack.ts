/**
 * SYNTHETIC PACK V2
 * 
 * Model forecast from K matches.
 */

import { PathPoint, PathBand } from '../index.types.js';

export interface SyntheticPackV2 {
  k: number;                    // number of matches used
  anchorPrice: number;
  meanPath: PathPoint[];        // p50 alias
  bands: PathBand;              // p10/p50/p90
  validation: {
    bandWidth: number;          // p90 - p10 at end
    isValid: boolean;
  };
}
