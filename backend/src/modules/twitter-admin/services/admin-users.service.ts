/**
 * A.3.1 - Admin Users Service
 * 
 * Aggregates user data for admin overview:
 * - User list with accounts/sessions counts
 * - Health classification
 * - System totals
 */

import mongoose from 'mongoose';
import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../../twitter-user/models/twitter-session.model.js';
import { UserTwitterParseTaskModel } from '../../twitter-user/models/twitter-parse-task.model.js';
import { TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';

// Admin health classification
export type AdminUserHealth = 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'BLOCKED';

export interface AdminUserSummary {
  userId: string;
  accounts: number;
  sessions: {
    ok: number;
    stale: number;
    invalid: number;
  };
  riskAvg: number;
  lastParseAt: Date | null;
  telegramConnected: boolean;
  health: AdminUserHealth;
  tasksLast24h: number;
  abortsLast24h: number;
}

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  totalAccounts: number;
  totalSessions: {
    ok: number;
    stale: number;
    invalid: number;
  };
  abortsLast24h: number;
}

/**
 * Calculate user health based on sessions and risk
 */
function calculateHealth(
  sessions: { ok: number; stale: number; invalid: number },
  riskAvg: number,
  abortsLast24h: number
): AdminUserHealth {
  const total = sessions.ok + sessions.stale + sessions.invalid;
  
  // BLOCKED: all invalid or no sessions
  if (total === 0 || sessions.invalid === total) {
    return 'BLOCKED';
  }
  
  // DEGRADED: all stale or high abort rate
  if (sessions.stale === total || abortsLast24h >= 5) {
    return 'DEGRADED';
  }
  
  // WARNING: some stale or moderate risk
  if (sessions.stale > 0 || riskAvg >= 50) {
    return 'WARNING';
  }
  
  // HEALTHY: at least one OK, low risk
  return 'HEALTHY';
}

export class AdminUsersService {
  
  /**
   * Get system overview totals
   */
  async getOverview(): Promise<AdminOverview> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get unique user IDs from accounts
    const userIds = await UserTwitterAccountModel.distinct('ownerUserId');
    
    // Count active users (with at least one OK session)
    const activeUserIds = await UserTwitterSessionModel.distinct('ownerUserId', {
      status: 'OK',
      isActive: true,
    });
    
    // Count total accounts
    const totalAccounts = await UserTwitterAccountModel.countDocuments();
    
    // Count sessions by status
    const sessionCounts = await UserTwitterSessionModel.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    
    const sessions = { ok: 0, stale: 0, invalid: 0 };
    for (const s of sessionCounts) {
      if (s._id === 'OK') sessions.ok = s.count;
      else if (s._id === 'STALE') sessions.stale = s.count;
      else if (s._id === 'INVALID') sessions.invalid = s.count;
    }
    
    // Count aborts in last 24h
    const abortsLast24h = await UserTwitterParseTaskModel.countDocuments({
      status: { $in: ['FAILED', 'PARTIAL'] },
      createdAt: { $gte: last24h },
    });
    
    return {
      totalUsers: userIds.length,
      activeUsers: activeUserIds.length,
      totalAccounts,
      totalSessions: sessions,
      abortsLast24h,
    };
  }
  
  /**
   * Get paginated user list with aggregated data
   */
  async getUsers(options: {
    page?: number;
    limit?: number;
    status?: AdminUserHealth;
    search?: string;
    sortBy?: 'risk' | 'lastParse' | 'sessions';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ users: AdminUserSummary[]; total: number; page: number; pages: number }> {
    const {
      page = 1,
      limit = 25,
      status,
      search,
      sortBy = 'lastParse',
      sortOrder = 'desc',
    } = options;
    
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get all unique user IDs
    let userIds = await UserTwitterAccountModel.distinct('ownerUserId');
    
    // Filter by search if provided
    if (search) {
      userIds = userIds.filter(id => 
        id.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    // Build user summaries
    const userSummaries: AdminUserSummary[] = [];
    
    for (const userId of userIds) {
      // Get accounts count
      const accounts = await UserTwitterAccountModel.countDocuments({ ownerUserId: userId });
      
      // Get sessions by status
      const sessionData = await UserTwitterSessionModel.aggregate([
        { $match: { ownerUserId: userId, isActive: true } },
        { $group: { 
          _id: '$status', 
          count: { $sum: 1 },
          avgRisk: { $avg: '$riskScore' },
        }},
      ]);
      
      const sessions = { ok: 0, stale: 0, invalid: 0 };
      let totalRisk = 0;
      let riskCount = 0;
      
      for (const s of sessionData) {
        if (s._id === 'OK') sessions.ok = s.count;
        else if (s._id === 'STALE') sessions.stale = s.count;
        else if (s._id === 'INVALID') sessions.invalid = s.count;
        
        if (s.avgRisk) {
          totalRisk += s.avgRisk * s.count;
          riskCount += s.count;
        }
      }
      
      const riskAvg = riskCount > 0 ? Math.round(totalRisk / riskCount) : 0;
      
      // Get last parse
      const lastTask = await UserTwitterParseTaskModel.findOne(
        { ownerUserId: userId },
        { createdAt: 1 },
        { sort: { createdAt: -1 } }
      );
      
      // Get tasks/aborts last 24h
      const tasksLast24h = await UserTwitterParseTaskModel.countDocuments({
        ownerUserId: userId,
        createdAt: { $gte: last24h },
      });
      
      const abortsLast24h = await UserTwitterParseTaskModel.countDocuments({
        ownerUserId: userId,
        status: { $in: ['FAILED', 'PARTIAL'] },
        createdAt: { $gte: last24h },
      });
      
      // Check telegram connection
      const telegramConn = await TelegramConnectionModel.findOne({
        userId: userId,
        isActive: true,
      });
      
      const health = calculateHealth(sessions, riskAvg, abortsLast24h);
      
      userSummaries.push({
        userId,
        accounts,
        sessions,
        riskAvg,
        lastParseAt: lastTask?.createdAt || null,
        telegramConnected: !!telegramConn,
        health,
        tasksLast24h,
        abortsLast24h,
      });
    }
    
    // Filter by status if provided
    let filtered = userSummaries;
    if (status) {
      filtered = filtered.filter(u => u.health === status);
    }
    
    // Sort
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'risk') {
        cmp = a.riskAvg - b.riskAvg;
      } else if (sortBy === 'sessions') {
        cmp = (a.sessions.ok + a.sessions.stale + a.sessions.invalid) - 
              (b.sessions.ok + b.sessions.stale + b.sessions.invalid);
      } else {
        // lastParse
        const aTime = a.lastParseAt?.getTime() || 0;
        const bTime = b.lastParseAt?.getTime() || 0;
        cmp = aTime - bTime;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    
    // Paginate
    const total = filtered.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const users = filtered.slice(start, start + limit);
    
    return { users, total, page, pages };
  }
}
