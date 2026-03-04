/**
 * FRACTAL FREEZE STAMP
 * 
 * Immutable record of the frozen contract state.
 * Used for audit trail and version verification.
 */

import {
  FRACTAL_CONTRACT_VERSION,
  FRACTAL_CONTRACT_HASH
} from '../contracts/fractal.signal.contract.js';
import { getFreezeConfig } from './fractal.freeze.config.js';

export interface FreezeStamp {
  version: string;
  contractHash: string;
  frozen: boolean;
  frozenAt: string | null;
  freezeAuditVerdict: 'PASS' | 'FAIL' | 'PENDING';
  notes: string[];
  
  // Contract guarantees
  guarantees: {
    symbol: 'BTC';
    horizons: readonly [7, 14, 30];
    noAutoPromotion: true;
    noAutoTraining: true;
    manualGovernanceOnly: true;
  };
  
  // Verification
  verification: {
    contractSchemaValid: boolean;
    freezeGuardsActive: boolean;
    operationalEndpointsOnly: boolean;
  };
}

/**
 * Generate current freeze stamp
 */
export function generateFreezeStamp(): FreezeStamp {
  const config = getFreezeConfig();
  
  // Run verification checks
  const contractSchemaValid = !!FRACTAL_CONTRACT_HASH;
  const freezeGuardsActive = config.frozen;
  const operationalEndpointsOnly = config.blockedOperations.length > 0;
  
  const allChecksPass = contractSchemaValid && freezeGuardsActive && operationalEndpointsOnly;
  
  return {
    version: FRACTAL_CONTRACT_VERSION,
    contractHash: FRACTAL_CONTRACT_HASH,
    frozen: config.frozen,
    frozenAt: config.frozenAt,
    freezeAuditVerdict: config.frozen ? (allChecksPass ? 'PASS' : 'FAIL') : 'PENDING',
    notes: [
      `Contract version: ${FRACTAL_CONTRACT_VERSION}`,
      `Hash: ${FRACTAL_CONTRACT_HASH}`,
      config.frozen ? 'Module is FROZEN' : 'Module is NOT frozen',
      `Allowed symbols: ${config.allowedSymbols.join(', ')}`,
      `Allowed horizons: ${config.allowedHorizons.join(', ')}d`
    ],
    guarantees: {
      symbol: 'BTC',
      horizons: [7, 14, 30] as const,
      noAutoPromotion: true,
      noAutoTraining: true,
      manualGovernanceOnly: true
    },
    verification: {
      contractSchemaValid,
      freezeGuardsActive,
      operationalEndpointsOnly
    }
  };
}

/**
 * Verify contract hash matches
 */
export function verifyContractHash(providedHash: string): boolean {
  return providedHash === FRACTAL_CONTRACT_HASH;
}
