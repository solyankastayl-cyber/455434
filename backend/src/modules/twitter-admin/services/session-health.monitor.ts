/**
 * Session Health Monitor Service
 * 
 * Периодически проверяет здоровье сессий и обновляет их статус:
 * - OK → STALE если прошло много времени без sync
 * - STALE → INVALID если сессия не обновлялась слишком долго
 * - Отправляет уведомления в Telegram при изменении статуса
 */

import { UserTwitterSessionModel, type IUserTwitterSession } from '../../twitter-user/models/twitter-session.model.js';
import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';
import { TelegramNotifierV2 } from '../../twitter-user/notifications/telegram-notifier.js';
import { logAdminEvent } from '../models/admin-event-log.model.js';

// Configuration
const STALE_THRESHOLD_HOURS = 24;  // Session becomes STALE after 24h without sync
const INVALID_THRESHOLD_HOURS = 72; // Session becomes INVALID after 72h without sync
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

export interface SessionHealthStatus {
  sessionId: string;
  accountId: string;
  userId: string;
  username: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
}

export class SessionHealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  /**
   * Start the health monitor
   */
  start(): void {
    if (this.isRunning) {
      console.log('[SessionHealthMonitor] Already running');
      return;
    }
    
    console.log('[SessionHealthMonitor] Starting...');
    this.isRunning = true;
    
    // Run immediately once, then on interval
    this.checkAllSessions();
    
    this.intervalId = setInterval(() => {
      this.checkAllSessions();
    }, CHECK_INTERVAL_MS);
  }
  
  /**
   * Stop the health monitor
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[SessionHealthMonitor] Stopped');
  }
  
  /**
   * Check all active sessions and update their status
   */
  async checkAllSessions(): Promise<SessionHealthStatus[]> {
    const results: SessionHealthStatus[] = [];
    
    try {
      const now = new Date();
      const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
      const invalidThreshold = new Date(now.getTime() - INVALID_THRESHOLD_HOURS * 60 * 60 * 1000);
      
      // Find sessions that might need status update
      const sessions = await UserTwitterSessionModel.find({
        isActive: true,
        status: { $in: ['OK', 'STALE'] },
      }).lean();
      
      console.log(`[SessionHealthMonitor] Checking ${sessions.length} active sessions`);
      
      for (const session of sessions) {
        const statusChange = await this.evaluateSession(session, staleThreshold, invalidThreshold);
        if (statusChange) {
          results.push(statusChange);
        }
      }
      
      if (results.length > 0) {
        console.log(`[SessionHealthMonitor] Updated ${results.length} sessions`);
      }
      
    } catch (err) {
      console.error('[SessionHealthMonitor] Error checking sessions:', err);
    }
    
    return results;
  }
  
  /**
   * Evaluate a single session and update if needed
   */
  private async evaluateSession(
    session: IUserTwitterSession,
    staleThreshold: Date,
    invalidThreshold: Date
  ): Promise<SessionHealthStatus | null> {
    const lastSyncAt = session.lastSyncAt || session.createdAt;
    const previousStatus = session.status;
    let newStatus = previousStatus;
    let reason = '';
    
    // Check if should transition to INVALID (from STALE)
    if (session.status === 'STALE' && lastSyncAt < invalidThreshold) {
      newStatus = 'INVALID';
      reason = `No sync for ${INVALID_THRESHOLD_HOURS}+ hours`;
    }
    // Check if should transition to STALE (from OK)
    else if (session.status === 'OK' && lastSyncAt < staleThreshold) {
      newStatus = 'STALE';
      reason = `No sync for ${STALE_THRESHOLD_HOURS}+ hours`;
    }
    
    // No change needed
    if (newStatus === previousStatus) {
      return null;
    }
    
    // Get account info for notification
    const account = await UserTwitterAccountModel.findById(session.accountId).lean();
    const username = account?.username || 'unknown';
    
    // Update session status
    await UserTwitterSessionModel.updateOne(
      { _id: session._id },
      { 
        $set: { 
          status: newStatus, 
          staleReason: reason,
          updatedAt: new Date()
        } 
      }
    );
    
    // Log admin event
    await logAdminEvent(
      'SESSION_INVALIDATED',
      session.ownerUserId || undefined,
      {
        twitter: username,
        sessionId: String(session._id),
        previousStatus,
        newStatus,
        reason
      }
    );
    
    // Send Telegram notification to user
    if (session.ownerUserId) {
      await this.sendUserNotification(session.ownerUserId, username, previousStatus, newStatus, reason);
    }
    
    const result: SessionHealthStatus = {
      sessionId: String(session._id),
      accountId: String(session.accountId),
      userId: session.ownerUserId || '',
      username,
      previousStatus,
      newStatus,
      reason
    };
    
    console.log(`[SessionHealthMonitor] Session ${result.sessionId} (@${username}): ${previousStatus} → ${newStatus}`);
    
    return result;
  }
  
  /**
   * Send Telegram notification to user about session status change
   */
  private async sendUserNotification(
    userId: string,
    username: string,
    previousStatus: string,
    newStatus: string,
    reason: string
  ): Promise<void> {
    try {
      const notifier = new TelegramNotifierV2();
      
      if (newStatus === 'STALE') {
        await notifier.notifySessionStale(userId, username, reason);
      } else if (newStatus === 'INVALID') {
        await notifier.notifySessionInvalid(userId, username, reason);
      }
    } catch (err) {
      console.error('[SessionHealthMonitor] Failed to send user notification:', err);
    }
  }
  
  /**
   * Manually check and update a specific session
   */
  async checkSession(sessionId: string): Promise<SessionHealthStatus | null> {
    const session = await UserTwitterSessionModel.findById(sessionId).lean();
    
    if (!session || !session.isActive) {
      return null;
    }
    
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
    const invalidThreshold = new Date(now.getTime() - INVALID_THRESHOLD_HOURS * 60 * 60 * 1000);
    
    return this.evaluateSession(session, staleThreshold, invalidThreshold);
  }
  
  /**
   * Get current health statistics
   */
  async getHealthStats(): Promise<{
    total: number;
    ok: number;
    stale: number;
    invalid: number;
    checkIntervalMinutes: number;
  }> {
    const [total, ok, stale, invalid] = await Promise.all([
      UserTwitterSessionModel.countDocuments({ isActive: true }),
      UserTwitterSessionModel.countDocuments({ isActive: true, status: 'OK' }),
      UserTwitterSessionModel.countDocuments({ isActive: true, status: 'STALE' }),
      UserTwitterSessionModel.countDocuments({ isActive: true, status: 'INVALID' }),
    ]);
    
    return {
      total,
      ok,
      stale,
      invalid,
      checkIntervalMinutes: CHECK_INTERVAL_MS / 60000
    };
  }
}

// Singleton instance
export const sessionHealthMonitor = new SessionHealthMonitor();
