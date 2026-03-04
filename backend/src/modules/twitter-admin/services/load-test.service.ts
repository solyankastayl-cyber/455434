/**
 * Stage D: Load Testing Service
 * 
 * Provides load testing capabilities for the parser:
 * - Concurrent request simulation
 * - Performance metrics collection
 * - Abort rate analysis
 * - Latency distribution tracking
 */

import { UserTwitterParseTaskModel } from '../../twitter-user/models/twitter-parse-task.model.js';
import { UserTwitterSessionModel } from '../../twitter-user/models/twitter-session.model.js';
import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';

export interface LoadTestConfig {
  /** Number of concurrent parse requests */
  concurrency: number;
  /** Total number of requests to execute */
  totalRequests: number;
  /** Delay between batches (ms) */
  batchDelayMs: number;
  /** Target user ID (optional, uses all if not set) */
  targetUserId?: string;
  /** Query for search tasks */
  testQuery?: string;
  /** Limit per request */
  limitPerRequest: number;
}

export interface LoadTestResult {
  testId: string;
  config: LoadTestConfig;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  metrics: {
    totalRequests: number;
    successCount: number;
    failedCount: number;
    partialCount: number;
    abortedCount: number;
    successRate: number;
    abortRate: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p90LatencyMs: number;
    p99LatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    totalTweetsFetched: number;
    avgTweetsPerRequest: number;
  };
  errors: Array<{
    taskId: string;
    error: string;
    reason?: string;
  }>;
}

export interface PerformanceSnapshot {
  timestamp: Date;
  window: '1h' | '24h' | '7d';
  tasks: {
    total: number;
    done: number;
    partial: number;
    failed: number;
  };
  performance: {
    successRate: number;
    abortRate: number;
    avgLatencyMs: number;
    avgTweetsPerTask: number;
  };
  sessions: {
    total: number;
    ok: number;
    stale: number;
    invalid: number;
  };
  abortReasons: Record<string, number>;
}

export class LoadTestService {
  
  /**
   * Get performance snapshot for a time window
   */
  async getPerformanceSnapshot(window: '1h' | '24h' | '7d' = '24h'): Promise<PerformanceSnapshot> {
    const now = new Date();
    const windowMs = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    }[window];
    
    const fromDate = new Date(now.getTime() - windowMs);
    
    // Aggregate task stats
    const taskStats = await UserTwitterParseTaskModel.aggregate([
      { $match: { createdAt: { $gte: fromDate } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalFetched: { $sum: '$fetched' },
          totalDuration: { $sum: '$durationMs' },
        },
      },
    ]);
    
    // Aggregate abort reasons
    const abortReasons = await UserTwitterParseTaskModel.aggregate([
      { 
        $match: { 
          createdAt: { $gte: fromDate },
          'engineSummary.aborted': true,
        } 
      },
      {
        $group: {
          _id: '$engineSummary.abortReason',
          count: { $sum: 1 },
        },
      },
    ]);
    
    // Session stats
    const sessionStats = await UserTwitterSessionModel.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    
    // Calculate metrics
    const tasks = {
      total: 0,
      done: 0,
      partial: 0,
      failed: 0,
    };
    
    let totalFetched = 0;
    let totalDuration = 0;
    
    for (const stat of taskStats) {
      tasks.total += stat.count;
      totalFetched += stat.totalFetched || 0;
      totalDuration += stat.totalDuration || 0;
      
      switch (stat._id) {
        case 'DONE':
          tasks.done = stat.count;
          break;
        case 'PARTIAL':
          tasks.partial = stat.count;
          break;
        case 'FAILED':
          tasks.failed = stat.count;
          break;
      }
    }
    
    const sessions = {
      total: 0,
      ok: 0,
      stale: 0,
      invalid: 0,
    };
    
    for (const stat of sessionStats) {
      sessions.total += stat.count;
      switch (stat._id) {
        case 'OK':
          sessions.ok = stat.count;
          break;
        case 'STALE':
          sessions.stale = stat.count;
          break;
        case 'INVALID':
          sessions.invalid = stat.count;
          break;
      }
    }
    
