/**
 * FRACTAL CONTRACT VALIDATOR
 * 
 * Runtime validation of FractalSignalContract.
 * Ensures all responses match the frozen schema.
 */

import {
  FractalSignalContract,
  FRACTAL_CONTRACT_VERSION,
  FRACTAL_CONTRACT_HASH
} from './fractal.signal.contract.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a Fractal signal response against the contract
 */
export function validateFractalSignal(payload: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!payload) {
    return { ok: false, errors: ['Payload is null or undefined'], warnings };
  }

  // Contract metadata
  if (!payload.contract) {
    errors.push('Missing contract metadata');
  } else {
    if (payload.contract.module !== 'fractal') {
      errors.push(`Invalid module: expected 'fractal', got '${payload.contract.module}'`);
    }
    if (payload.contract.version !== FRACTAL_CONTRACT_VERSION) {
      warnings.push(`Version mismatch: expected ${FRACTAL_CONTRACT_VERSION}, got ${payload.contract.version}`);
    }
    if (payload.contract.symbol !== 'BTC') {
      errors.push(`Invalid symbol: only 'BTC' allowed, got '${payload.contract.symbol}'`);
    }
    if (!payload.contract.generatedAt) {
      errors.push('Missing generatedAt timestamp');
    }
  }

  // Decision
  if (!payload.decision) {
    errors.push('Missing decision object');
  } else {
    const d = payload.decision;
    if (!['LONG', 'SHORT', 'HOLD'].includes(d.action)) {
      errors.push(`Invalid action: ${d.action}`);
    }
    if (typeof d.confidence !== 'number' || d.confidence < 0 || d.confidence > 1) {
      errors.push(`Invalid confidence: ${d.confidence} (must be 0..1)`);
    }
    if (typeof d.reliability !== 'number' || d.reliability < 0 || d.reliability > 1) {
      errors.push(`Invalid reliability: ${d.reliability} (must be 0..1)`);
    }
    if (typeof d.sizeMultiplier !== 'number' || d.sizeMultiplier < 0 || d.sizeMultiplier > 1) {
      warnings.push(`sizeMultiplier out of range: ${d.sizeMultiplier}`);
    }
  }

  // Horizons
  if (!Array.isArray(payload.horizons)) {
    errors.push('Missing or invalid horizons array');
  } else {
    const validHorizons = [7, 14, 30];
    for (const h of payload.horizons) {
      if (!validHorizons.includes(h.h)) {
        errors.push(`Invalid horizon: ${h.h}`);
      }
      if (!['LONG', 'SHORT', 'HOLD'].includes(h.action)) {
        errors.push(`Invalid horizon action for ${h.h}d: ${h.action}`);
      }
    }
    if (payload.horizons.length !== 3) {
      warnings.push(`Expected 3 horizons, got ${payload.horizons.length}`);
    }
  }

  // Risk
  if (!payload.risk) {
    errors.push('Missing risk object');
  } else {
    if (typeof payload.risk.entropy !== 'number') {
      warnings.push('Missing or invalid entropy');
    }
    if (!['OK', 'WARN', 'DEGRADED', 'CRITICAL'].includes(payload.risk.tailBadge)) {
      warnings.push(`Invalid tailBadge: ${payload.risk.tailBadge}`);
    }
  }

  // Market
  if (!payload.market) {
    warnings.push('Missing market context');
  } else {
    if (!payload.market.phase) {
      warnings.push('Missing market phase');
    }
    if (!['ABOVE', 'BELOW', 'NEAR'].includes(payload.market.sma200)) {
      warnings.push(`Invalid sma200 position: ${payload.market.sma200}`);
    }
  }

  // Governance
  if (!payload.governance) {
    warnings.push('Missing governance state');
  } else {
    const validModes = ['NORMAL', 'PROTECTION', 'FROZEN_ONLY', 'HALT'];
    if (!validModes.includes(payload.governance.mode)) {
      warnings.push(`Invalid governance mode: ${payload.governance.mode}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Create a safe HOLD response when validation fails
 */
export function createSafeHoldResponse(reason: string): Partial<FractalSignalContract> {
  const now = new Date().toISOString();
  
  return {
    contract: {
      module: 'fractal',
      version: FRACTAL_CONTRACT_VERSION,
      frozen: true,
      horizons: [7, 14, 30] as const,
      symbol: 'BTC',
      generatedAt: now,
      asofCandleTs: Date.now(),
      contractHash: FRACTAL_CONTRACT_HASH
    },
    decision: {
      action: 'HOLD',
      confidence: 0,
      reliability: 0,
      sizeMultiplier: 0,
      preset: 'BALANCED'
    },
    risk: {
      maxDD_WF: 0,
      mcP95_DD: 0,
      entropy: 1,
      tailBadge: 'CRITICAL'
    },
    governance: {
      mode: 'HALT',
      frozenVersionId: FRACTAL_CONTRACT_VERSION,
      guardLevel: 'RED'
    },
    explain: {
      topMatches: [],
      noTradeReasons: [reason, 'VALIDATION_FAILED'],
      influence: []
    }
  };
}
