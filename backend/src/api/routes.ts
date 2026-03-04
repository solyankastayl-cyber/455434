import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.routes.js';

// Route imports
import { systemRoutes } from './system.routes.js';

// Core module routes
import { relationsRoutes } from '../core/relations/relations.routes.js';
import { transfersRoutes } from '../core/transfers/transfers.routes.js';
import { bundlesRoutes } from '../core/bundles/bundles.routes.js';
import { signalsRoutes } from '../core/signals/signals.routes.js';
import { scoresRoutes } from '../core/scores/scores.routes.js';
import { strategyProfilesRoutes } from '../core/strategies/strategy_profiles.routes.js';
import { strategySignalsRoutes } from '../core/strategy_signals/strategy_signals.routes.js';
import { followsRoutes } from '../core/follows/follows.routes.js';
import { alertsRoutes } from '../core/alerts/alerts.routes.js';
import { tiersRoutes } from '../core/tiers/tiers.routes.js';

// Phase 10 - Explainability & Deep Profiles
import { profilesRoutes } from '../core/profiles/profiles.routes.js';
import { timelinesRoutes } from '../core/timelines/timelines.routes.js';
import { explanationsRoutes } from '../core/explanations/explanations.routes.js';
import { snapshotsRoutes as explainSnapshotsRoutes } from '../core/snapshots/snapshots.routes.js';

// Phase 11 - Decision & Action Layer
import { decisionsRoutes } from '../core/decisions/decisions.routes.js';
import { actionsRoutes } from '../core/actions/actions.routes.js';
import { simulationsRoutes } from '../core/simulations/simulations.routes.js';
import { feedbackRoutes } from '../core/feedback/feedback.routes.js';
import { trustRoutes } from '../core/trust/trust.routes.js';

// Phase 12A - Adaptive Intelligence
import { adaptiveRoutes } from '../core/adaptive/adaptive.routes.js';

// Phase 12B - Personalized Intelligence
import { personalizedRoutes } from '../core/personalized/personalized.routes.js';

// Phase 12C - Learning Control & Safety
import { learningControlRoutes } from '../core/learning_control/learning_control.routes.js';

// Phase 13 - Automation & Action Layer
import { playbooksRoutes } from '../core/playbooks/playbooks.routes.js';
import { actionQueueRoutes } from '../core/action_queue/action_queue.routes.js';
import { paperRoutes } from '../core/paper/paper.routes.js';
import { actionExplainRoutes } from '../core/action_explain/action_explain.routes.js';

// Phase 14A - Market Reality Layer
import { marketRoutes } from '../core/market/market.routes.js';

// Phase 14B - Signal Reactions & Validation
import { signalReactionsRoutes } from '../core/signal_reactions/signal_reactions.routes.js';

// Frontend BFF Layer
import { frontendRoutes } from '../core/frontend/frontend.routes.js';

// Advanced v2
import { advancedRoutes } from '../core/advanced/advanced.routes.js';

// Phase 14C - Market Regimes
import { marketRegimesRoutes } from '../core/market_regimes/market_regimes.routes.js';

// Phase 15 - Trust, Reputation & Public Confidence
import { reputationRoutes } from '../core/reputation/reputation.routes.js';

// Phase 15.5 - Entry & Resolution Layer
import { resolverRoutes } from '../core/resolver/resolver.routes.js';
import { tokenProfileRoutes } from '../core/tokens/token_profile.routes.js';
import entitiesRoutes from '../core/entities/entities.routes.js';

// Phase 15.5 - Attribution Claims Layer
import { attributionClaimsRoutes } from '../core/attribution/attribution_claims.routes.js';

// P2.1 - Bootstrap Task Layer
import { bootstrapRoutes } from '../core/bootstrap/bootstrap.routes.js';

// P2.2 - ENS Provider Layer
import { ensRoutes } from '../core/ens/ens.routes.js';

// P2.3 - WebSocket Gateway
import { registerWebSocket, getConnectionStats } from '../core/websocket/index.js';

// Telegram Notifications
import { telegramRoutes } from '../core/notifications/telegram.routes.js';

// Watchlist
import { watchlistRoutes } from '../core/watchlist/watchlist.routes.js';

// Bridge Detection (Cross-chain Liquidity Migration)
import { bridgeDetectionRoutes } from '../core/bridge_detection/bridge_detection.routes.js';

// Actor Intelligence (BLOCK 3 - Cross-Chain Behavioral Analysis)
import { actorIntelligenceRoutes } from '../core/actor_intelligence/actor_intelligence.routes.js';

// Wallet Intelligence (Phase B)
import { walletRoutes } from '../core/wallets/wallet.routes.js';

// Actors Graph (Structural Intelligence)
import { actorsGraphRoutes } from '../core/actors/actors_graph.routes.js';

// Actors API (Live Data Cards)
import { actorsApiRoutes } from '../core/actors/actors_api.routes.js';

// Actor Detail (Profile Page)
import { actorDetailRoutes } from '../core/actors/actor_detail.routes.js';

// Actor Clustering (P2.2)
import { actorClusteringRoutes } from '../core/actor_clustering/index.js';

// Cross-Chain Event Aggregation (P2.3.2)
import { crossChainRoutes } from '../core/cross_chain/index.js';

// Chain Adapters & Sync (P2.3.1)
import chainSyncRoutes from '../core/chain_adapters/chain_sync.routes.js';

// Token Registry (P0.2.1)
import { tokenRegistryRoutes as tokenRegistryRoutesP02 } from '../core/token_registry/index.js';

// Address Labels (P0.2.2)
import { addressLabelsRoutes } from '../core/address_labels/index.js';

// P0.1 - Ingestion Control (Production Hardening)
import { ingestionControlRoutes } from '../core/ingestion_control/index.js';

// P0.3 - Route Intelligence (Bridge & Route Intelligence v2)
import { routeIntelligenceRoutes } from '../core/route_intelligence/index.js';