    const abortReasonsMap: Record<string, number> = {};
    for (const reason of abortReasons) {
      abortReasonsMap[reason._id || 'UNKNOWN'] = reason.count;
    }
    
    const completedTasks = tasks.done + tasks.partial + tasks.failed;
    const abortedTasks = tasks.partial + tasks.failed;
    
    return {
      timestamp: now,
      window,
      tasks,
      performance: {
        successRate: completedTasks > 0 ? Math.round((tasks.done / completedTasks) * 100) : 0,
        abortRate: completedTasks > 0 ? Math.round((abortedTasks / completedTasks) * 100) : 0,
        avgLatencyMs: completedTasks > 0 ? Math.round(totalDuration / completedTasks) : 0,
        avgTweetsPerTask: completedTasks > 0 ? Math.round(totalFetched / completedTasks) : 0,
      },
      sessions,
      abortReasons: abortReasonsMap,
    };
  }
  
  /**
   * Get latency distribution for tasks
   */
  async getLatencyDistribution(window: '1h' | '24h' = '24h'): Promise<{
    buckets: Array<{ min: number; max: number; count: number }>;
    percentiles: { p50: number; p90: number; p95: number; p99: number };
  }> {
    const now = new Date();
    const windowMs = window === '1h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const fromDate = new Date(now.getTime() - windowMs);
    
    // Get all completed tasks with duration
    const tasks = await UserTwitterParseTaskModel.find({
      createdAt: { $gte: fromDate },
      status: { $in: ['DONE', 'PARTIAL', 'FAILED'] },
      durationMs: { $exists: true, $gt: 0 },
    })
      .select('durationMs')
      .lean();
    
    if (tasks.length === 0) {
      return {
        buckets: [],
        percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      };
    }
    
    // Sort latencies
    const latencies = tasks.map(t => t.durationMs!).sort((a, b) => a - b);
    
    // Calculate percentiles
    const getPercentile = (arr: number[], p: number) => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };
    
    // Create buckets (0-1s, 1-5s, 5-10s, 10-30s, 30s+)
    const bucketRanges = [
      { min: 0, max: 1000 },
      { min: 1000, max: 5000 },
      { min: 5000, max: 10000 },
      { min: 10000, max: 30000 },
      { min: 30000, max: Infinity },
    ];
    
    const buckets = bucketRanges.map(range => ({
      min: range.min,
      max: range.max === Infinity ? 999999 : range.max,
      count: latencies.filter(l => l >= range.min && l < range.max).length,
    }));
    
    return {
      buckets,
      percentiles: {
        p50: getPercentile(latencies, 50),
        p90: getPercentile(latencies, 90),
        p95: getPercentile(latencies, 95),
        p99: getPercentile(latencies, 99),
      },
    };
  }
  
  /**
   * Get abort analysis
   */
  async getAbortAnalysis(window: '24h' | '7d' = '24h'): Promise<{
    totalAborts: number;
    byReason: Record<string, { count: number; percentage: number }>;
    byHour: Array<{ hour: string; count: number }>;
    affectedUsers: number;
    affectedSessions: number;
  }> {
    const now = new Date();
    const windowMs = window === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const fromDate = new Date(now.getTime() - windowMs);
    
    // Get abort stats
    const abortedTasks = await UserTwitterParseTaskModel.find({
      createdAt: { $gte: fromDate },
      $or: [
        { status: 'FAILED' },
        { 'engineSummary.aborted': true },
      ],
    }).lean();
    
    const totalAborts = abortedTasks.length;
    
    // By reason
    const reasonCounts: Record<string, number> = {};
    const affectedUserIds = new Set<string>();
    const affectedSessionIds = new Set<string>();
    
    for (const task of abortedTasks) {
      const reason = (task.engineSummary as any)?.abortReason || task.error || 'UNKNOWN';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      affectedUserIds.add(task.ownerUserId);
      affectedSessionIds.add(task.sessionId);
    }
    
    const byReason: Record<string, { count: number; percentage: number }> = {};
    for (const [reason, count] of Object.entries(reasonCounts)) {
      byReason[reason] = {
        count,
        percentage: totalAborts > 0 ? Math.round((count / totalAborts) * 100) : 0,
      };
    }
    
    // By hour (for 24h window)
    const hourlyAborts = await UserTwitterParseTaskModel.aggregate([
      {
        $match: {
          createdAt: { $gte: fromDate },
          $or: [
            { status: 'FAILED' },
            { 'engineSummary.aborted': true },
          ],
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    
    const byHour = hourlyAborts.map(h => ({
      hour: h._id,
      count: h.count,
    }));
    
    return {
      totalAborts,
      byReason,
      byHour,
      affectedUsers: affectedUserIds.size,
      affectedSessions: affectedSessionIds.size,
    };
  }
  
  /**
   * Get user-level performance stats
   */
  async getUserPerformanceStats(userId?: string): Promise<Array<{
    userId: string;
    totalTasks: number;
    successRate: number;
    abortRate: number;
    avgLatencyMs: number;
    totalTweetsFetched: number;
    lastTaskAt: Date | null;
  }>> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const match: any = {
      createdAt: { $gte: oneDayAgo },
    };
    
    if (userId) {
      match.ownerUserId = userId;
    }
    
    const stats = await UserTwitterParseTaskModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$ownerUserId',
          totalTasks: { $sum: 1 },
          doneTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] },
          },
          failedTasks: {
            $sum: { $cond: [{ $in: ['$status', ['FAILED', 'PARTIAL']] }, 1, 0] },
          },
          totalDuration: { $sum: '$durationMs' },
          totalFetched: { $sum: '$fetched' },
          lastTaskAt: { $max: '$createdAt' },
        },
      },
      { $sort: { totalTasks: -1 } },
      { $limit: 50 },
    ]);
    
    return stats.map(s => ({
      userId: s._id,
      totalTasks: s.totalTasks,
      successRate: s.totalTasks > 0 ? Math.round((s.doneTasks / s.totalTasks) * 100) : 0,
      abortRate: s.totalTasks > 0 ? Math.round((s.failedTasks / s.totalTasks) * 100) : 0,
      avgLatencyMs: s.totalTasks > 0 ? Math.round(s.totalDuration / s.totalTasks) : 0,
      totalTweetsFetched: s.totalFetched,
      lastTaskAt: s.lastTaskAt,
    }));
  }
  
  /**
   * Get session performance stats
   */
  async getSessionPerformanceStats(): Promise<Array<{
    sessionId: string;
    accountId: string;
    userId: string;
    status: string;
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    lastUsedAt: Date | null;
    riskScore: number;
  }>> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get active sessions
    const sessions = await UserTwitterSessionModel.find({ isActive: true })
      .select('_id accountId ownerUserId status riskScore')
      .lean();
    
    const results = [];
    
    for (const session of sessions) {
      const sessionId = String(session._id);
      
      // Get task stats for this session
      const taskStats = await UserTwitterParseTaskModel.aggregate([
        {
          $match: {
            sessionId,
            createdAt: { $gte: oneDayAgo },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
            totalDuration: { $sum: '$durationMs' },
            lastUsedAt: { $max: '$createdAt' },
          },
        },
      ]);
      
      const stats = taskStats[0] || { total: 0, done: 0, totalDuration: 0, lastUsedAt: null };
      
      results.push({
        sessionId,
        accountId: String(session.accountId),
        userId: session.ownerUserId || '',
        status: session.status,
        taskCount: stats.total,
        successRate: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
        avgLatencyMs: stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : 0,
        lastUsedAt: stats.lastUsedAt,
        riskScore: session.riskScore || 0,
      });
    }
    
    // Sort by task count descending
    return results.sort((a, b) => b.taskCount - a.taskCount);
  }
}

// Singleton
export const loadTestService = new LoadTestService();
