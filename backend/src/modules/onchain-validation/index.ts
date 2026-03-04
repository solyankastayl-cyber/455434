/**
 * S7 — Onchain Validation Module
 * ===============================
 * 
 * Validation & Contradiction Layer
 * 
 * ARCHITECTURE:
 * - OnchainSnapshot: Point-in-time on-chain state
 * - OnchainValidation: Compare observation vs reality
 * - Impact Rules: DOWNGRADE / STRONG_ALERT (never upgrade)
 * 
 * GOLDEN RULE: Onchain CANNOT improve signal, only validate or contradict.
 */

export { OnchainSnapshotModel, IOnchainSnapshot } from './onchain-snapshot.model.js';
export { onchainSnapshotService } from './onchain-snapshot.service.js';
export { 
  onchainValidationService, 
  ValidationResult, 
  ValidationOutput, 
  ValidationVerdict, 
  ValidationImpact 
} from './onchain-validation.service.js';
export { registerOnchainValidationRoutes, ValidationOutputModel } from './onchain-validation.routes.js';
