// P1: Warmth Service
// Keeps sessions "warm" by making safe, read-only requests

import { TwitterSessionModel, ITwitterSession, SessionStatus } from '../sessions/session.model.js';
import { WarmthPlan, WarmthResult, WarmthAction, DEFAULT_WARMTH_CONFIG } from './warmth.types.js';

export class WarmthService {
  private config = DEFAULT_WARMTH_CONFIG;

  /**
   * Check if session needs warmth ping
   */
  async shouldRun(session: ITwitterSession): Promise<boolean> {
    // Skip INVALID sessions
    if (session.status === 'INVALID' || session.status === 'EXPIRED') {
      return false;
    }

    // Skip if warmed recently (within 6 hours)
    if (session.lastWarmthAt) {
      const hoursSinceWarmth = (Date.now() - session.lastWarmthAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceWarmth < 6) {
        return false;
      }
    }

    // Skip if used recently (within 4 hours) - real activity = warm
    if (session.lastUsedAt) {
      const hoursSinceUse = (Date.now() - session.lastUsedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceUse < 4) {
        return false;
      }
    }

    // Check daily attempts limit
    const attemptsToday = await this.getAttemptsToday(session.sessionId);
    if (attemptsToday >= this.config.maxAttemptsPerDay) {
      return false;
    }

    return true;
  }

  /**
   * Build warmth execution plan for session
   */
  async buildPlan(session: ITwitterSession): Promise<WarmthPlan> {
    const attemptsToday = await this.getAttemptsToday(session.sessionId);
    
    return {
      sessionId: session.sessionId,
      action: 'PING_VIEWER',  // Safest action
      notBeforeTs: Date.now() + this.randomJitter(),
      jitterMs: this.randomJitter(),
      attemptsToday,
      maxAttemptsPerDay: this.config.maxAttemptsPerDay,
    };
  }

  /**
   * Record warmth attempt result
   */
  async recordResult(sessionId: string, result: WarmthResult): Promise<void> {
    const update: any = {
      lastWarmthAt: new Date(),
      lastCheckedAt: new Date(),
    };

    if (result.success) {
      // Decrement failure counter on success
      update['$inc'] = { 'metrics.warmthFailures24h': 0 };
    } else {
      // Increment failure counter
      update['$inc'] = { 'metrics.warmthFailures24h': 1 };
      update.lastError = {
        code: 'WARMTH_FAILED',
        message: result.error || 'Unknown warmth error',
        at: new Date(),
      };
    }

    await TwitterSessionModel.updateOne({ sessionId }, update);
    console.log(`[WarmthService] Recorded result for ${sessionId}: ${result.success ? 'OK' : 'FAILED'}`);
  }

  /**
   * Get warmth attempts count for today
   */
  private async getAttemptsToday(sessionId: string): Promise<number> {
    // For now, use lastWarmthAt to estimate
    // In production, could track in separate collection
    const session = await TwitterSessionModel.findOne({ sessionId }).lean();
    if (!session?.lastWarmthAt) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return session.lastWarmthAt >= today ? 1 : 0;
  }

  /**
   * Generate random jitter to avoid detection patterns
   */
  private randomJitter(): number {
    const range = this.config.jitterMaxMs - this.config.jitterMinMs;
    return this.config.jitterMinMs + Math.random() * range;
  }

  /**
   * Get all sessions that need warmth
   */
  async getSessionsNeedingWarmth(): Promise<ITwitterSession[]> {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    // Find sessions that:
    // 1. Are not INVALID/EXPIRED
    // 2. Haven't been warmed in 6+ hours OR haven't been used in 4+ hours
    return TwitterSessionModel.find({
      status: { $nin: ['INVALID', 'EXPIRED'] },
      $and: [
        {
          $or: [
            { lastWarmthAt: { $exists: false } },
            { lastWarmthAt: { $lt: sixHoursAgo } },
          ],
        },
        {
          $or: [
            { lastUsedAt: { $exists: false } },
            { lastUsedAt: { $lt: fourHoursAgo } },
          ],
        },
      ],
    }).lean();
  }
}

export const warmthService = new WarmthService();
