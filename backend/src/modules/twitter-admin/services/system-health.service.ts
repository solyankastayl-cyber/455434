/**
 * A.3.4 - System Health Service
 * 
 * Provides system-wide health metrics and monitoring
 */

import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../../twitter-user/models/twitter-session.model.js';
import { UserTwitterParseTaskModel } from '../../twitter-user/models/twitter-parse-task.model.js';
import { AdminEventLogModel, AdminEventType } from '../models/admin-event-log.model.js';
import { SystemTelegramEvents } from '../../telegram/system-telegram.notifier.js';
import { parserHealthMonitor } from '../../telegram/parser-health-monitor.js';
import axios from 'axios';

export type UserHealthStatus = 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'BLOCKED';

export interface SystemOverview {
  users: {
    total: number;
    active: number;
    disabled: number;
  };
  accounts: {
    total: number;
    active: number;
    suspended: number;
  };
  sessions: {
    total: number;
    ok: number;
    stale: number;
    invalid: number;
  };
  tasks: {
    last1h: number;
    abortRatePct: number;
  };
}

export interface SessionHealth {
  userId: string;
  accountId: string;
  twitter: string;
  status: string;
  riskScore: number;
  lastAbortAt?: Date;
  lastSyncAt?: Date;
  tasks24h: number;
}

export interface UserHealth {
  userId: string;
  health: UserHealthStatus;
  accounts: number;
  sessions: {
    ok: number;
    stale: number;
    invalid: number;
  };
  abortRatePct: number;
  cooldowns24h: number;
  parsingEnabled: boolean;
}

export interface ParserHealth {
  status: 'UP' | 'DOWN' | 'UNKNOWN';
  uptimeSec?: number;
  tasksRunning?: number;
  avgLatencyMs?: number;
  lastError?: string;
}

export class SystemHealthService {
  
  /**
   * Get system overview metrics
   */
  async getSystemOverview(): Promise<SystemOverview> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Users count (assuming User model exists, fallback to distinct from accounts)
    const totalUsers = await UserTwitterAccountModel.distinct('ownerUserId').then(arr => arr.length);
    const disabledUsers = 0; // Will be implemented when User model has parsingEnabled field
    const activeUsers = totalUsers - disabledUsers;
    
    // Accounts
    const accountsAgg = await UserTwitterAccountModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    
    let totalAccounts = 0;
    let activeAccounts = 0;
    let suspendedAccounts = 0;
    
    for (const a of accountsAgg) {
      totalAccounts += a.count;
      if (a._id === 'ACTIVE') activeAccounts = a.count;
      if (a._id === 'SUSPENDED') suspendedAccounts = a.count;
    }
    
    // Sessions
    const sessionsAgg = await UserTwitterSessionModel.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    
    let totalSessions = 0;
    let okSessions = 0;
    let staleSessions = 0;
    let invalidSessions = 0;
    
    for (const s of sessionsAgg) {
      totalSessions += s.count;
      if (s._id === 'OK') okSessions = s.count;
      if (s._id === 'STALE') staleSessions = s.count;
      if (s._id === 'INVALID') invalidSessions = s.count;
    }
    
    // Tasks last 1h
    const tasksLast1h = await UserTwitterParseTaskModel.countDocuments({
      createdAt: { $gte: oneHourAgo },
    });
    
    // Abort rate
    const failedTasks = await UserTwitterParseTaskModel.countDocuments({
      createdAt: { $gte: oneHourAgo },
      status: { $in: ['FAILED', 'PARTIAL'] },
    });
    
