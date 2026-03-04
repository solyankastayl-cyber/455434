/**
 * S10.1 + S10.2 + S10.3 + S10.4 + S10.5 + S10.6 + S10.6I + S10.W — Exchange Module Index
 */

export * from './models/exchange.types.js';
export * from './models/exchange.model.js';
export * from './exchange-data.service.js';
export { binanceProvider } from './providers/binance/binance.provider.js';
export { exchangeRoutes } from './routes/exchange.routes.js';
export { exchangeAdminRoutes } from './routes/exchange-admin.routes.js';

// S10.2 - Order Flow
export * from './order-flow/index.js';

// S10.3 - Regimes
export * from './regimes/index.js';

// S10.4 - Liquidation Cascades
export * from './liquidations/index.js';

// S10.5 - Exchange Patterns
export * from './patterns/index.js';

// S10.6 - Observation Dataset
export * from './observation/index.js';

// S10.6I - Market Indicators Layer
export * from './indicators/index.js';

// S10.LABS - Research & Analytics
export * from './labs/index.js';

// S10.P0 - Exchange Providers (Multi-exchange)
export * from './providers/index.js';

// S10.W - Whale Intelligence
export * from './whales/index.js';

// Block 1.1-1.3 — Funding Layer
export * from './funding/index.js';

// Blocks 1.4-1.5 — Alt Screener (Pattern + ML)
export * from './screener/index.js';

// Blocks 2.1-2.4 — Macro Overlay + Funding Intelligence
export * from './macro/index.js';

// Block 2.9 — Sector Rotation
export * from './sector/index.js';

// Block 2.10 — Universe Scanner V2
export * from './universe-v2/index.js';

// Block 2.11 — Snapshot Builder
export * from './snapshots/index.js';

// Block 2.12 — Pattern Clustering
export * from './clustering/index.js';

// Block 2.13 — Alt Movers / Returns
export * from './candidates/index.js';

// Blocks 2.15-2.21 — Signal Intelligence
export * from './intelligence/index.js';

import { FastifyInstance } from 'fastify';
import { exchangeRoutes } from './routes/exchange.routes.js';
import { exchangeAdminRoutes } from './routes/exchange-admin.routes.js';
import { orderFlowRoutes } from './order-flow/order-flow.routes.js';
import { orderFlowAdminRoutes } from './order-flow/order-flow-admin.routes.js';
import { regimeRoutes } from './regimes/regime.routes.js';
import { regimeAdminRoutes } from './regimes/regime-admin.routes.js';
import { cascadeRoutes } from './liquidations/cascade.routes.js';
import { cascadeAdminRoutes } from './liquidations/cascade-admin.routes.js';
import { patternRoutes } from './patterns/pattern.routes.js';
import { patternAdminRoutes } from './patterns/pattern-admin.routes.js';
import { observationRoutes } from './observation/observation.routes.js';
import { observationAdminRoutes } from './observation/observation-admin.routes.js';
import { indicatorRoutes, indicatorAdminRoutes } from './indicators/indicator.routes.js';
import { labsRoutes } from './labs/labs.routes.js';
import { providerRoutes } from './providers/provider.routes.js';
import { initializeNewProviders } from './providers/index.js';
import { startPolling, getConfig } from './exchange-data.service.js';
import { whaleRoutes, whaleAdminRoutes } from './whales/whale.routes.js';
import { whalePatternRoutes } from './whales/patterns/whale-pattern.routes.js';

// B2, B3, B4 — Exchange Verdict Engine
import { universeRoutes } from './universe/universe.routes.js';
import { contextRoutes } from './context/context.routes.js';
import { verdictRoutes } from './verdict/verdict.routes.js';

// Y1 — Admin Control Plane
import { exchangeAdminControlRoutes } from './admin/admin.routes.js';

// Phase 1.1 — Real Data Wiring
import { realDataRoutes } from './data/realdata.routes.js';

// Phase 1.2 — WebSocket Pipeline
import { registerWsRoutes } from './ws/ws.routes.js';

// Phase 1.3 — Backfill
import { registerBackfillRoutes } from './backfill/backfill.routes.js';

// Phase 1.4 — Exchange Freeze (Guardrails)
import { registerFreezeRoutes } from './freeze/freeze.routes.js';

