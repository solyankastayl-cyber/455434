/**
 * System Health Service (Option B - B0)
 * 
 * Centralized health monitoring with service checks and metrics.
 * Provides single source of truth for system status.
 */
import mongoose from 'mongoose';
import { BootstrapTaskModel } from '../bootstrap/bootstrap_tasks.model.js';
import { getConnectionStats } from '../websocket/index.js';
import { env } from '../../config/env.js';

// Health thresholds from env (with defaults)
const THRESHOLDS = {
  RPC_P95_MS: parseInt(process.env.HEALTH_RPC_P95_MS || '1500'),
  INDEXER_LAG_BLOCKS: parseInt(process.env.HEALTH_INDEXER_LAG_BLOCKS || '300'),
  BOOTSTRAP_FAILED_PER_10M: parseInt(process.env.HEALTH_BOOTSTRAP_FAILED_PER_10M || '10'),
  WORKER_HEARTBEAT_STALE_SEC: 60,
  DB_LATENCY_WARN_MS: 500,
};

export type ServiceStatus = 'ok' | 'degraded' | 'down';
export type SystemStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ServiceHealth {
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
  [key: string]: any;
}

export interface BootstrapMetrics {
  queued: number;
  active: number;
  failed: number;
  done: number;
  avgDurationSec: number;
  p95DurationSec: number;
  throughputPerHour: number;
}

export interface SystemHealthResponse {
  status: SystemStatus;
  ts: string;
  version: {
    build: string;
    env: string;
  };
  services: {
    db: ServiceHealth;
    rpc: ServiceHealth;
    ws: ServiceHealth;
    bootstrapWorker: ServiceHealth;
  };
  metrics: {
    bootstrap: BootstrapMetrics;
  };
  notes: string[];
}

/**
 * Check database health
 */
async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await mongoose.connection.db?.admin().ping();
    const latencyMs = Date.now() - start;
    
    return {
      status: latencyMs > THRESHOLDS.DB_LATENCY_WARN_MS ? 'degraded' : 'ok',
      latencyMs,
    };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: 'Database connection failed',
    };
  }
}

/**
 * Check RPC health (via last indexer activity or direct check)
 */
async function checkRpc(): Promise<ServiceHealth> {
  // For now, check if we have any recent successful bootstrap tasks
  // In production, this would ping the actual RPC
  try {
    const recentSuccess = await BootstrapTaskModel.countDocuments({
      status: 'done',
      finishedAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
    });
    
    return {
      status: recentSuccess > 0 ? 'ok' : 'degraded',
      provider: env.INFURA_RPC_URL?.includes('llama') ? 'llama' : 'infura',
      recentTasks: recentSuccess,
    };
  } catch {
    return { status: 'down', message: 'RPC check failed' };
  }
}

/**
 * Check WebSocket gateway health
 */
function checkWebSocket(): ServiceHealth {
  try {
    const stats = getConnectionStats();
    return {
      status: 'ok',
      clients: stats.total,
      subscriptions: stats.subscriptions,
    };
  } catch {
    return { status: 'down', message: 'WebSocket stats unavailable' };
  }
}

/**
 * Check bootstrap worker health via heartbeat
 */
async function checkBootstrapWorker(): Promise<ServiceHealth> {
  try {
    // Check for recent worker activity (tasks claimed/done)
    const recentActivity = await BootstrapTaskModel.countDocuments({
      updatedAt: { $gte: new Date(Date.now() - 60 * 1000) },
      status: { $in: ['running', 'done'] },
    });
    
    // Check for stale running tasks (worker might be dead)
    const staleRunning = await BootstrapTaskModel.countDocuments({
      status: 'running',
      updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
    });
    
    if (staleRunning > 0) {
      return {
        status: 'down',
        message: `${staleRunning} stale running tasks`,
        lastActivitySec: null,
      };
    }
    
    return {
      status: recentActivity > 0 ? 'ok' : 'degraded',
      recentActivity,
    };
  } catch {
    return { status: 'down', message: 'Worker check failed' };
  }
}

