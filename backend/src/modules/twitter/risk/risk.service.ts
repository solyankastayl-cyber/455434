// P1: Risk Service
// Main service for calculating and updating session risk scores

import { TwitterSessionModel, ITwitterSession, SessionStatus, SessionMetrics } from '../sessions/session.model.js';
import { RiskFactors, RiskScore, DEFAULT_RISK_THRESHOLDS } from './risk.types.js';
import { riskCalculator } from './risk.calculator.js';
import { lifetimeEstimator } from './risk.lifetime.js';
import { sessionNotifier } from '../notifications/session-notifier.js';

export class RiskService {
  private thresholds = DEFAULT_RISK_THRESHOLDS;

  /**
   * Calculate risk factors for a session
   */
  calculateFactors(session: ITwitterSession): RiskFactors {
    const now = Date.now();
    const metrics = session.metrics || this.defaultMetrics();

    // Cookie age - safely handle date conversion
    let cookieAgeHours = 999;
    if (session.lastSyncedAt) {
      const syncedAt = new Date(session.lastSyncedAt).getTime();
      if (!isNaN(syncedAt)) {
        cookieAgeHours = (now - syncedAt) / (1000 * 60 * 60);
      }
    }

    // Warmth failure rate
    const warmthTotal = (metrics.warmthFailures24h || 0) + (session.lastWarmthAt ? 1 : 0);
    const warmthFailureRate = warmthTotal > 0 
      ? (metrics.warmthFailures24h || 0) / warmthTotal 
      : 0;

    // Parser error rate
    const parserTotal = (metrics.parserErrors24h || 0) + (metrics.successfulRequests24h || 0);
    const parserErrorRate = parserTotal > 0 
      ? (metrics.parserErrors24h || 0) / parserTotal 
      : 0;

    // Rate limit pressure
    const rateLimitPressure = Math.min(1, (metrics.rateLimitHits24h || 0) / 10);

    // Idle hours - safely handle date conversion
    let idleHours = 999;
    const lastActivity = session.lastUsedAt || session.lastWarmthAt || session.lastSyncedAt;
    if (lastActivity) {
      const activityTime = new Date(lastActivity).getTime();
      if (!isNaN(activityTime)) {
        idleHours = (now - activityTime) / (1000 * 60 * 60);
      }
    }

    // Required cookies check
    const hasRequiredCookies = !!(session.cookiesMeta?.hasAuthToken && session.cookiesMeta?.hasCt0);

    return {
      cookieAgeHours,
      warmthFailureRate,
      parserErrorRate,
      rateLimitPressure,
      proxyChangedRecently: false, // TODO: Track proxy changes
      idleHours,
      hasRequiredCookies,
    };
  }

  /**
   * Calculate full risk score for a session
   */
  calculateRisk(session: ITwitterSession): RiskScore {
    const factors = this.calculateFactors(session);
    const score = riskCalculator.calculate(factors);
    const status = this.scoreToStatus(score);

    return {
      score,
      status,
      factors,
      calculatedAt: new Date(),
    };
  }

  /**
   * Convert risk score to status
   */
  scoreToStatus(score: number): SessionStatus {
    if (score < this.thresholds.okMax) {
      return 'OK';
    }
    if (score < this.thresholds.staleMax) {
      return 'STALE';
    }
    return 'INVALID';
  }

  /**
   * Update session with new risk calculation
   * Sends notification if status changed
   */
  async updateSession(session: ITwitterSession): Promise<{ changed: boolean; newStatus: SessionStatus }> {
    const oldStatus = session.status;
    const risk = this.calculateRisk(session);
    const lifetime = lifetimeEstimator.estimate(risk.score);

    // Update session
    await TwitterSessionModel.updateOne(
      { sessionId: session.sessionId },
      {
        $set: {
          riskScore: risk.score,
          expectedLifetimeDays: lifetime,
          lastCheckedAt: new Date(),
          ...(risk.status !== oldStatus && {
            status: risk.status,
            lastStatusChangeAt: new Date(),
          }),
        },
      }
    );

    // Notify if status changed
    if (risk.status !== oldStatus) {
      console.log(`[RiskService] Status change: ${session.sessionId} ${oldStatus} → ${risk.status}`);
      
      await sessionNotifier.notifyStatusChange({
        sessionId: session.sessionId,
        accountId: session.accountId?.toString(),
        from: oldStatus,
        to: risk.status,
        riskScore: risk.score,
        lifetime,
      });

      return { changed: true, newStatus: risk.status };
    }

    return { changed: false, newStatus: risk.status };
  }

  /**
   * Run risk calculation on all sessions
   */
  async updateAllSessions(): Promise<{ checked: number; changed: number }> {
    const sessions = await TwitterSessionModel.find().lean();
    
    let checked = 0;
    let changed = 0;

    for (const session of sessions) {
      checked++;
      const result = await this.updateSession(session as ITwitterSession);
      if (result.changed) changed++;
    }

    console.log(`[RiskService] Risk update complete: ${checked} checked, ${changed} changed`);
    return { checked, changed };
  }

  /**
   * Get risk report for all sessions
   */
  async getReport(): Promise<{
    total: number;
    byStatus: Record<SessionStatus, number>;
    byRisk: { healthy: number; warning: number; critical: number };
    sessions: Array<{
      sessionId: string;
      status: SessionStatus;
      riskScore: number;
      lifetime: number;
    }>;
  }> {
    const sessions = await TwitterSessionModel.find().lean();
    
    const byStatus: Record<SessionStatus, number> = {
      OK: 0,
      STALE: 0,
      INVALID: 0,
      EXPIRED: 0,
    };

    const byRisk = { healthy: 0, warning: 0, critical: 0 };

    const sessionData = sessions.map(s => {
      byStatus[s.status]++;
      
      const score = s.riskScore ?? 50;
      if (score < 35) byRisk.healthy++;
      else if (score < 70) byRisk.warning++;
      else byRisk.critical++;

      return {
        sessionId: s.sessionId,
        status: s.status,
        riskScore: score,
        lifetime: s.expectedLifetimeDays ?? 0,
      };
    });

    return {
      total: sessions.length,
      byStatus,
      byRisk,
      sessions: sessionData,
    };
  }

  private defaultMetrics(): SessionMetrics {
    return {
      parserErrors24h: 0,
      warmthFailures24h: 0,
      rateLimitHits24h: 0,
      successfulRequests24h: 0,
    };
  }
}

export const riskService = new RiskService();