// P0.4 - DEX Layer (Uniswap v3 Swaps)
import { dexRoutes } from '../core/dex_layer/index.js';

// P0.5 - Route Intelligence v2.1 (SWAP-enriched + Exit Probability)
import { routesV21Routes } from '../core/route_intelligence_v2_1/index.js';

// P0.6 - ML Feature Taxonomy v2
import { mlFeaturesRoutes } from '../core/ml_features_v2/index.js';

// P0.7 - ML Quality Gates & Data Quality
import { mlQualityRoutes } from '../core/ml_quality/index.js';

// P0.8 - ML Training Loop
import { mlTrainingRoutes } from '../core/ml_training/index.js';

// EPIC A1 - Actors Builder (Dataset)
import { actorRoutes } from '../core/actors/actor.routes.js';

// P1.1 - Actors Enrichment (Data Enrichment)
import { actorEnrichmentRoutes } from '../core/actors/actor_enrichment.routes.js';

// EPIC A2 - Actor Scores
import { actorScoreRoutes } from '../core/actor_scores/actor_score.routes.js';

// EPIC C1 - Graph Builder
import { graphRoutes } from '../core/graph/graph.routes.js';
import { metricsRoutes } from '../core/graph/metrics.routes.js';

// G2 - Cybercrime Hunter (Intelligence Layer)
import { g2Routes } from '../core/intelligence/g2/g2.routes.js';

// G3 - AML/KYT Engine (Intelligence Layer)
import { g3Routes } from '../core/intelligence/g3/g3.routes.js';

// G4 - Threat Radar (Intelligence Layer)
import { g4Routes } from '../core/intelligence/g4/g4.routes.js';

// Sprint 3 - Actor Signals v2
import { actorSignalsRoutes } from '../core/signals/actor_signals.routes.js';

// Sprint 3 - Signal Context Layer
import { signalContextRoutes } from '../core/signals/signal_context.routes.js';

// Sprint 4 - Engine v1 (Decision Layer)
import { engineRoutes } from '../core/engine/engine.routes.js';
import { engineBootstrapRoutes } from '../core/engine/engine_bootstrap.routes.js';
import { engineRuntimeRoutes } from '../core/engine/engine_runtime.routes.js';

// Token Universe (Stage B)
import { tokenUniverseRoutes } from '../core/token_universe/token_universe.routes.js';

// Ranking & Buckets (Stage D)
import { rankingRoutes } from '../core/ranking/ranking.routes.js';

// Token Runner (Stage C)
import { tokenRunnerRoutes } from '../core/token_runner/token_runner.routes.js';

// Block F - Outcome Loop (Self-Learning)
import { outcomeRoutes } from '../core/outcome/outcome.routes.js';

// Block F3.5 - Attribution Dashboard
import { attributionDashboardRoutes } from '../core/outcome/attribution_dashboard.routes.js';

// ML Ready Dashboard v2
import { mlReadyV2Routes } from '../core/ml/ml_ready_v2.routes.js';

// QA Scenarios (P0)
import { qaRoutes } from '../core/qa/qa_scenarios.routes.js';

// P2.5 - Token Symbol Resolution
import { tokenRegistryRoutes } from '../core/resolver/token_registry.routes.js';

// ETAP 2 - LIVE Ingestion
import { liveIngestionRoutes } from '../core/live/live_ingestion.routes.js';
import { liveAggregatesRoutes } from '../core/live/routes/live_aggregates.routes.js';
import { approvalRoutes } from '../core/live/approval/api/approval.routes.js';
import { liveDriftRoutes } from '../core/live/drift/routes/liveDrift.routes.js';

// ETAP 3 - Learning Intelligence
import { learningRoutes } from '../core/learning/routes/learning.routes.js';
import { trendRoutes } from '../core/learning/routes/trend.routes.js';
import { attributionLinkRoutes } from '../core/learning/routes/attribution_outcome_link.routes.js';
import { datasetRoutes } from '../core/learning/dataset/dataset.routes.js';
import { shadowMLRoutes } from '../core/learning/shadow_ml/shadow_ml.routes.js';

// PHASE 4 - Shadow ML Evaluation (Intelligence Control Loop)
import { registerShadowEvaluationRoutes } from '../core/ml_shadow_phase4/shadow_evaluation.routes.js';

// PHASE 5 - Auto-Calibration (±10% Confidence Overlay)
import { registerCalibrationRoutes } from '../core/ml_calibration_phase5/calibration.routes.js';

// PHASE 6 - ML Modes + Kill Switch
import { registerModeRoutes } from '../core/ml_modes_phase6/mode.routes.js';

// Alerts V2 - System & Intelligence Notifications
import { registerSystemAlertRoutes } from '../core/system_alerts/system_alert.routes.js';

// DEV ONLY - Schema Introspection (REMOVE AFTER DATA CONTRACTS)
import { registerDevSchemaRoutes } from './dev_schema.routes.js';

// ETAP 5 - Self-Learning Loop
import { selfLearningRoutes } from '../core/self_learning/self_learning.routes.js';

// ETAP 5.1 - Self-Learning v2 (Guards + Dataset Freeze + Orchestrator)
import selfLearningRoutesV2 from '../core/self_learning/self_learning_v2.routes.js';

// Signal Reweighting v1.1 (between ETAP 3-4 and ETAP 5)
import signalReweightingRoutes from '../core/signal_reweighting/signal_reweighting.routes.js';

// Engine Signals (Layer 1 - Aggregated Patterns)
import { engineSignalsRoutes } from '../core/engine_signals/engine_signals.routes.js';

// EPIC D1 - Engine Signals v2 (Structural Alerts)
import { d1SignalRoutes } from '../core/d1_signals/d1_signal.routes.js';

// EPIC 3 - Engine V2 (Decision Layer V2)
import { engineV2Routes } from './engine_v2.routes.js';

