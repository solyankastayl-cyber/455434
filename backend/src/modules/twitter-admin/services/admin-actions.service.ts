/**
 * A.3.2 - Admin Actions Service
 * 
 * Controlled actions that admins can perform:
 * - Disable/Enable user parsing
 * - Force cooldown
 * - Invalidate sessions
 * - Disable/Enable accounts
 * 
 * All actions are logged for audit trail
 */

import mongoose from 'mongoose';
import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../../twitter-user/models/twitter-session.model.js';
import { AdminActionLogModel, AdminActionType, AdminTargetType } from '../models/admin-action-log.model.js';
import { TelegramNotifierV2 } from '../../twitter-user/notifications/telegram-notifier.js';

export interface AdminActionResult {
  success: boolean;
  message: string;
  affected?: number;
}

export class AdminActionsService {
  
  /**
   * Log an admin action for audit trail
   */
  private async logAction(
    adminId: string,
    actionType: AdminActionType,
    targetType: AdminTargetType,
    targetId: string,
    targetUserId: string,
    payload?: Record<string, any>,
    reason?: string
  ): Promise<void> {
    try {
      await AdminActionLogModel.create({
        actorAdminId: adminId,
        actionType,
        targetType,
        targetId,
        targetUserId,
        payload,
        reason,
        createdAt: new Date(),
      });
      console.log(`[AdminAction] ${adminId} -> ${actionType} on ${targetType}:${targetId}`);
    } catch (err) {
      console.error('[AdminAction] Failed to log action:', err);
    }
  }
  
  /**
   * Disable user parsing (user cannot run new tasks)
   */
  async disableUserParsing(adminId: string, userId: string, reason?: string): Promise<AdminActionResult> {
    // Disable all accounts for this user
    const result = await UserTwitterAccountModel.updateMany(
      { ownerUserId: userId },
      { $set: { status: 'SUSPENDED' } }
    );
    
    await this.logAction(adminId, 'USER_DISABLE', 'USER', userId, userId, {
      accountsAffected: result.modifiedCount,
    }, reason);
    
    // Notify user via Telegram
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: 'HIGH_RISK_WARNING',
        payload: {
          reason: reason || 'Your Twitter parsing has been temporarily limited by administrator',
        },
      });
    } catch (e) {
      // Ignore notification errors
    }
    
    return {
      success: true,
      message: `User parsing disabled. ${result.modifiedCount} accounts affected.`,
      affected: result.modifiedCount,
    };
  }
  
  /**
   * Enable user parsing
   */
  async enableUserParsing(adminId: string, userId: string): Promise<AdminActionResult> {
    const result = await UserTwitterAccountModel.updateMany(
      { ownerUserId: userId, status: 'SUSPENDED' },
      { $set: { status: 'ACTIVE' } }
    );
    
    await this.logAction(adminId, 'USER_ENABLE', 'USER', userId, userId, {
      accountsAffected: result.modifiedCount,
    });
    
    return {
      success: true,
      message: `User parsing enabled. ${result.modifiedCount} accounts reactivated.`,
      affected: result.modifiedCount,
    };
  }
  
  /**
   * Force cooldown for all user sessions
   * Sets all sessions to STALE and marks them for cooldown
   */
  async forceUserCooldown(adminId: string, userId: string, reason?: string): Promise<AdminActionResult> {
    const now = new Date();
    
    const result = await UserTwitterSessionModel.updateMany(
      { ownerUserId: userId, status: { $ne: 'INVALID' } },
      { 
        $set: { 
          status: 'STALE',
          lastAbortAt: now,
        },
        $inc: { abortCount: 1 },
      }
    );
    
    await this.logAction(adminId, 'USER_COOLDOWN', 'USER', userId, userId, {
      sessionsAffected: result.modifiedCount,
    }, reason);
    
    // Notify user
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: 'COOLDOWN_ENABLED',
        payload: {
          reason: reason || 'Administrator initiated cooldown period',
        },
      });
    } catch (e) {
      // Ignore
    }
    
    return {
      success: true,
      message: `Cooldown activated. ${result.modifiedCount} sessions affected.`,
      affected: result.modifiedCount,
    };
  }
  
  /**
   * Invalidate all user sessions
   * User must re-sync cookies to continue
   */
  async invalidateAllSessions(adminId: string, userId: string, reason?: string): Promise<AdminActionResult> {
    const result = await UserTwitterSessionModel.updateMany(
      { ownerUserId: userId },
      { 
        $set: { 
          status: 'INVALID',
          isActive: false,
        },
      }
    );
    
    await this.logAction(adminId, 'SESSION_INVALIDATE', 'USER', userId, userId, {
      sessionsAffected: result.modifiedCount,
      scope: 'ALL',
    }, reason);
    
    // Notify user
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: 'SESSION_INVALID',
        payload: {
          reason: reason || 'Sessions invalidated by administrator. Please re-sync your cookies.',
        },
      });
    } catch (e) {
      // Ignore
    }
    
    return {
      success: true,
      message: `All sessions invalidated. ${result.modifiedCount} sessions affected.`,
      affected: result.modifiedCount,
    };
  }
  
  /**
   * Invalidate a specific session
   */
  async invalidateSession(adminId: string, sessionId: string, reason?: string): Promise<AdminActionResult> {
    const session = await UserTwitterSessionModel.findById(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }
    
    session.status = 'INVALID';
    session.isActive = false;
    await session.save();
    
    await this.logAction(adminId, 'SESSION_INVALIDATE', 'SESSION', sessionId, session.ownerUserId, {}, reason);
    
    return {
      success: true,
      message: 'Session invalidated successfully',
      affected: 1,
    };
  }
  
  /**
   * Disable a specific account
   */
  async disableAccount(adminId: string, accountId: string, reason?: string): Promise<AdminActionResult> {
    const account = await UserTwitterAccountModel.findById(accountId);
    if (!account) {
      return { success: false, message: 'Account not found' };
    }
    
    account.status = 'SUSPENDED';
    await account.save();
    
    await this.logAction(adminId, 'ACCOUNT_DISABLE', 'ACCOUNT', accountId, account.ownerUserId, {
      username: account.username,
    }, reason);
    
    return {
      success: true,
      message: `Account @${account.username} disabled`,
      affected: 1,
    };
  }
  
  /**
   * Enable a specific account
   */
  async enableAccount(adminId: string, accountId: string): Promise<AdminActionResult> {
    const account = await UserTwitterAccountModel.findById(accountId);
    if (!account) {
      return { success: false, message: 'Account not found' };
    }
    
    account.status = 'ACTIVE';
    await account.save();
    
    await this.logAction(adminId, 'ACCOUNT_ENABLE', 'ACCOUNT', accountId, account.ownerUserId, {
      username: account.username,
    });
    
    return {
      success: true,
      message: `Account @${account.username} enabled`,
      affected: 1,
    };
  }
  
  /**
   * Get action history for a user
   */
  async getUserActionHistory(userId: string, limit = 50): Promise<any[]> {
    const logs = await AdminActionLogModel.find(
      { targetUserId: userId },
      {},
      { sort: { createdAt: -1 }, limit }
    ).lean();
    
    return logs.map(log => ({
      id: log._id.toString(),
      adminId: log.actorAdminId,
      action: log.actionType,
      target: log.targetType,
      targetId: log.targetId,
      payload: log.payload,
      reason: log.reason,
      createdAt: log.createdAt,
    }));
  }
}
