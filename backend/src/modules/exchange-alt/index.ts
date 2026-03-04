/**
 * EXCHANGE ALT MODULE — Main Index
 * ==================================
 * 
 * Cross-sectional altcoin analysis system.
 * Answers: "Which alts are likely to move next?"
 * 
 * BLOCKS 1-28 IMPLEMENTED:
 * - Block 1-5: Core (Types, Market Data, Indicators, Clustering, Ranking)
 * - Block 6: ML on Clusters (Pattern → Outcome Learning)
 * - Block 7: Meta-Brain Integration
 * - Block 8: Replay & Backtest Engine
 * - Block 9: Explainability ("Why this asset today")
 * - Block 10: Auto-Tuning
 * - Block 11: Alt-Sets & Ranking
 * - Block 12: Portfolio Simulation
 * - Block 13: Alt Context
 * - Block 14: ML Overlay
 * - Block 15: Final Schema (unified exports)
 * - Block 16: Validation (Anti-Overfitting)
 * - Block 17: Shadow Portfolio (Paper Trading)
 * - Block 18: Failure Taxonomy
 * - Block 19: Adaptive Gating
 * - Block 20: Altcoin Opportunity Engine (AOE)
 * - Block 21: Portfolio-Aware Filtering
 * - Block 22: Altcoin Radar API (UI)
 * - Block 23: Pattern Performance Memory (PPM)
 * - Block 24: Cross-Asset Pattern Propagation (CAPP)
 * - Block 25: Sector/Regime Overlay (SRO)
 * - Block 26: Portfolio Construction Layer (PCL)
 * - Block 27: Strategy Evaluation & Survival (SES)
 * - Block 28: System Closure (Architecture Freeze)
 */

// Types & Contracts
export * from './types.js';
export * from './constants.js';

// Ports & Adapters
export * from './market-data.port.js';
export { MockMarketDataAdapter } from './adapters/mock-market.adapter.js';

// Block 3-5: Core Services
export * from './indicators/index.js';
export * from './clustering/index.js';
export * from './ranking/index.js';

// Block 6: ML on Clusters
export * from './ml/index.js';

// Block 7: Meta-Brain Integration
export * from './meta-brain/index.js';

// Block 8: Replay & Backtest
export * from './replay/index.js';

// Block 9: Explainability
export * from './explain/index.js';

// Block 10: Auto-Tuning
export * from './tuning/index.js';

// Block 11: Alt-Sets & Ranking
export * from './alt-sets/index.js';

// Block 12: Portfolio Simulation
export * from './portfolio/index.js';

// Block 13: Alt Context
export * from './context/index.js';

// Block 14: ML Overlay
export * from './ml-overlay/index.js';

// Block 16: Validation
export * from './validation/index.js';

// Block 17: Shadow Portfolio
export * from './shadow/index.js';

// Block 18: Failure Taxonomy
export * from './failure/index.js';

// Block 19: Adaptive Gating
export * from './gating/adaptive-gating.service.js';

// Block 20: Altcoin Opportunity Engine
export * from './alt-opps/index.js';

// Block 21: Portfolio-Aware Filtering
export * from './portfolio-filter/index.js';

// Block 23: Pattern Performance Memory
export * from './pattern-memory/index.js';

// Block 24: Cross-Asset Pattern Propagation
export * from './propagation/index.js';

// Block 25: Sector/Regime Overlay
export * from './sector-regime/index.js';

// Block 26: Portfolio Construction Layer
export * from './portfolio-construct/index.js';

// Block 27: Strategy Evaluation & Survival
export * from './strategy-survival/index.js';

// Main Scanner
export { AltScannerService, altScannerService } from './alt-scanner.service.js';

// Routes
export { registerAltScannerRoutes } from './routes/index.js';

console.log('[ExchangeAlt] Module fully loaded (Blocks 1-28)');