// Rankings V2
import { rankingsV2Routes } from './rankings_v2.routes.js';

// Shadow Mode (V1 vs V2)
import { shadowRoutes } from './shadow.routes.js';

// ML Data Accumulation
import { mlDataRoutes } from './ml_data.routes.js';

// Neural Layer (ML Advisory)
import { neuralRoutes } from './neural.routes.js';

// ЭТАП 3: Training Sandbox (Isolated ML Training)
import { registerTrainingSandboxRoutes } from './training_sandbox.routes.js';

// P2.A - Confidence Dashboard
import { confidenceDashboardRoutes } from '../core/dashboards/confidence_dashboard.routes.js';

// ETAP 6.1 - Raw Data Ingest
import { registerIngestRoutes } from '../core/ingest/ingest.routes.js';

// ETAP 6.2 - Aggregation Jobs
import { registerAggregationRoutes } from '../core/aggregation/aggregation.routes.js';

// P1.5 - CEX/Market Context Layer
import { marketRoutes as marketDataRoutes } from '../core/market_data/api/market.routes.js';

// P1.5.B - Market API Sources (Settings)
import { marketSourcesRoutes } from '../core/market_data/sources/market_sources.routes.js';

// P1.6 - Market ↔ Route Correlation
import { marketRouteRoutes } from '../core/market_route_correlation/index.js';

// P1.7 - Graph Intelligence (Explainability Layer)
import { graphIntelligenceRoutes } from '../core/graph_intelligence/index.js';

// ETAP 6.3 - Snapshot Layer
import { registerSnapshotRoutes } from '../core/snapshots/snapshot.routes.js';

// P0 MULTICHAIN - V2 APIs
import { transfersV2Routes } from '../core/transfers/transfers.v2.routes.js';
import { bridgesRoutes } from '../core/bridges/bridges.routes.js';
import { walletRoutes as walletV2Routes } from '../core/wallet/wallet.routes.js';

// P1.3 - Exchange Pressure (Market & Flow Analytics)
import { exchangePressureRoutes } from '../core/market/exchange_pressure.routes.js';

// P1.1 - Actors V2 (Network-aware)
import { actorsV2Routes } from '../core/actors/actors.v2.routes.js';

// P1.2 - Relations V2 (Network-aware)
import { relationsV2Routes } from '../core/relations/relations.v2.routes.js';

// P1.5 - Accumulation/Distribution Zones
import { zonesRoutes } from '../core/zones/zones.routes.js';

// P2.1 - Feature Store
import { featureRoutes } from '../core/features/feature.routes.js';

// P2.2 - Labels
import { labelRoutes } from '../core/labels/label.routes.js';

// P2.3 - Datasets
import { datasetRoutes } from '../core/labels/label.routes.js';

// P3 - ML Inference & Signal Ensemble
import { mlInferenceRoutes, signalEnsembleRoutes } from '../core/ml/ml_inference.routes.js';

// P3.3 - KNG Topology
import { topologyRoutes } from '../core/topology/topology.routes.js';

// V3.0 B4 - ML V3 Dataset Builder
import { mlV3Routes } from '../core/ml_v3/routes/ml_v3.routes.js';

// U1.1 - Signal Drivers (User-facing Product Layer)
import { signalDriversRoutes } from '../core/signals/routes/signal_drivers.routes.js';

// S1 - Strategy Layer (User-facing Strategy Engine)
import { strategyRoutes } from '../core/strategy/routes/strategy.routes.js';

// P0.2a - Price & Provider Layer
import { priceRoutes } from '../core/price/price.routes.js';

// Admin Layer
import { adminAuthRoutes } from '../core/admin/admin.auth.routes.js';
import { adminProvidersRoutes } from '../core/admin/admin.providers.routes.js';
import { adminMlRoutes } from '../core/admin/admin.ml.routes.js';
import { adminHealthRoutes } from '../core/admin/admin.health.routes.js';
import { adminSystemRoutes } from '../core/admin/admin.system.routes.js';
import { adminPipelinesRoutes } from '../core/admin/admin.pipelines.routes.js';
import { adminSettingsRoutes } from '../core/admin/admin.settings.routes.js';
import { adminBacktestRoutes } from '../core/admin/admin.backtest.routes.js';
import { adminMLValidationRoutes } from '../core/ml/admin_validation.routes.js';
// STEP 0.5 - Admin Performance Layer
import { adminStateRoutes } from '../core/admin/admin.state.routes.js';
import { adminMetricsRoutes } from '../core/admin/admin.metrics.routes.js';
import { registerAdminWebSocket } from '../core/admin/admin.events.js';

// BATCH 1 - ML Retrain Queue & Model Registry
import { adminMlRetrainRoutes, adminMlModelsRoutes } from '../core/ml_retrain/index.js';

// BATCH 3 - Shadow Inference & Evaluation
import { adminMlShadowRoutes } from '../core/ml_retrain/shadow/index.js';

// BATCH 4 - Promotion & Rollback
import { adminMlPromotionRoutes } from '../core/ml_retrain/promotion/index.js';

// ML v2.2 - Auto-Retrain Policy
import { adminMlAutoRetrainRoutes } from '../core/ml_retrain/auto_retrain/index.js';

// ML v2.3 - Feature Pruning + Sample Weighting
import { adminMlV23Routes } from '../core/ml_retrain/v23/index.js';

// ML Governance - Human-in-the-loop Approvals
import { adminMlGovernanceRoutes } from '../core/ml_governance/index.js';

// D3 - Admin Indexer Control Panel
import { adminIndexerRoutes } from '../core/admin/admin.indexer.routes.js';