    const abortRatePct = tasksLast1h > 0 
      ? Math.round((failedTasks / tasksLast1h) * 100) 
      : 0;
    
    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        disabled: disabledUsers,
      },
      accounts: {
        total: totalAccounts,
        active: activeAccounts,
        suspended: suspendedAccounts,
      },
      sessions: {
        total: totalSessions,
        ok: okSessions,
        stale: staleSessions,
        invalid: invalidSessions,
      },
      tasks: {
        last1h: tasksLast1h,
        abortRatePct,
      },
    };
  }
  
  /**
   * Get problematic sessions
   */
  async getProblemSessions(
    status?: string,
    limit = 50,
    sort = 'risk'
  ): Promise<SessionHealth[]> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const match: any = { isActive: true };
    if (status) match.status = status;
    
    const sessions = await UserTwitterSessionModel.find(match)
      .sort(
        sort === 'risk' ? { riskScore: -1 } :
        sort === 'abort' ? { lastAbortAt: -1 } :
        { lastSyncAt: 1 }
      )
      .limit(limit)
      .lean();
    
    const result: SessionHealth[] = [];
    
    for (const session of sessions) {
      // Get account info
      const account = await UserTwitterAccountModel.findById(session.accountId).lean();
      if (!account) continue;
      
      // Count tasks for this session in last 24h
      const tasks24h = await UserTwitterParseTaskModel.countDocuments({
        ownerUserId: session.ownerUserId,
        accountId: session.accountId,
        createdAt: { $gte: oneDayAgo },
      });
      
      result.push({
        userId: session.ownerUserId,
        accountId: session.accountId.toString(),
        twitter: account.username || account.handle || 'unknown',
        status: session.status,
        riskScore: session.riskScore || 0,
        lastAbortAt: session.lastAbortAt,
        lastSyncAt: session.lastSyncAt,
        tasks24h,
      });
    }
    
    return result;
  }
  
  /**
   * Get users health status
   */
  async getUsersHealth(limit = 50, sortBy = 'health'): Promise<UserHealth[]> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get all users with accounts
    const userIds = await UserTwitterAccountModel.distinct('ownerUserId');
    
    const result: UserHealth[] = [];
    
    for (const userId of userIds) {
      // Count accounts
      const accountsCount = await UserTwitterAccountModel.countDocuments({
        ownerUserId: userId,
      });
      
      // Sessions breakdown
      const sessionsAgg = await UserTwitterSessionModel.aggregate([
        { $match: { ownerUserId: userId, isActive: true } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      
      const sessions = {
        ok: 0,
        stale: 0,
        invalid: 0,
      };
      
      for (const s of sessionsAgg) {
        if (s._id === 'OK') sessions.ok = s.count;
        if (s._id === 'STALE') sessions.stale = s.count;
        if (s._id === 'INVALID') sessions.invalid = s.count;
      }
      
      // Abort rate 24h
      const totalTasks = await UserTwitterParseTaskModel.countDocuments({
        ownerUserId: userId,
        createdAt: { $gte: oneDayAgo },
      });
      
      const failedTasks = await UserTwitterParseTaskModel.countDocuments({
        ownerUserId: userId,
        createdAt: { $gte: oneDayAgo },
        status: { $in: ['FAILED', 'PARTIAL'] },
      });
      
      const abortRatePct = totalTasks > 0
        ? Math.round((failedTasks / totalTasks) * 100)
        : 0;
      
      // Cooldowns (from PolicyViolationLog if available)
      const cooldowns24h = 0; // TODO: query PolicyViolationLogModel
      
      // Parsing enabled (placeholder)
      const parsingEnabled = true;
      
      // Classify health
      const health = this.classifyUserHealth(
        sessions,
        abortRatePct,
        cooldowns24h,
        parsingEnabled
      );
      
      result.push({
        userId,
        health,
        accounts: accountsCount,
        sessions,
        abortRatePct,
        cooldowns24h,
        parsingEnabled,
      });
    }
    
    // Sort
    if (sortBy === 'health') {
      const healthOrder = { BLOCKED: 0, DEGRADED: 1, WARNING: 2, HEALTHY: 3 };
      result.sort((a, b) => healthOrder[a.health] - healthOrder[b.health]);
    }
    
    return result.slice(0, limit);
  }
  
  /**
   * Classify user health status
   */
  private classifyUserHealth(
    sessions: { ok: number; stale: number; invalid: number },
    abortRatePct: number,
    cooldowns24h: number,
    parsingEnabled: boolean
  ): UserHealthStatus {
    if (!parsingEnabled) return 'BLOCKED';
    if (sessions.invalid > 0 || cooldowns24h >= 2) return 'DEGRADED';
    if (sessions.stale > 0 || abortRatePct >= 30) return 'WARNING';
    return 'HEALTHY';
  }
  
  /**
   * Get parser health
   */
  async getParserHealth(): Promise<ParserHealth> {
    try {
      const response = await axios.get('http://localhost:5001/health', {
        timeout: 2500,
      });
      
      if (response.status === 200) {
        const data = response.data;
        
        // Record success
        parserHealthMonitor.recordSuccess();
        
        return {
          status: 'UP',
          uptimeSec: data.uptime || data.uptimeSec,
          tasksRunning: data.tasksRunning,
          avgLatencyMs: data.avgLatencyMs,
        };
      }
      
      // Record failure
      const error = `Unexpected status: ${response.status}`;
      parserHealthMonitor.recordFailure(error);
      
      return {
        status: 'UNKNOWN',
        lastError: error,
      };
    } catch (err: any) {
      const error = err.message || 'Connection failed';
      
      // Record failure
      parserHealthMonitor.recordFailure(error);
      
      return {
        status: 'DOWN',
        lastError: error,
      };
    }
  }
  
  /**
   * Get admin events feed
   */
  async getAdminEvents(limit = 50, eventType?: AdminEventType): Promise<any[]> {
    const filter: any = {};
    if (eventType) filter.eventType = eventType;
    
    const events = await AdminEventLogModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return events.map(e => ({
      id: e._id.toString(),
      type: e.eventType,
      userId: e.userId,
      details: e.details,
      createdAt: e.createdAt,
    }));
  }
  
  /**
   * Get admin events with advanced filtering
   */
  async getAdminEventsFiltered(options: {
    limit?: number;
    type?: AdminEventType;
    category?: 'SYSTEM' | 'POLICY' | 'USER';
    userId?: string;
    from?: Date;
    to?: Date;
  }): Promise<any[]> {
    const { limit = 50, type, category, userId, from, to } = options;
    
    const filter: any = {};
    
    // Filter by event type
    if (type) {
      filter.eventType = type;
    }
    
    // Filter by category (group of event types)
    if (category) {
      const categoryTypeMap: Record<string, string[]> = {
        SYSTEM: [
          'PARSER_DOWN',
          'PARSER_UP',
          'SESSION_INVALIDATED',
        ],
        POLICY: [
          'POLICY_VIOLATION',
          'USER_DISABLED_BY_POLICY',
          'USER_ENABLED_BY_ADMIN',
          'COOLDOWN_APPLIED',
        ],
        USER: [
          'USER_CREATED_TWITTER_ACCOUNT',
          'USER_SYNCED_SESSION',
        ],
      };
      
      const categoryTypes = categoryTypeMap[category];
      if (categoryTypes && categoryTypes.length > 0) {
        filter.eventType = { $in: categoryTypes };
      }
    }
    
    // Filter by user ID
    if (userId) {
      filter.userId = userId;
    }
    
    // Filter by date range
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }
    
    const events = await AdminEventLogModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return events.map(e => ({
      id: e._id.toString(),
      type: e.eventType,
      category: this.getEventCategory(e.eventType as AdminEventType),
      userId: e.userId,
      details: e.details,
      createdAt: e.createdAt,
    }));
  }
  
  /**
   * Helper to determine event category
   */
  private getEventCategory(eventType: AdminEventType): string {
    const systemTypes = [
      'PARSER_DOWN',
      'PARSER_UP',
      'SESSION_INVALIDATED',
    ];
    
    const policyTypes = [
      'POLICY_VIOLATION',
      'USER_DISABLED_BY_POLICY',
      'USER_ENABLED_BY_ADMIN',
      'COOLDOWN_APPLIED',
    ];
    
    if (systemTypes.includes(eventType)) return 'SYSTEM';
    if (policyTypes.includes(eventType)) return 'POLICY';
    return 'USER';
  }
}
