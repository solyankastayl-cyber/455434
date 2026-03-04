/**
 * Ingestion Health Service (P0.1)
 * 
 * Calculates health metrics and triggers system alerts.
 */

import * as SyncState from './chain_sync_state.service.js';
import * as ReplayGuard from './replay_guard.service.js';
import * as RpcBudget from './rpc_budget_manager.js';
import { IChainSyncState, SUPPORTED_CHAINS } from './chain_sync_state.model.js';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Lag thresholds
  LAG_WARNING: 50,
  LAG_CRITICAL: 200,
  
  // Time thresholds
  NO_EVENTS_WARNING_MS: 5 * 60 * 1000,   // 5 minutes
  NO_EVENTS_CRITICAL_MS: 15 * 60 * 1000, // 15 minutes
  
  // Error thresholds
  ERROR_RATE_WARNING: 0.1,   // 10%
  ERROR_RATE_CRITICAL: 0.25  // 25%
};

// ============================================
// Types
// ============================================

export type HealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export interface ChainHealth {
  chain: string;
  status: HealthStatus;
  lag: number;
  lastSyncedAt?: Date;
  minutesSinceSync: number;
  errorRate: number;
  issues: string[];
}

export interface IngestionHealth {
  overall: HealthStatus;
  timestamp: Date;
  chains: Record<string, ChainHealth>;
  summary: {
    healthy: number;
    warning: number;
    critical: number;
    unknown: number;
    totalLag: number;
    avgLag: number;
  };
  alerts: Array<{
    severity: 'WARNING' | 'CRITICAL';
    chain?: string;
    message: string;
    metric: string;
    value: number | string;
  }>;
}

// ============================================
// Health Calculation
// ============================================

/**
 * Calculate health for a single chain
 */
function calculateChainHealth(state: IChainSyncState): ChainHealth {
  const issues: string[] = [];
  let status: HealthStatus = 'HEALTHY';
  
  // Calculate lag
  const lag = SyncState.calculateLag(state);
  
  // Calculate time since last sync
  const lastSyncedAt = state.lastSuccessAt;
  const minutesSinceSync = lastSyncedAt 
    ? Math.floor((Date.now() - lastSyncedAt.getTime()) / 60000)
    : -1;
  
  // Calculate error rate (simplified - use consecutive errors as proxy)
  const errorRate = state.consecutiveErrors / 10; // Normalize
  
  // Check status
  if (state.status === 'PAUSED') {
    status = 'WARNING';
    issues.push(`Chain paused: ${state.pauseReason || 'unknown reason'}`);
  }
  
  if (state.status === 'ERROR') {
    status = 'CRITICAL';
    issues.push(`Chain in error state`);
  }
  
  // Check lag
  if (lag >= CONFIG.LAG_CRITICAL) {
    status = 'CRITICAL';
    issues.push(`Critical lag: ${lag} blocks behind`);
  } else if (lag >= CONFIG.LAG_WARNING) {
    if (status !== 'CRITICAL') status = 'WARNING';
    issues.push(`High lag: ${lag} blocks behind`);
  }
  
  // Check time since sync
  if (minutesSinceSync > 0) {
    const msSinceSync = minutesSinceSync * 60000;
    if (msSinceSync >= CONFIG.NO_EVENTS_CRITICAL_MS) {
      status = 'CRITICAL';
      issues.push(`No sync for ${minutesSinceSync} minutes`);
    } else if (msSinceSync >= CONFIG.NO_EVENTS_WARNING_MS) {
      if (status !== 'CRITICAL') status = 'WARNING';
      issues.push(`No sync for ${minutesSinceSync} minutes`);
    }
  }
  
  // Check errors
  if (errorRate >= CONFIG.ERROR_RATE_CRITICAL) {
    status = 'CRITICAL';
    issues.push(`High error rate: ${Math.round(errorRate * 100)}%`);
  } else if (errorRate >= CONFIG.ERROR_RATE_WARNING) {
    if (status !== 'CRITICAL') status = 'WARNING';
    issues.push(`Elevated error rate: ${Math.round(errorRate * 100)}%`);
  }
  
  return {
    chain: state.chain,
    status,
    lag,
    lastSyncedAt,
    minutesSinceSync,
    errorRate,
    issues
  };
}

/**
 * Calculate overall ingestion health
 */
export async function calculateHealth(): Promise<IngestionHealth> {
  const chainStates = await SyncState.getAllChainStates();
  
  const chains: Record<string, ChainHealth> = {};
  const alerts: IngestionHealth['alerts'] = [];
  
  let healthy = 0;
  let warning = 0;
  let critical = 0;
  let unknown = 0;
  let totalLag = 0;
  
  // Calculate health for each chain
  for (const chain of SUPPORTED_CHAINS) {
    const state = chainStates.find(s => s.chain === chain);
    
    if (!state) {
      chains[chain] = {
        chain,
        status: 'UNKNOWN',
        lag: 0,
        minutesSinceSync: -1,
        errorRate: 0,
        issues: ['Chain not initialized']
      };
      unknown++;
      continue;
    }
    
    const health = calculateChainHealth(state);
    chains[chain] = health;
    totalLag += health.lag;
    
    // Count statuses
    switch (health.status) {
      case 'HEALTHY': healthy++; break;
      case 'WARNING': warning++; break;
      case 'CRITICAL': critical++; break;
      default: unknown++;
    }
    
    // Generate alerts for issues
    for (const issue of health.issues) {
      alerts.push({
        severity: health.status === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
        chain: health.chain,
        message: issue,
        metric: 'chain_health',
        value: health.status
      });
    }
  }
  
  // Calculate overall status
  let overall: HealthStatus = 'HEALTHY';
  if (critical > 0) {
    overall = 'CRITICAL';
  } else if (warning > 0) {
    overall = 'WARNING';
  } else if (unknown === SUPPORTED_CHAINS.length) {
    overall = 'UNKNOWN';
  }
  
  const avgLag = SUPPORTED_CHAINS.length > 0 
    ? Math.round(totalLag / SUPPORTED_CHAINS.length) 
    : 0;
  
  return {
    overall,
    timestamp: new Date(),
    chains,
    summary: {
      healthy,
      warning,
      critical,
      unknown,
      totalLag,
      avgLag
    },
    alerts
  };
}

/**
 * Get simplified health status
 */
export async function getHealthStatus(): Promise<{
  status: HealthStatus;
  chains: Record<string, HealthStatus>;
  metrics: {
    totalLag: number;
    pausedChains: number;
    errorChains: number;
  };
}> {
  const health = await calculateHealth();
  
  const chainStatuses: Record<string, HealthStatus> = {};
  for (const [chain, h] of Object.entries(health.chains)) {
    chainStatuses[chain] = h.status;
  }
  
  return {
    status: health.overall,
    chains: chainStatuses,
    metrics: {
      totalLag: health.summary.totalLag,
      pausedChains: Object.values(health.chains).filter(h => h.issues.some(i => i.includes('paused'))).length,
      errorChains: health.summary.critical
    }
  };
}

/**
 * Check if system is healthy enough for operations
 */
export async function isHealthyForOperations(): Promise<{ healthy: boolean; reason?: string }> {
  const health = await getHealthStatus();
  
  if (health.status === 'CRITICAL') {
    return { healthy: false, reason: 'System in critical state' };
  }
  
  if (health.metrics.errorChains >= SUPPORTED_CHAINS.length / 2) {
    return { healthy: false, reason: 'Too many chains in error state' };
  }
  
  return { healthy: true };
}
