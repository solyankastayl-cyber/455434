/**
 * Y1 — Exchange Admin Service
 * ============================
 * 
 * Business logic for Exchange Admin Control Plane.
 */

import {
  ProviderAdminDTO,
  ProviderPatchDTO,
  ProviderTestResult,
  JobAdminDTO,
  JobPatchConfigDTO,
  JobRunResult,
  ExchangeHealthOverview,
  ExchangeAlert,
} from './admin.types.js';

import {
  listProviders,
  getProvider,
  updateProviderConfig,
  resetProviderHealth,
  getRegistryStats,
} from '../providers/provider.registry.js';

import {
  listJobs,
  getJob,
  startJob,
  stopJob,
  patchJobConfig,
  runOnce,
  getJobsStats,
} from '../jobs/jobs.registry.js';

import { ProviderId } from '../providers/exchangeProvider.types.js';

// ═══════════════════════════════════════════════════════════════
// PROVIDER ADMIN OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function adminListProviders(): ProviderAdminDTO[] {
  const providers = listProviders();
  
  return providers.map(entry => ({
    id: entry.provider.id,
    enabled: entry.config.enabled,
    priority: entry.config.priority,
    health: {
      status: entry.health.status,
      errorCount: entry.health.errorStreak,
      lastError: entry.health.notes?.[entry.health.notes.length - 1] ?? null,
      lastOkAt: entry.health.lastOkAt ?? null,
      lastErrorAt: entry.health.lastErrorAt ?? null,
    },
    updatedAt: entry.health.lastOkAt ?? entry.health.lastErrorAt ?? Date.now(),
  }));
}

export function adminGetProvider(id: string): ProviderAdminDTO | null {
  const entry = getProvider(id as ProviderId);
  if (!entry) return null;
  
  return {
    id: entry.provider.id,
    enabled: entry.config.enabled,
    priority: entry.config.priority,
    health: {
      status: entry.health.status,
      errorCount: entry.health.errorStreak,
      lastError: entry.health.notes?.[entry.health.notes.length - 1] ?? null,
      lastOkAt: entry.health.lastOkAt ?? null,
      lastErrorAt: entry.health.lastErrorAt ?? null,
    },
    updatedAt: entry.health.lastOkAt ?? entry.health.lastErrorAt ?? Date.now(),
  };
}

export function adminPatchProvider(
  id: string,
  patch: ProviderPatchDTO
): { ok: boolean; message: string; provider?: ProviderAdminDTO } {
  // Validate priority
  if (patch.priority !== undefined && patch.priority < 0) {
    return { ok: false, message: 'Priority cannot be negative' };
  }
  
  // Validate enabled - must keep at least one provider enabled
  if (patch.enabled === false) {
    const providers = listProviders();
    const enabledCount = providers.filter(p => p.config.enabled).length;
    const isLastEnabled = enabledCount === 1 && getProvider(id as ProviderId)?.config.enabled;
    
    if (isLastEnabled) {
      return { ok: false, message: 'Cannot disable last enabled provider' };
    }
  }
  
  const success = updateProviderConfig(id as ProviderId, patch);
  
  if (!success) {
    return { ok: false, message: `Provider ${id} not found` };
  }
  
  const provider = adminGetProvider(id);
  return { ok: true, message: `Provider ${id} updated`, provider: provider ?? undefined };
}