/**
 * Get bootstrap metrics aggregation
 */
async function getBootstrapMetrics(): Promise<BootstrapMetrics> {
  try {
    const [counts, durationStats, hourlyThroughput] = await Promise.all([
      // Counts by status
      BootstrapTaskModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      
      // Duration stats for completed tasks (last 24h)
      BootstrapTaskModel.aggregate([
        {
          $match: {
            status: 'done',
            startedAt: { $exists: true },
            finishedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        },
        {
          $project: {
            durationMs: { $subtract: ['$finishedAt', '$startedAt'] },
          },
        },
        {
          $group: {
            _id: null,
            avgDurationMs: { $avg: '$durationMs' },
            durations: { $push: '$durationMs' },
          },
        },
      ]),
      
      // Throughput (tasks done in last hour)
      BootstrapTaskModel.countDocuments({
        status: 'done',
        finishedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      }),
    ]);
    
    // Parse counts
    const statusCounts: Record<string, number> = {};
    for (const row of counts) {
      statusCounts[row._id] = row.count;
    }
    
    // Calculate p95 duration
    let avgDurationSec = 0;
    let p95DurationSec = 0;
    
    if (durationStats.length > 0 && durationStats[0].durations?.length > 0) {
      avgDurationSec = Math.round((durationStats[0].avgDurationMs || 0) / 1000);
      
      const sorted = durationStats[0].durations.sort((a: number, b: number) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      p95DurationSec = Math.round((sorted[p95Index] || 0) / 1000);
    }
    
    return {
      queued: statusCounts.queued || 0,
      active: statusCounts.running || 0,
      failed: statusCounts.failed || 0,
      done: statusCounts.done || 0,
      avgDurationSec,
      p95DurationSec,
      throughputPerHour: hourlyThroughput,
    };
  } catch (err) {
    console.error('[Health] Failed to get bootstrap metrics:', err);
    return {
      queued: 0, active: 0, failed: 0, done: 0,
      avgDurationSec: 0, p95DurationSec: 0, throughputPerHour: 0,
    };
  }
}

/**
 * Compute overall system status
 */
function computeSystemStatus(
  services: SystemHealthResponse['services'],
  metrics: SystemHealthResponse['metrics'],
  notes: string[]
): SystemStatus {
  // Unhealthy conditions
  if (services.db.status === 'down') {
    notes.push('Database is down');
    return 'unhealthy';
  }
  if (services.bootstrapWorker.status === 'down') {
    notes.push('Bootstrap worker is down');
    return 'unhealthy';
  }
  
  // Degraded conditions
  if (services.db.status === 'degraded') {
    notes.push('Database latency high');
  }
  if (services.rpc.status === 'degraded') {
    notes.push('RPC connectivity degraded');
  }
  if (services.ws.status === 'degraded') {
    notes.push('WebSocket issues detected');
  }
  if (metrics.bootstrap.failed > THRESHOLDS.BOOTSTRAP_FAILED_PER_10M) {
    notes.push(`High failure rate: ${metrics.bootstrap.failed} failed tasks`);
  }
  
  if (notes.length > 0) {
    return 'degraded';
  }
  
  return 'healthy';
}

/**
 * Get full system health report
 */
export async function getSystemHealth(): Promise<SystemHealthResponse> {
  const notes: string[] = [];
  
  // Run all checks in parallel
  const [db, rpc, bootstrapWorker, metrics] = await Promise.all([
    checkDatabase(),
    checkRpc(),
    checkBootstrapWorker(),
    getBootstrapMetrics(),
  ]);
  
  const ws = checkWebSocket();
  
  const services = { db, rpc, ws, bootstrapWorker };
  
  const status = computeSystemStatus(services, { bootstrap: metrics }, notes);
  
  return {
    status,
    ts: new Date().toISOString(),
    version: {
      build: process.env.BUILD_DATE || '2026-01-17',
      env: env.NODE_ENV,
    },
    services,
    metrics: { bootstrap: metrics },
    notes,
  };
}