/**
 * Register All Routes
 */

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Health endpoints
  await app.register(healthRoutes, { prefix: '/api' });

  // System endpoints (P2.3.B)
  await app.register(systemRoutes, { prefix: '/api/system' });

  // ========== CORE MODULES ==========
  
  // Transfers - Normalized layer (L2)
  await app.register(transfersRoutes, { prefix: '/api/transfers' });
  
  // Relations - Aggregated layer (L3)
  await app.register(relationsRoutes, { prefix: '/api/relations' });
  
  // Bundles - Intelligence layer (L4)
  await app.register(bundlesRoutes, { prefix: '/api/bundles' });
  
  // Signals - Event layer (L5)
  await app.register(signalsRoutes, { prefix: '/api/signals' });
  
  // Scores - Rating layer (L6)
  await app.register(scoresRoutes, { prefix: '/api/scores' });
  
  // Strategy Profiles - Strategy layer (L7)
  await app.register(strategyProfilesRoutes, { prefix: '/api/strategies' });
  
  // Strategy Signals - Strategy event layer (L7.1)
  await app.register(strategySignalsRoutes, { prefix: '/api/strategy-signals' });
  
  // Follows - Follow engine (L7.2)
  await app.register(followsRoutes, { prefix: '/api/follow' });
  
  // Alerts - Alerts 2.0 (L8)
  await app.register(alertsRoutes, { prefix: '/api/alerts' });
  
  // Tiers - Monetization hooks (L9)
  await app.register(tiersRoutes, { prefix: '/api/tiers' });
  
  // ========== PHASE 10 - EXPLAINABILITY ==========
  
  // Profiles - Actor/Entity profiles (L10.1)
  await app.register(profilesRoutes, { prefix: '/api/profiles' });
  
  // Timelines - Strategy/Signal/Bundle evolution (L10.2)
  await app.register(timelinesRoutes, { prefix: '/api/timeline' });
  
  // Explanations - WHY engine (L10.3)
  await app.register(explanationsRoutes, { prefix: '/api/explain' });
  
  // Snapshots - Prebuilt UI cache (L10.4)
  await app.register(explainSnapshotsRoutes, { prefix: '/api/snapshots' });

  // ========== PHASE 11 - DECISION & ACTION LAYER ==========
  
  // Decisions - Decision engine (L11.1)
  await app.register(decisionsRoutes, { prefix: '/api/decisions' });
  
  // Actions - Action suggestions (L11.2)
  await app.register(actionsRoutes, { prefix: '/api/actions' });
  
  // Simulations - Virtual performance (L11.3)
  await app.register(simulationsRoutes, { prefix: '/api/simulations' });
  
  // Feedback - Feedback loop (L11.4)
  await app.register(feedbackRoutes, { prefix: '/api/feedback' });
  
  // Trust - Trust & transparency (L11.5)
  await app.register(trustRoutes, { prefix: '/api/trust' });

  // ========== PHASE 12A - ADAPTIVE INTELLIGENCE ==========
  
  // Adaptive - Adaptive weights, confidence calibration, strategy reliability (L12A)
  await app.register(adaptiveRoutes, { prefix: '/api/adaptive' });

  // ========== PHASE 12B - PERSONALIZED INTELLIGENCE ==========
  
  // User preferences, bias, personalized scores (L12B)
  await app.register(personalizedRoutes, { prefix: '/api/user' });

  // ========== PHASE 12C - LEARNING CONTROL & SAFETY ==========
  
  // Learning control, drift guard, freeze/reset (L12C)
  await app.register(learningControlRoutes, { prefix: '/api/learning' });

  // ========== PHASE 13 - AUTOMATION & ACTION LAYER ==========
  
  // Playbooks - Action templates (L13.1)
  await app.register(playbooksRoutes, { prefix: '/api/playbooks' });
  
  // Action Queue - Execution layer (L13.2)
  await app.register(actionQueueRoutes, { prefix: '/api/action-queue' });
  
  // Paper Trading - Copy simulation (L13.3)
  await app.register(paperRoutes, { prefix: '/api/paper' });
  
  // Action Explanations - Explainability (L13.4)
  await app.register(actionExplainRoutes, { prefix: '/api/action-explain' });

  // ========== PHASE 14A - MARKET REALITY LAYER ==========
  
  // Market prices, metrics (L14A)
  await app.register(marketRoutes, { prefix: '/api/market' });

  // ========== PHASE 14B - SIGNAL REACTIONS & VALIDATION ==========
  
  // Signal market reactions and validation (L14B)
  await app.register(signalReactionsRoutes, { prefix: '/api/signal-reactions' });

  // ========== PHASE 14C - MARKET REGIMES ==========
  
  // Market regime detection and context (L14C)
  await app.register(marketRegimesRoutes, { prefix: '/api/market-regimes' });

  // ========== PHASE 15 - TRUST, REPUTATION & PUBLIC CONFIDENCE ==========
  
  // Signal/Strategy/Actor reputation and trust indicators (L15)
  await app.register(reputationRoutes);

  // ========== PHASE 15.5 - ENTRY & RESOLUTION LAYER ==========
  
  // Universal Resolver (L15.5.1)
  await app.register(resolverRoutes, { prefix: '/api' });
  
  // Token Profiles (L15.5.2)
  await app.register(tokenProfileRoutes, { prefix: '/api/tokens' });
  
  // Entity Profiles (L15.5.3)
  await app.register(entitiesRoutes, { prefix: '/api/entities' });

  // Attribution Claims (L15.5.4)
  await app.register(attributionClaimsRoutes, { prefix: '/api/attribution' });

  // ========== P2.1 - BOOTSTRAP TASK LAYER ==========
  
  // Bootstrap Tasks - Indexing queue (P2.1)
  await app.register(bootstrapRoutes, { prefix: '/api/bootstrap' });

  // ========== P2.2 - ENS PROVIDER LAYER ==========
  
  // ENS Resolution (P2.2)
  await app.register(ensRoutes, { prefix: '/api/ens' });

  // ========== TELEGRAM NOTIFICATIONS ==========
  
  // Telegram Bot Integration
  await app.register(telegramRoutes, { prefix: '/api/telegram' });

  // ========== WATCHLIST ==========
  
  // Watchlist - Base of interest
  await app.register(watchlistRoutes, { prefix: '/api/watchlist' });

  // ========== BRIDGE DETECTION ==========
  
  // Bridge Detection - Cross-chain Liquidity Migration Intelligence
  await app.register(bridgeDetectionRoutes, { prefix: '/api/bridge' });

  // ========== ACTOR INTELLIGENCE (BLOCK 3) ==========
  
  // Actor Intelligence - Cross-Chain Behavioral Analysis & Pattern Detection
  await app.register(actorIntelligenceRoutes, { prefix: '/api/actors' });

  // ========== PHASE B - WALLET INTELLIGENCE ==========
  
  // Wallet Profiles (B1)
  await app.register(walletRoutes, { prefix: '/api' });

  // ========== ACTORS - STRUCTURAL INTELLIGENCE ==========
  
  // Actors Graph - Network visualization (P1)
  await app.register(actorsGraphRoutes, { prefix: '/api/actors' });
  
  // Actors API - Live data cards (P1)
  await app.register(actorsApiRoutes, { prefix: '/api/actors-list' });
  
  // Actor Detail - Profile page (P1)
  await app.register(actorDetailRoutes, { prefix: '/api/actor' });
  
  // P2.2: Actor Clustering (MVP)
  await app.register(actorClusteringRoutes, { prefix: '' });
  
  // P2.3.2: Cross-Chain Event Aggregation (CORE)
  await app.register(crossChainRoutes, { prefix: '' });
  
  // P2.3.1: Chain Adapters & Sync
  await app.register(chainSyncRoutes, { prefix: '' });
  
  // P0.2.1: Token Registry
  await app.register(tokenRegistryRoutesP02, { prefix: '/api/registry' });
  
  // P0.2.2: Address Labels & Exchange Entities
  await app.register(addressLabelsRoutes, { prefix: '/api' });
  
  // P0.1: Ingestion Control (Production Hardening)
  await app.register(ingestionControlRoutes, { prefix: '/api' });
  
  // P0.3: Route Intelligence (Bridge & Route Intelligence v2)
  await app.register(routeIntelligenceRoutes, { prefix: '/api' });
  
  // P0.4: DEX Layer (Uniswap v3 Swaps)
  await app.register(dexRoutes, { prefix: '/api' });
  
  // P0.5: Route Intelligence v2.1 (SWAP-enriched + Exit Probability)
  await app.register(routesV21Routes, { prefix: '/api' });
  
  // P0.6: ML Feature Taxonomy v2 (Unified Feature Engineering Layer)
  await app.register(mlFeaturesRoutes, { prefix: '/api/ml/features' });
  
  // P0.7: ML Quality Gates & Data Quality (Safety Layer for ML)
  await app.register(mlQualityRoutes, { prefix: '/api/ml/quality' });
  
  // P0.8: ML Training Loop (Consumer, not Source of Truth)
  await app.register(mlTrainingRoutes, { prefix: '/api/ml/training' });
  
  // EPIC A1: Actors Builder (Dataset)
  await app.register(actorRoutes, { prefix: '/api/actors-builder' });
  
  // P1.1: Actors Enrichment (Data Enrichment)
  await app.register(actorEnrichmentRoutes, { prefix: '/api/actors-enrichment' });
  
  // EPIC A2: Actor Scores (Edge Score, Participation, Flow Role)
  await app.register(actorScoreRoutes, { prefix: '/api/actor-scores' });
  
  // EPIC C1: Graph Builder (Structural Graph)
  await app.register(graphRoutes, { prefix: '/api/graph' });
  await app.register(metricsRoutes, { prefix: '/api/graph' });

  // ========== G2 - CYBERCRIME HUNTER ==========
  
  // G2 Intelligence Layer
  await app.register(g2Routes, { prefix: '/api/intel/g2' });

  // ========== G3 - AML/KYT ENGINE ==========
  
  // G3 Intelligence Layer
  await app.register(g3Routes, { prefix: '/api/intel/g3' });

  // ========== G4 - THREAT RADAR ==========
  
  // G4 Intelligence Layer
  await app.register(g4Routes, { prefix: '/api/intel/g4' });

  // ========== SPRINT 3 - ACTOR SIGNALS V2 ==========
  
  // Actor Behavior Deviations (Sprint 3)
  await app.register(actorSignalsRoutes, { prefix: '/api' });
  
  // Signal Context Layer (Sprint 3)
  await app.register(signalContextRoutes, { prefix: '/api' });

  // ========== SPRINT 4 - ENGINE V1 ==========
  
  // Decision Engine (Sprint 4)
  await app.register(engineRoutes, { prefix: '/api' });
  
  // Engine Bootstrap Routes (P3 Unblocking)
  await app.register(engineBootstrapRoutes, { prefix: '/api' });
  
  // Engine Runtime Config (ML Control)
  await app.register(engineRuntimeRoutes, { prefix: '/api' });
  
  // Token Universe (Stage B - Foundation for Final UX)
  await app.register(tokenUniverseRoutes, { prefix: '/api' });
  
  // Ranking & Buckets (Stage D)
  await app.register(rankingRoutes, { prefix: '/api' });
  
  // Token Runner (Stage C - Engine Analysis)
  await app.register(tokenRunnerRoutes, { prefix: '/api' });

  // ========== BLOCK F - OUTCOME LOOP ==========
  
  // Outcome Loop & Self-Learning (Block F)
  await app.register(outcomeRoutes, { prefix: '/api' });

  // ========== BLOCK F3.5 - ATTRIBUTION DASHBOARD ==========
  
  // Attribution Analytics Dashboard (Block F3.5)
  await app.register(attributionDashboardRoutes, { prefix: '/api' });

  // ========== ML READY DASHBOARD V2 ==========
  
  // ML Ready v2 (Shadow ML Gate)
  await app.register(mlReadyV2Routes, { prefix: '/api' });

  // ========== QA SCENARIOS (P0) ==========
  
  // QA Validation Scenarios
  await app.register(qaRoutes, { prefix: '/api' });

  // ========== P2.5 - TOKEN SYMBOL RESOLUTION ==========
  
  // Token Registry & Resolution (P2.5)
  await app.register(tokenRegistryRoutes, { prefix: '/api' });

  // ========== ETAP 2 - LIVE INGESTION ==========
  
  // LIVE Data Ingestion (Control Plane)
  await app.register(liveIngestionRoutes, { prefix: '/api' });
  
  // LI-3: LIVE Aggregates (Window Aggregator)
  await app.register(liveAggregatesRoutes, { prefix: '/api' });
  
  // LI-4: Approval Gate
  await app.register(approvalRoutes, { prefix: '/api' });
  
  // LI-5: Drift Summary
  await app.register(liveDriftRoutes, { prefix: '/api' });

  // ========== ETAP 3 - LEARNING INTELLIGENCE ==========
  
  // Outcome Tracking (ETAP 3.1)
  await app.register(learningRoutes, { prefix: '/api' });
  
  // Trend Validation (ETAP 3.2)
  await app.register(trendRoutes, { prefix: '/api' });
  
  // Attribution Outcome Link (ETAP 3.3)
  await app.register(attributionLinkRoutes, { prefix: '/api' });
  
  // Learning Dataset Builder (ETAP 3.4)
  await app.register(datasetRoutes, { prefix: '/api' });
  
  // Shadow ML (ETAP 4)
  await app.register(shadowMLRoutes, { prefix: '/api' });

  // ========== PHASE 4 - SHADOW ML EVALUATION (Intelligence Control Loop) ==========
  
  // DEV ONLY - Schema Introspection (REMOVE AFTER DATA CONTRACTS)
  await app.register(registerDevSchemaRoutes, { prefix: '' });
  
  // Shadow ML Evaluation - Observation without influence
  await app.register(registerShadowEvaluationRoutes, { prefix: '' });
  app.log.info('[Phase 4] Shadow ML Evaluation routes registered');

  // ========== PHASE 5 - AUTO-CALIBRATION ==========
  
  // Auto-Calibration - ±10% confidence overlay (Phase 5)
  await app.register(registerCalibrationRoutes, { prefix: '' });
  app.log.info('[Phase 5] Auto-Calibration routes registered');

  // ========== PHASE 6 - ML MODES + KILL SWITCH ==========
  
  // ML Mode Control - OFF/ADVISOR/ASSIST + Kill Switch (Phase 6)
  await app.register(registerModeRoutes, { prefix: '' });
  app.log.info('[Phase 6] ML Modes + Kill Switch routes registered');

  // ========== ETAP 5 - SELF-LEARNING LOOP ==========
  
  // Self-Learning Control & Scheduler (ETAP 5)
  await app.register(selfLearningRoutes, { prefix: '/api' });

  // Self-Learning v2 - Guards, Dataset Freeze, Orchestrator (ETAP 5.1)
  await app.register(selfLearningRoutesV2, { prefix: '/api/self-learning-v2' });

  // ========== SIGNAL REWEIGHTING V1.1 ==========
  
  // Signal weight adjustment based on outcomes (v1.1)
  await app.register(signalReweightingRoutes, { prefix: '/api/signal-reweighting' });

  // ========== ENGINE SIGNALS (LAYER 1) ==========
  
  // Engine Signals - Aggregated patterns from L0 data
  await app.register(engineSignalsRoutes, { prefix: '/api' });

  // ========== EPIC D1 - ENGINE SIGNALS V2 ==========
  
  // D1 Signals - Structural alerts (L1 layer)
  await app.register(d1SignalRoutes, { prefix: '/api/d1-signals' });

  // ========== EPIC 3 - ENGINE V2 ==========
  
  // Engine V2 - Coverage, Evidence, Direction, Risk (EPIC 3)
  await app.register(engineV2Routes, { prefix: '/api' });

  // ========== RANKINGS V2 ==========
  
  // Rankings V2 - Token rankings with Engine V2 integration
  await app.register(rankingsV2Routes, { prefix: '/api' });

  // ========== SHADOW MODE ==========
  
  // Shadow Mode - V1 vs V2 comparison layer
  await app.register(shadowRoutes, { prefix: '/api' });

  // ========== ML DATA ACCUMULATION ==========
  
  // ML Data - Decision logs, outcomes, dataset export
  await app.register(mlDataRoutes, { prefix: '/api' });

  // ========== NEURAL LAYER ==========
  
  // Neural Layer - ML advisory (confidence calibration, outcome prediction)
  await app.register(neuralRoutes, { prefix: '/api' });

  // ========== ЭТАП 3 - ML TRAINING SANDBOX ==========
  
  // Training Sandbox - Isolated ML training (no Engine connection)
  app.register(async (sandboxApp) => {
    await registerTrainingSandboxRoutes(sandboxApp);
  }, { prefix: '/api' });

  // ========== P2.A - CONFIDENCE DASHBOARD ==========
  
  // Confidence quality monitoring dashboard
  await confidenceDashboardRoutes(app);

  // ========== ETAP 6.1 - RAW DATA INGEST ==========
  
  // Raw ERC-20 transfers ingestion (ETAP 6.1)
  await registerIngestRoutes(app);

  // ========== ETAP 6.2 - AGGREGATION JOBS ==========
  
  // Actor flow, activity, and bridge aggregates (ETAP 6.2)
  await registerAggregationRoutes(app);

  // ========== ETAP 6.3 - SNAPSHOT LAYER ==========
  
  // Signal snapshots for Engine (ETAP 6.3)
  await registerSnapshotRoutes(app);

  // ========== P1.5 - CEX/MARKET CONTEXT LAYER ==========
  
  // Market candles, metrics, regime, quality (P1.5 - NOT trading signals)
  await app.register(marketDataRoutes, { prefix: '/api/market-data' });
  app.log.info('[P1.5] Market Data (CEX Context) routes registered');

  // P1.5.B - Market API Sources Settings
  await app.register(marketSourcesRoutes, { prefix: '/api/settings/market-sources' });
  app.log.info('[P1.5.B] Market Sources Settings routes registered');

  // P1.6 - Market ↔ Route Correlation
  await app.register(marketRouteRoutes, { prefix: '/api/market-route' });
  app.log.info('[P1.6] Market Route Correlation routes registered');

  // P1.7 - Graph Intelligence (Explainability Layer)
  await app.register(graphIntelligenceRoutes, { prefix: '/api/graph-intelligence' });
  app.log.info('[P1.7] Graph Intelligence routes registered');

  // ========== ALERTS V2 - SYSTEM & INTELLIGENCE ==========
  
  // System Alerts V2 - Runtime & Intelligence Notifications
  await app.register(registerSystemAlertRoutes, { prefix: '' });
  app.log.info('[Alerts V2] System Alerts routes registered');

  // ========== FRONTEND BFF LAYER ==========
  
  // Frontend aggregation endpoints
  await app.register(frontendRoutes, { prefix: '/api/frontend' });

  // ========== ADVANCED V2 ==========
  
  // Advanced control panel (3 screens)
  await app.register(advancedRoutes, { prefix: '/api/advanced' });

  // ========== P2.3 - WEBSOCKET GATEWAY ==========
  
  // NOTE: WebSocket routes are registered directly in app.ts
  // to avoid encapsulation issues with @fastify/websocket
  
  // WS Stats endpoint
  app.get('/api/ws/stats', async (_request, reply) => {
    const stats = getConnectionStats();
    return reply.send({ ok: true, data: stats });
  });

  // ========== P0 MULTICHAIN - V2 APIs ==========
  
  // Transfers V2 - Network-aware (REQUIRED network param)
  await app.register(transfersV2Routes, { prefix: '/api/v2/transfers' });
  app.log.info('[P0] Transfers V2 routes registered');
  
  // Bridges V2 - Cross-chain bridge events
  await app.register(bridgesRoutes, { prefix: '/api/v2/bridges' });
  app.log.info('[P0] Bridges V2 routes registered');
  
  // Wallet V2 - Multi-network wallet summary
  await app.register(walletV2Routes, { prefix: '/api/v2/wallet' });
  app.log.info('[P0] Wallet V2 routes registered');
  
  // P1.3 - Exchange Pressure (Market & Flow Analytics)
  await app.register(exchangePressureRoutes, { prefix: '/api/market' });
  app.log.info('[P1.3] Exchange Pressure routes registered');
  
  // NOTE: S10 Exchange Module is registered in app.ts
  
  // P1.1 - Actors V2 (Network-aware)
  await app.register(actorsV2Routes, { prefix: '/api/v2/actors' });
  app.log.info('[P1.1] Actors V2 routes registered');
  
  // P1.2 - Relations V2 (Network-aware corridors)
  await app.register(relationsV2Routes, { prefix: '/api/v2/relations' });
  app.log.info('[P1.2] Relations V2 routes registered');
  
  // P1.5 - Accumulation/Distribution Zones
  await app.register(zonesRoutes, { prefix: '/api/v2/zones' });
  app.log.info('[P1.5] Zones routes registered');
  
  // P2.1 - Feature Store
  await app.register(featureRoutes, { prefix: '/api/v2/features' });
  app.log.info('[P2.1] Feature Store routes registered');

  // V3.0 Pack A - Feature Store V3
  const { featureV3Routes } = await import('../core/features/feature_v3.routes.js');
  await app.register(featureV3Routes, { prefix: '/api/v3/features' });
  app.log.info('[V3.0] Feature Store V3 routes registered');
  
  // P2.2 - Labels
  await app.register(labelRoutes, { prefix: '/api/v2/labels' });
  app.log.info('[P2.2] Label routes registered');
  
  // P2.3 - Datasets
  await app.register(datasetRoutes, { prefix: '/api/v2/datasets' });
  app.log.info('[P2.3] Dataset routes registered');

  // ========== P3 - ML INFERENCE ==========
  
  // P3.0/P3.1 - ML Inference (Actor + Market prediction)
  await app.register(mlInferenceRoutes, { prefix: '/api/v2/ml' });
  app.log.info('[P3.0] ML Inference routes registered');
  
  // P3.2 - Signal Ensemble (Combined market signal)
  await app.register(signalEnsembleRoutes, { prefix: '/api/v2/signals/market' });
  app.log.info('[P3.2] Signal Ensemble routes registered');

  // P3.3 - KNG Topology (Actor ranking & Market structure)
  await app.register(topologyRoutes, { prefix: '/api/v2/topology' });
  app.log.info('[P3.3] KNG Topology routes registered');

  // ========== P0.2a - PRICE & PROVIDER LAYER ==========
  
  // P0.2a - Price Service, Provider Pool, Token Universe
  await app.register(priceRoutes, { prefix: '/api/v2/price' });
  app.log.info('[P0.2a] Price & Provider Layer routes registered');

  // ========== ADMIN LAYER ==========
  
  // Admin Auth (login, status, users)
  await app.register(adminAuthRoutes, { prefix: '/api/admin' });
  
  // Admin Providers (external API management)
  await app.register(adminProvidersRoutes, { prefix: '/api/admin' });
  
  // Admin ML (ML runtime control)
  await app.register(adminMlRoutes, { prefix: '/api/admin' });
  
  // Admin Health (dashboard, logs)
  await app.register(adminHealthRoutes, { prefix: '/api/admin' });
  
  // Admin System Overview (ЭТАП 1)
  await app.register(adminSystemRoutes, { prefix: '/api/admin' });
  
  // Admin Data Pipelines (ЭТАП 2)
  await app.register(adminPipelinesRoutes, { prefix: '/api/admin' });
  
  // Admin Settings (ЭТАП 3 - Settings → Admin Migration)
  await app.register(adminSettingsRoutes, { prefix: '/api/admin' });
  
  // Admin Backtest (ЭТАП 4 - Backtesting UI)
  await app.register(adminBacktestRoutes, { prefix: '/api/admin' });
  
  // Admin ML Validation (ML v2.1 - Self-Learning)
  // TEMPORARILY DISABLED due to timeout issue
  // TODO: Fix adminMLValidationRoutes blocking startup
  // await app.register(adminMLValidationRoutes, { prefix: '/api/admin' });
  
  // STEP 0.5 - Admin Performance Layer
  await app.register(adminStateRoutes, { prefix: '/api/admin' });
  await app.register(adminMetricsRoutes, { prefix: '/api/admin' });
  await registerAdminWebSocket(app);
  
  // BATCH 1 - ML Retrain Queue & Model Registry
  await app.register(adminMlRetrainRoutes, { prefix: '/api/admin' });
  await app.register(adminMlModelsRoutes, { prefix: '/api/admin' });
  app.log.info('[BATCH 1] ML Retrain & Model Registry routes registered');
  
  // BATCH 3 - Shadow Inference & Evaluation
  await app.register(adminMlShadowRoutes, { prefix: '/api/admin' });
  app.log.info('[BATCH 3] Shadow Evaluation routes registered');
  
  // BATCH 4 - Promotion & Rollback
  await app.register(adminMlPromotionRoutes, { prefix: '/api/admin' });
  app.log.info('[BATCH 4] Promotion & Rollback routes registered');
  
  // ML v2.2 - Auto-Retrain Policy
  await app.register(adminMlAutoRetrainRoutes, { prefix: '/api/admin' });
  app.log.info('[v2.2] Auto-Retrain Policy routes registered');
  
  // ML v2.3 - Feature Pruning + Sample Weighting
  await app.register(adminMlV23Routes, { prefix: '' });
  app.log.info('[v2.3] Feature Pruning + Sample Weighting routes registered');
  
  // ML Governance - Human-in-the-loop Approvals
  await app.register(adminMlGovernanceRoutes, { prefix: '' });
  app.log.info('[Governance] ML Approvals routes registered');
  
  // V3.0 B4 - ML V3 Dataset Builder
  await app.register(mlV3Routes, { prefix: '/api/admin/ml/v3' });
  app.log.info('[V3.0 B4] ML V3 Dataset Builder routes registered');
  
  // ========== D3 - DEX INDEXER CONTROL PANEL ==========
  
  // D3 - Admin control panel for DEX indexer
  await app.register(adminIndexerRoutes, { prefix: '/api' });
  app.log.info('[D3] DEX Indexer Admin routes registered');
  
  // ========== U1.1 - SIGNAL DRIVERS (USER-FACING PRODUCT LAYER) ==========
  
  // Signal Drivers - A–F user-facing signals
  await app.register(signalDriversRoutes, { prefix: '/api/v3/signals' });
  app.log.info('[U1.1] Signal Drivers routes registered');
  
  // ========== S1 - STRATEGY LAYER (USER-FACING STRATEGY ENGINE) ==========
  
  // Strategy evaluation and catalog
  await app.register(strategyRoutes, { prefix: '/api/v3/strategy' });
  app.log.info('[S1] Strategy routes registered');
  
  // ========== S5.6.H - REPLAY ==========
  
  // Historical Replay routes
  const { registerReplayRoutes } = await import('../modules/replay/replay.routes.js');
  await registerReplayRoutes(app);
  app.log.info('[S5.6.H] Historical Replay routes registered');
  
  // ========== S6 - OBSERVATION MODEL ==========
  
  // S6.1 - Observation Dataset (read-only, no ML)
  const { registerObservationRoutes } = await import('../modules/observation/observation.routes.js');
  await registerObservationRoutes(app);
  app.log.info('[S6.1] Observation Dataset routes registered');
  
  // S6.5 - ObservationModel v1 (ML layer)
  const { registerObservationMLRoutes } = await import('../modules/observation-ml/observation-ml.routes.js');
  await registerObservationMLRoutes(app);
  app.log.info('[S6.5] ObservationModel ML routes registered');
  
  // S7 - Onchain Validation Layer
  const { registerOnchainValidationRoutes } = await import('../modules/onchain-validation/onchain-validation.routes.js');
  await registerOnchainValidationRoutes(app);
  app.log.info('[S7] Onchain Validation Layer routes registered');
  
  // NOTE: S8/S10.8 Meta-Brain routes are registered in app.ts to avoid duplication
  
  // ========== BLOCKS 2.4-2.7 — MARKET ALTS ==========
  
  const { 
    registerAltCandidatesRoutes, 
    registerAdminAltLearningRoutes,
    registerAltPatternsRoutes,
    altCandidatesService,
    altPredictionsService,
    altOutcomeTrackerService,
    altLearningSamplesService,
    altPatternClustererService
  } = await import('../modules/market/alts/index.js');
  
  // Initialize services with MongoDB
  const db = (app as any).mongo?.db;
  if (db) {
    altCandidatesService.init(db);
    altPredictionsService.init(db);
    altOutcomeTrackerService.init(db);
    altLearningSamplesService.init(db);
    altPatternClustererService.init(db);
    app.log.info('[Market Alts] Services initialized with MongoDB');
  }
  
  await registerAltCandidatesRoutes(app);
  await registerAdminAltLearningRoutes(app);
  await registerAltPatternsRoutes(app);
  app.log.info('[Market Alts] Routes registered (Blocks 2.4-2.7)');
  
  app.log.info('[Admin] All admin routes registered (incl. STEP 0.5 Performance Layer)');

  app.log.info('Routes registered');
}
