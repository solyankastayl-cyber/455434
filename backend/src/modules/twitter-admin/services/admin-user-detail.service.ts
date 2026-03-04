/**
 * A.3.2 - Admin User Detail Service
 * 
 * Deep view into a specific user:
 * - Accounts list
 * - Sessions list
 * - Parse tasks history
 * - Metrics
 */

import mongoose from 'mongoose';
import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../../twitter-user/models/twitter-session.model.js';
import { UserTwitterParseTaskModel } from '../../twitter-user/models/twitter-parse-task.model.js';
import { TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';
import { AdminActionLogModel, AdminActionType } from '../models/admin-action-log.model.js';

export interface AdminAccountDetail {
  accountId: string;
  username: string;
  enabled: boolean;
  preferred: boolean;
  sessionsCount: {
    ok: number;
    stale: number;
    invalid: number;
  };
  riskAvg: number;
  lastParseAt: Date | null;
  createdAt: Date;
}

export interface AdminSessionDetail {
  sessionId: string;
  accountId: string;
  accountUsername: string;
  status: 'OK' | 'STALE' | 'INVALID';
  riskScore: number;
  isActive: boolean;
  lastSyncAt: Date | null;
  lastAbortAt: Date | null;
  abortCount: number;
  version: number;
  createdAt: Date;
}

export interface AdminTaskDetail {
  taskId: string;
  status: string;
  type: string;
  query?: string;
  fetched: number;
  duration?: number;
  abortReason?: string;
  createdAt: Date;
}

export interface AdminUserDetail {
  user: {
    userId: string;
    createdAt: Date;
    telegramConnected: boolean;
    telegramUsername?: string;
  };
  accounts: AdminAccountDetail[];
  sessions: AdminSessionDetail[];
  stats: {
    tasks24h: number;
    tasks7d: number;
    aborts24h: number;
    aborts7d: number;
    tweetsFetched24h: number;
    tweetsFetched7d: number;
    avgRuntime: number;
    cooldownCount: number;
  };
}

export class AdminUserDetailService {
  
  /**
   * Get detailed user information for admin view
   */
  async getUserDetail(userId: string): Promise<AdminUserDetail | null> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Check if user exists (has any accounts)
    const accountCount = await UserTwitterAccountModel.countDocuments({ ownerUserId: userId });
    if (accountCount === 0) {
      return null;
    }
    
    // Get telegram connection
    const telegramConn = await TelegramConnectionModel.findOne({ userId });
    
    // Get all accounts
    const accountDocs = await UserTwitterAccountModel.find({ ownerUserId: userId }).lean();
    
    const accounts: AdminAccountDetail[] = [];
    const accountMap = new Map<string, string>(); // accountId -> username
    
    for (const acc of accountDocs) {
      const accId = acc._id.toString();
      accountMap.set(accId, acc.username);
      
      // Get sessions for this account
      const sessionData = await UserTwitterSessionModel.aggregate([
        { $match: { ownerUserId: userId, accountId: acc._id, isActive: true } },
        { $group: { 
          _id: '$status', 
          count: { $sum: 1 },
          avgRisk: { $avg: '$riskScore' },
        }},
      ]);
      
      const sessionsCount = { ok: 0, stale: 0, invalid: 0 };
      let totalRisk = 0;
      let riskCount = 0;
      
      for (const s of sessionData) {
        if (s._id === 'OK') sessionsCount.ok = s.count;
        else if (s._id === 'STALE') sessionsCount.stale = s.count;
        else if (s._id === 'INVALID') sessionsCount.invalid = s.count;
        
        if (s.avgRisk) {
          totalRisk += s.avgRisk * s.count;
          riskCount += s.count;
        }
      }
      
      const riskAvg = riskCount > 0 ? Math.round(totalRisk / riskCount) : 0;
      
      // Get last parse for this account
      const lastTask = await UserTwitterParseTaskModel.findOne(
        { ownerUserId: userId, accountId: acc._id },
        { createdAt: 1 },
        { sort: { createdAt: -1 } }
      );
      
      accounts.push({
        accountId: accId,
        username: acc.username,
        enabled: acc.status === 'ACTIVE',
        preferred: acc.isPreferred || false,
        sessionsCount,
        riskAvg,
        lastParseAt: lastTask?.createdAt || null,
        createdAt: acc.createdAt,
      });
    }
    
    // Get all sessions
    const sessionDocs = await UserTwitterSessionModel.find({ ownerUserId: userId }).lean();
    
    const sessions: AdminSessionDetail[] = sessionDocs.map(sess => ({
      sessionId: sess._id.toString(),
      accountId: sess.accountId?.toString() || '',
      accountUsername: accountMap.get(sess.accountId?.toString() || '') || 'Unknown',
      status: sess.status as 'OK' | 'STALE' | 'INVALID',
      riskScore: sess.riskScore || 0,
      isActive: sess.isActive,
      lastSyncAt: sess.lastSyncAt || null,
      lastAbortAt: sess.lastAbortAt || null,
      abortCount: sess.abortCount || 0,
      version: sess.version || 1,
      createdAt: sess.createdAt,
    }));
    
    // Calculate stats
    const tasks24h = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      createdAt: { $gte: last24h },
    });
    
    const tasks7d = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      createdAt: { $gte: last7d },
    });
    
    const aborts24h = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      status: { $in: ['FAILED', 'PARTIAL'] },
      createdAt: { $gte: last24h },
    });
    
    const aborts7d = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      status: { $in: ['FAILED', 'PARTIAL'] },
      createdAt: { $gte: last7d },
    });
    
    // Get fetched tweets count
    const fetchedAgg = await UserTwitterParseTaskModel.aggregate([
      { $match: { ownerUserId: userId, createdAt: { $gte: last7d } } },
      { $group: { 
        _id: null, 
        total24h: { 
          $sum: { 
            $cond: [{ $gte: ['$createdAt', last24h] }, '$fetchedCount', 0] 
          } 
        },
        total7d: { $sum: '$fetchedCount' },
        avgRuntime: { $avg: '$durationMs' },
      }},
    ]);
    
    const fetchedStats = fetchedAgg[0] || { total24h: 0, total7d: 0, avgRuntime: 0 };
    
    // Count cooldowns (sessions with lastAbortAt in last 7d)
    const cooldownCount = await UserTwitterSessionModel.countDocuments({
      ownerUserId: userId,
      lastAbortAt: { $gte: last7d },
    });
    
    // Find earliest account creation as user "createdAt"
    const oldestAccount = await UserTwitterAccountModel.findOne(
      { ownerUserId: userId },
      { createdAt: 1 },
      { sort: { createdAt: 1 } }
    );
    
    return {
      user: {
        userId,
        createdAt: oldestAccount?.createdAt || new Date(),
        telegramConnected: telegramConn?.isActive || false,
        telegramUsername: telegramConn?.username,
      },
      accounts,
      sessions,
      stats: {
        tasks24h,
        tasks7d,
        aborts24h,
        aborts7d,
        tweetsFetched24h: fetchedStats.total24h || 0,
        tweetsFetched7d: fetchedStats.total7d || 0,
        avgRuntime: Math.round(fetchedStats.avgRuntime || 0),
        cooldownCount,
      },
    };
  }
  
  /**
   * Get recent tasks for a user
   */
  async getUserTasks(userId: string, limit = 20): Promise<AdminTaskDetail[]> {
    const tasks = await UserTwitterParseTaskModel.find(
      { ownerUserId: userId },
      { 
        status: 1, 
        type: 1, 
        query: 1, 
        fetchedCount: 1, 
        durationMs: 1, 
        abortReason: 1, 
        createdAt: 1 
      },
      { sort: { createdAt: -1 }, limit }
    ).lean();
    
    return tasks.map(t => ({
      taskId: t._id.toString(),
      status: t.status,
      type: t.type || 'SEARCH',
      query: t.query,
      fetched: t.fetchedCount || 0,
      duration: t.durationMs,
      abortReason: t.abortReason,
      createdAt: t.createdAt,
    }));
  }
}