// Block 1.3 — Funding Layer
import { registerFundingRoutes } from './funding/funding.routes.js';
import { fundingService } from './funding/funding.service.js';
import mongoose from 'mongoose';

// Blocks 1.4-1.5 — Alt Screener (Pattern + ML)
import { registerScreenerRoutes } from './screener/screener.routes.js';

// Blocks 2.1-2.4 — Macro Overlay + Funding Intelligence
import { registerMacroRoutes } from './macro/macro.routes.js';
import { macroStateService } from './macro/macro.state.service.js';
import { fundingOverlayService } from './macro/funding.overlay.service.js';

// Stage 2 — Alt Universe
import { registerUniverseRoutes, universeBuilder, startUniverseScheduler } from '../exchange-alt/universe/index.js';

// Block 2.8 — Funding Aggregator
import { fundingAggregatorService, registerAdminFundingDebugRoutes } from './funding/index.js';

// Block 2.9 — Sector Rotation
import { sectorStateService, rotationWaveService, assetTagsStore, registerSectorRotationRoutes } from './sector/index.js';

// Block 2.10 — Universe Scanner V2
import { universeScannerService, registerUniverseV2Routes } from './universe-v2/index.js';

// Block 2.11 — Snapshot Builder
import { snapshotBuilderService, registerSnapshotRoutes } from './snapshots/index.js';

// Block 2.12 — Pattern Clustering
import { featureStatsService, patternClusterService, registerPatternClusterRoutes } from './clustering/index.js';

// Block 2.13 — Alt Movers / Returns
import { returnsBuilderService, altMoversService, registerAltMoversRoutes } from './candidates/index.js';

// Blocks 2.15-2.21 — Signal Intelligence
import { signalIntelligenceService, registerSignalIntelligenceRoutes } from './intelligence/index.js';

/**
 * Register Exchange module
 */
