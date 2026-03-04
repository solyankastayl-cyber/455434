/**
 * C2.1 — Onchain Module
 * ======================
 * 
 * On-chain data foundation for Exchange validation.
 * 
 * PURPOSE:
 * - Measure what money is doing (not what people say)
 * - Provide truth-layer for Exchange validation (C2.2)
 * - NO signals, NO predictions
 * 
 * GOLDEN RULES:
 * - Onchain does NOT know about Sentiment
 * - Onchain does NOT know about Exchange Verdict
 * - Onchain measures and stores — nothing more
 * - NO_DATA is valid, not an error
 */

// Contracts
export * from './onchain.contracts.js';

// Models
export { OnchainSnapshotModel, OnchainObservationModel, OnchainProviderHealthModel } from './onchain.models.js';

// Provider
export { generateMockSnapshot } from './onchain.provider.js';

// Services
export { onchainSnapshotService } from './onchain.service.js';

// Metrics Engine (C2.1.2)
export { onchainMetricsEngine } from './onchain.metrics.js';

// Persistence Builder (C2.1.3)
export { onchainPersistenceBuilder } from './onchain.persistence.js';

// Routes
export { onchainRoutes } from './onchain.routes.js';

console.log('[C2.1] Onchain Module loaded (Data + Metrics + Persistence)');