export async function adminTestProvider(
  id: string,
  params?: { symbol?: string }
): Promise<ProviderTestResult> {
  const symbol = params?.symbol ?? 'BTCUSDT';
  const entry = getProvider(id as ProviderId);
  
  if (!entry) {
    return {
      ok: false,
      providerId: id as ProviderId,
      symbol,
      latencyMs: 0,
      error: `Provider ${id} not found`,
    };
  }
  
  const startTime = Date.now();
  
  try {
    const orderBook = await entry.provider.getOrderBook(symbol, 5);
    const latencyMs = Date.now() - startTime;
    
    return {
      ok: true,
      providerId: entry.provider.id,
      symbol,
      latencyMs,
      sample: {
        mid: orderBook.mid,
        bid: orderBook.bids[0]?.[0],
        ask: orderBook.asks[0]?.[0],
        timestamp: orderBook.t,
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return {
      ok: false,
      providerId: entry.provider.id,
      symbol,
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function adminResetProvider(id: string): { ok: boolean; message: string } {
  const success = resetProviderHealth(id as ProviderId);
  
  if (!success) {
    return { ok: false, message: `Provider ${id} not found` };
  }
  
  return { ok: true, message: `Provider ${id} circuit breaker reset` };
}

// ═══════════════════════════════════════════════════════════════
// JOB ADMIN OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function adminListJobs(): JobAdminDTO[] {
  const jobs = listJobs();
  const defs = ['exchangeTick', 'whaleIngest', 'indicatorCalculation', 'regimeDetection', 'patternDetection', 'observationPersist'];
  
  return jobs.map(job => ({
    id: job.id,
    displayName: job.id.replace(/([A-Z])/g, ' $1').trim(),
    enabled: job.enabled,
    running: job.running,
    status: job.status,
    scheduleMs: job.config.scheduleMs,
    lastRunAt: job.lastRunAt,
    lastRunStatus: job.lastRunStatus,
    lastError: job.lastError,
    config: job.config,
  }));
}

export function adminGetJob(id: string): JobAdminDTO | null {
  const job = getJob(id as any);
  if (!job) return null;
  
  return {
    id: job.id,
    displayName: job.id.replace(/([A-Z])/g, ' $1').trim(),
    enabled: job.enabled,
    running: job.running,
    status: job.status,
    scheduleMs: job.config.scheduleMs,
    lastRunAt: job.lastRunAt,
    lastRunStatus: job.lastRunStatus,
    lastError: job.lastError,
    config: job.config,
  };
}

export function adminStartJob(id: string): { ok: boolean; message: string } {
  return startJob(id as any);
}

export function adminStopJob(id: string): { ok: boolean; message: string } {
  return stopJob(id as any);
}

export function adminPatchJobConfig(
  id: string,
  patch: JobPatchConfigDTO
): { ok: boolean; message: string; config?: any } {
  return patchJobConfig(id as any, patch);
}

export async function adminRunJobOnce(
  id: string,
  params?: { symbol?: string }
): Promise<JobRunResult> {
  const result = await runOnce(id as any, params);
  return {
    ok: result.ok,
    jobId: id as any,
    executionMs: result.executionMs,
    error: result.error,
    result: result.details,
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH OVERVIEW
// ═══════════════════════════════════════════════════════════════

export function getHealthOverview(): ExchangeHealthOverview {
  const providerStats = getRegistryStats();
  const jobStats = getJobsStats();
  const providers = listProviders();
  
  // Determine data mode
  const enabledProviders = providers.filter(p => p.config.enabled);
  const liveProviders = enabledProviders.filter(p => 
    p.provider.id !== 'MOCK' && p.health.status !== 'DOWN'
  );
  const mockOnly = liveProviders.length === 0;
  
  let mode: 'LIVE' | 'MOCK' | 'MIXED' = 'MOCK';
  if (liveProviders.length > 0 && enabledProviders.some(p => p.provider.id === 'MOCK')) {
    mode = 'MIXED';
  } else if (liveProviders.length > 0) {
    mode = 'LIVE';
  }
  
  // Build alerts
  const alerts: ExchangeAlert[] = [];
  
  // Check for DOWN providers
  const downProviders = providers.filter(p => p.health.status === 'DOWN');
  for (const p of downProviders) {
    alerts.push({
      level: 'ERROR',
      code: 'PROVIDER_DOWN',
      message: `Provider ${p.provider.id} is DOWN`,
      timestamp: Date.now(),
    });
  }
  
  // Check for DEGRADED providers
  const degradedProviders = providers.filter(p => p.health.status === 'DEGRADED');
  for (const p of degradedProviders) {
    alerts.push({
      level: 'WARN',
      code: 'PROVIDER_DEGRADED',
      message: `Provider ${p.provider.id} is DEGRADED`,
      timestamp: Date.now(),
    });
  }
  
  // Mock-only warning
  if (mockOnly && enabledProviders.length > 0) {
    alerts.push({
      level: 'WARN',
      code: 'MOCK_FALLBACK',
      message: 'All data is from MOCK provider (simulated)',
      timestamp: Date.now(),
    });
  }
  
  // No providers warning
  if (enabledProviders.length === 0) {
    alerts.push({
      level: 'ERROR',
      code: 'NO_PROVIDERS',
      message: 'No providers enabled',
      timestamp: Date.now(),
    });
  }
  
  // Job errors
  const errorJobs = listJobs().filter(j => j.status === 'ERROR');
  for (const j of errorJobs) {
    alerts.push({
      level: 'WARN',
      code: 'JOB_ERROR',
      message: `Job ${j.id} has errors: ${j.lastError}`,
      timestamp: Date.now(),
    });
  }
  
  return {
    providers: providerStats,
    jobs: jobStats,
    dataStatus: {
      lastSnapshot: Date.now(), // TODO: get from actual last snapshot
      activeSymbols: 5, // TODO: get from config
      mode,
    },
    alerts,
  };
}

console.log('[Y1] Exchange Admin Service loaded');