export async function registerExchangeModule(fastify: FastifyInstance): Promise<void> {
  // Register S10.1 routes
  await fastify.register(exchangeRoutes);
  await fastify.register(exchangeAdminRoutes);
  
  // Register S10.2 Order Flow routes
  await fastify.register(orderFlowRoutes);
  await fastify.register(orderFlowAdminRoutes);
  
  // Register S10.3 Regime routes
  await fastify.register(regimeRoutes);
  await fastify.register(regimeAdminRoutes);
  
  // Register S10.4 Cascade routes
  await fastify.register(cascadeRoutes);
  await fastify.register(cascadeAdminRoutes);
  
  // Register S10.5 Pattern routes
  await fastify.register(patternRoutes);
  await fastify.register(patternAdminRoutes);
  
  // Register S10.6 Observation routes
  await fastify.register(observationRoutes);
  await fastify.register(observationAdminRoutes);
  
  // Register S10.6I Indicator routes
  await fastify.register(indicatorRoutes);
  await fastify.register(indicatorAdminRoutes);
  
  // Register S10.LABS routes
  await fastify.register(labsRoutes);
  
  // Register S10.P0 Provider routes (Multi-exchange)
  await fastify.register(providerRoutes, { prefix: '/api/v10/exchange/providers' });
  
  // Initialize X1-X2 new providers (Binance USDM + Mock)
  initializeNewProviders();
  
  // Register S10.W Whale Intelligence routes
  await fastify.register(whaleRoutes, { prefix: '/api/v10/exchange/whales' });
  await fastify.register(whaleAdminRoutes, { prefix: '/api/admin/exchange/whales' });
  await fastify.register(whalePatternRoutes, { prefix: '/api/v10/exchange/whales' });
  
  // Register B2 — Universe routes
  await fastify.register(universeRoutes, { prefix: '/api/v10/exchange' });
  
  // Register B3 — Context routes
  await fastify.register(contextRoutes, { prefix: '/api/v10/exchange' });
  
  // Register B4 — Verdict routes
  await fastify.register(verdictRoutes, { prefix: '/api/v10/exchange' });
  
  // Y1 — Admin Control Plane (Providers + Jobs + Health)
  await fastify.register(exchangeAdminControlRoutes, { prefix: '/api/v10/exchange/admin' });
  
  // Phase 1.1 — Real Data Wiring (LIVE data endpoints)
  await fastify.register(realDataRoutes);
  
  // Phase 1.2 — WebSocket Pipeline (realtime trades/orderbook)
  await registerWsRoutes(fastify);
  
  // Phase 1.3 — Backfill (historical data)
  await registerBackfillRoutes(fastify);
  
  // Phase 1.4 — Exchange Freeze (Guardrails & SLA)
  await registerFreezeRoutes(fastify);
  
  // Block 1.3 — Funding Layer (init with MongoDB)
  const db = mongoose.connection.db;
  if (db) {
    fundingService.init(db);
    console.log('[S10] FundingService initialized with MongoDB');
  } else {
    console.warn('[S10] MongoDB not connected, FundingService not initialized');
  }
  await registerFundingRoutes(fastify);
  console.log('[S10] Funding routes registered');
  
  // Blocks 1.4-1.5 — Alt Screener (Pattern + ML)
  await registerScreenerRoutes(fastify);
  console.log('[S10] Screener routes registered');
  
  // Blocks 2.1-2.4 — Macro Overlay + Funding Intelligence
  if (db) {
    macroStateService.init(db);
    fundingOverlayService.init(db);
    console.log('[S10] Macro services initialized with MongoDB');
  }
  await registerMacroRoutes(fastify);
  console.log('[S10] Macro routes registered');
  
  // Stage 2 — Alt Universe
  if (db) {
    universeBuilder.init(db);
    startUniverseScheduler(db, { intervalMs: 6 * 60 * 60 * 1000, runOnStart: false });
    console.log('[S10] Universe Builder initialized');
  }
  await registerUniverseRoutes(fastify);
  console.log('[S10] Universe routes registered');
  
  // Block 2.8 — Funding Aggregator
  if (db) {
    fundingAggregatorService.init(db);
    console.log('[S10] Funding Aggregator initialized');
  }
  await registerAdminFundingDebugRoutes(fastify);
  console.log('[S10] Funding Debug routes registered (Block 2.8)');
  
  // Block 2.9 — Sector Rotation
  if (db) {
    sectorStateService.init(db);
    rotationWaveService.init(db);
    assetTagsStore.init(db);
    console.log('[S10] Sector services initialized');
  }
  await registerSectorRotationRoutes(fastify);
  console.log('[S10] Sector Rotation routes registered (Block 2.9)');
  
  // Block 2.10 — Universe Scanner V2
  if (db) {
    universeScannerService.init(db);
    console.log('[S10] Universe Scanner V2 initialized');
  }
  await registerUniverseV2Routes(fastify);
  console.log('[S10] Universe V2 routes registered (Block 2.10)');
  
  // Block 2.11 — Snapshot Builder
  if (db) {
    snapshotBuilderService.init(db);
    console.log('[S10] Snapshot Builder initialized');
  }
  await registerSnapshotRoutes(fastify);
  console.log('[S10] Snapshot routes registered (Block 2.11)');
  
  // Block 2.12 — Pattern Clustering
  if (db) {
    featureStatsService.init(db);
    patternClusterService.init(db);
    console.log('[S10] Pattern Clustering initialized');
  }
  await registerPatternClusterRoutes(fastify);
  console.log('[S10] Pattern Clustering routes registered (Block 2.12)');
  
  // Block 2.13 — Alt Movers / Returns
  if (db) {
    returnsBuilderService.init(db);
    altMoversService.init(db);
    console.log('[S10] Alt Movers initialized');
  }
  await registerAltMoversRoutes(fastify);
  console.log('[S10] Alt Movers routes registered (Block 2.13)');
  
  // Blocks 2.15-2.21 — Signal Intelligence
  if (db) {
    signalIntelligenceService.init(db);
    console.log('[S10] Signal Intelligence initialized');
  }
  await registerSignalIntelligenceRoutes(fastify);
  console.log('[S10] Signal Intelligence routes registered (Blocks 2.15-2.21)');
  
  // Auto-start if enabled
  const config = await getConfig();
  if (config.enabled) {
    console.log('[S10] Exchange module enabled, starting polling...');
    await startPolling();
  } else {
    console.log('[S10] Exchange module disabled in config');
  }
  
  console.log('[S10] Exchange Intelligence module registered (S10.1-S10.6I + LABS + P0-Providers + S10.W-Whales + B2-Universe + B3-Context + B4-Verdict + Y1-Admin + Funding + Screener + Macro)');
}

