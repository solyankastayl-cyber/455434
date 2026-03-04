/**
 * BLOCK 47 — Guard Service
 * Main orchestration for guard checks and state management
 */

import {
  GuardContext,
  GuardDecision,
  GovernanceMode,
  GuardCheckRequest,
  GuardCheckResponse,
  GuardOverrideRequest,
  GuardState,
  HealthLevel,
  ReliabilityBadge,
} from './guard.types.js';
import { evaluateGuard } from './catastrophic.guard.js';
import {
  getGuardState,
  updateGuardState,
  logGuardDecision,
  getGuardHistory,
  IGuardDecisionLog,
} from './guard.store.js';

// ═══════════════════════════════════════════════════════════════
// BUILD CONTEXT FROM EXISTING DATA
// ═══════════════════════════════════════════════════════════════

/**
 * Build GuardContext from telemetry, reliability, and other sources
 * This pulls from existing BLOCK 45/46 endpoints
 */
export async function buildGuardContext(
  symbol: string,
  asOf?: number
): Promise<GuardContext> {
  // Get current guard state
  const guardState = await getGuardState(symbol);
  
  // TODO: In production, pull from actual telemetry/status endpoints
  // For now, build a reasonable default context
  // This should be wired to actual data sources:
  // - GET /api/fractal/v2.1/admin/telemetry/health
  // - GET /api/fractal/v2.1/admin/status
  // - MC evidence snapshots
  // - Calibration status
  
  const ctx: GuardContext = {
    symbol,
    asOf: asOf || Date.now(),
    
    governanceMode: guardState.mode as GovernanceMode,
    latchUntil: guardState.latchUntil,
    
    // Default values - should be replaced with real data
    health: 'HEALTHY' as HealthLevel,
    healthStreak: guardState.consecutiveHealthyDays,
    
    reliability: {
      score: 0.75,
      badge: 'OK' as ReliabilityBadge,
      delta7d: 0,
    },
    
    drift: {
      score: 0.1,
      badge: 'OK' as ReliabilityBadge,
    },
    
    calibration: {
      badge: 'OK' as ReliabilityBadge,
      ece: 0.05,
      brier: 0.15,
      eceDelta30d: 0,
    },
    
    tailRisk: {
      p95MaxDD: 0.25,
      worstDD: 0.35,
      medianDD: 0.15,
      p95Delta30d: 0,
    },
    
    perfWindows: {
      sharpe30d: 0.5,
      sharpe60d: 0.4,
      maxDD60d: 0.12,
      hitRate30d: 0.55,
    },
    
    entropy: {
      ema: 0.3,
      dominance: 0.7,
      minScaleTriggeredCount: 0,
    },
    
    effectiveN: {
      current: 25,
      delta7d: 0,
    },
  };
  
  return ctx;
}

/**
 * Inject real telemetry data into context
 */
export function injectTelemetryIntoContext(
  ctx: GuardContext,
  telemetry: {
    health?: HealthLevel;
    reliability?: { score: number; badge: ReliabilityBadge; delta7d?: number };
    drift?: { score: number; badge: ReliabilityBadge };
    calibration?: { badge: ReliabilityBadge; ece?: number; brier?: number };
    tailRisk?: { p95MaxDD?: number; worstDD?: number; medianDD?: number };
    perfWindows?: { sharpe60d?: number; maxDD60d?: number };
  }
): GuardContext {
  if (telemetry.health) ctx.health = telemetry.health;
  if (telemetry.reliability) {
    ctx.reliability = { ...ctx.reliability, ...telemetry.reliability };
  }
  if (telemetry.drift) {
    ctx.drift = { ...ctx.drift, ...telemetry.drift };
  }
  if (telemetry.calibration) {
    ctx.calibration = { ...ctx.calibration, ...telemetry.calibration };
  }
  if (telemetry.tailRisk) {
    ctx.tailRisk = { ...ctx.tailRisk, ...telemetry.tailRisk };
  }
  if (telemetry.perfWindows) {
    ctx.perfWindows = { ...ctx.perfWindows, ...telemetry.perfWindows };
  }
  
  return ctx;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /admin/guard/check
 * Evaluate guard and optionally apply
 */
export async function checkGuard(
  request: GuardCheckRequest
): Promise<GuardCheckResponse> {
  const symbol = request.symbol || 'BTC';
  
  // Build context
  const ctx = await buildGuardContext(symbol, request.asOf);
  
  // Evaluate
  const decision = evaluateGuard(ctx);
  
  // Get current state
  const state = await getGuardState(symbol);
  
  // Apply if requested
  let applied = false;
  if (request.apply && request.allowAutoProtection && decision.wouldChange) {
    await updateGuardState(symbol, {
      mode: decision.recommendedMode,
      latchUntil: decision.latchUntil,
      lastDecision: decision,
    }, 'SYSTEM');
    applied = true;
  }
  
  // Log decision
  await logGuardDecision(symbol, decision, applied, 'SYSTEM');
  
  // Get updated state
  const updatedState = await getGuardState(symbol);
  
  return {
    ok: true,
    decision,
    applied,
    state: {
      mode: updatedState.mode as GovernanceMode,
      latchUntil: updatedState.latchUntil,
      lastDecision: updatedState.lastDecision,
      lastUpdated: updatedState.lastUpdated,
      updatedBy: updatedState.updatedBy as 'SYSTEM' | 'ADMIN',
    },
  };
}

/**
 * GET /admin/guard/status
 * Get current guard state
 */
export async function getGuardStatus(symbol: string): Promise<GuardState & { symbol: string }> {
  const state = await getGuardState(symbol);
  
  return {
    symbol: state.symbol,
    mode: state.mode as GovernanceMode,
    latchUntil: state.latchUntil,
    lastDecision: state.lastDecision,
    lastUpdated: state.lastUpdated,
    updatedBy: state.updatedBy as 'SYSTEM' | 'ADMIN',
  };
}

/**
 * POST /admin/guard/override
 * Manually set mode (admin action)
 */
export async function overrideGuardMode(
  symbol: string,
  request: GuardOverrideRequest
): Promise<{ ok: boolean; state: GuardState }> {
  // Create a synthetic decision for the override
  const decision: GuardDecision = {
    recommendedMode: request.mode,
    currentMode: (await getGuardState(symbol)).mode as GovernanceMode,
    reasons: [],
    degenerationScore: 0,
    catastrophicTriggered: false,
    latchUntil: null,
    confidence: 1.0,
    timestamp: Date.now(),
    wouldChange: true,
  };
  
  // Update state
  await updateGuardState(symbol, {
    mode: request.mode,
    latchUntil: null, // Admin override clears latch
    lastDecision: decision,
  }, 'ADMIN');
  
  // Log
  await logGuardDecision(symbol, decision, true, 'ADMIN', request.reason);
  
  const state = await getGuardState(symbol);
  
  return {
    ok: true,
    state: {
      mode: state.mode as GovernanceMode,
      latchUntil: state.latchUntil,
      lastDecision: state.lastDecision,
      lastUpdated: state.lastUpdated,
      updatedBy: state.updatedBy as 'SYSTEM' | 'ADMIN',
    },
  };
}

/**
 * GET /admin/guard/history
 * Get guard decision history
 */
export async function getGuardDecisionHistory(
  symbol: string,
  options: { from?: number; to?: number; limit?: number } = {}
): Promise<{ ok: boolean; history: IGuardDecisionLog[] }> {
  const history = await getGuardHistory(symbol, options);
  
  return {
    ok: true,
    history,
  };
}
