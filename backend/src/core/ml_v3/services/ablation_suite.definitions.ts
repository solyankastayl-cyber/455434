/**
 * Ablation Suite Definitions - P0.2
 * 
 * Predefined experiment suites for ablation analysis
 */
import { AblationSuiteDefinition } from '../types/ablation_suite.types.js';
import { FeaturePack } from '../types/feature_packs.js';

/**
 * PACK_A_CORE Suite
 * 
 * Tests importance of each feature group in PACK_A:
 * - PACK_A vs PACK_A_MINUS_CEX (test CEX importance)
 * - PACK_A vs PACK_A_MINUS_CORRIDORS (test Corridors importance)
 * - PACK_A vs PACK_A_MINUS_ZONES (test Zones importance)
 * 
 * Purpose: Understand which base features drive model performance
 */
export const SUITE_PACK_A_CORE: AblationSuiteDefinition = {
  name: 'PACK_A_CORE',
  basePack: FeaturePack.PACK_A,
  variants: [
    FeaturePack.PACK_A_MINUS_CEX,
    FeaturePack.PACK_A_MINUS_CORRIDORS,
    FeaturePack.PACK_A_MINUS_ZONES,
  ],
  minRows: 200,
  description: 'Core ablation: test importance of CEX, Corridors, and Zones',
};

/**
 * PACK_A_VS_DEX Suite
 * 
 * Tests whether DEX features add value:
 * - PACK_A vs PACK_A_PLUS_DEX
 * 
 * Purpose: Decide if DEX features should be included in production
 */
export const SUITE_PACK_A_VS_DEX: AblationSuiteDefinition = {
  name: 'PACK_A_VS_DEX',
  basePack: FeaturePack.PACK_A,
  variants: [
    FeaturePack.PACK_A_PLUS_DEX,
  ],
  minRows: 200,
  description: 'DEX ablation: test if DEX features improve performance',
};

/**
 * FULL_MATRIX Suite
 * 
 * All ablation experiments:
 * - All PACK_A_CORE tests
 * - DEX test
 * 
 * Purpose: Complete analysis of feature contributions
 */
export const SUITE_FULL_MATRIX: AblationSuiteDefinition = {
  name: 'FULL_MATRIX',
  basePack: FeaturePack.PACK_A,
  variants: [
    FeaturePack.PACK_A_MINUS_CEX,
    FeaturePack.PACK_A_MINUS_CORRIDORS,
    FeaturePack.PACK_A_MINUS_ZONES,
    FeaturePack.PACK_A_PLUS_DEX,
  ],
  minRows: 200,
  description: 'Full ablation matrix: all feature group tests',
};

/**
 * Suite registry
 */
export const ABLATION_SUITES: Record<string, AblationSuiteDefinition> = {
  PACK_A_CORE: SUITE_PACK_A_CORE,
  PACK_A_VS_DEX: SUITE_PACK_A_VS_DEX,
  FULL_MATRIX: SUITE_FULL_MATRIX,
};

/**
 * Get suite definition by name
 */
export function getSuiteDefinition(name: string): AblationSuiteDefinition {
  const suite = ABLATION_SUITES[name];
  if (!suite) {
    throw new Error(`Unknown ablation suite: ${name}. Available: ${Object.keys(ABLATION_SUITES).join(', ')}`);
  }
  return suite;
}
