/**
 * Ingestion Control Module (P0.1)
 * 
 * Production hardening for multi-chain ingestion:
 * - Chain sync state tracking
 * - Deterministic block windows
 * - RPC budget & backpressure
 * - Replay guard (idempotency)
 * - Health monitoring
 * - System alerts
 */

// Models
export * from './chain_sync_state.model.js';
export * from './replay_guard.model.js';

// Services
export * as SyncState from './chain_sync_state.service.js';
export * as BlockWindow from './block_window.service.js';
export * as RpcBudget from './rpc_budget_manager.js';
export * as ReplayGuard from './replay_guard.service.js';
export * as Orchestrator from './ingestion_orchestrator.service.js';
export * as IngestionHealth from './ingestion_health.service.js';
export * as SystemAlerts from './system_alerts.service.js';

// Routes
export { default as ingestionControlRoutes } from './ingestion_control.routes.js';
