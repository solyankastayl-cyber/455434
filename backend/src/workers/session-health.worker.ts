// P1: Session Health Cron Worker
// Runs periodically to:
// 1. Check session warmth (keep alive)
// 2. Calculate risk scores
// 3. Send alerts on status changes

import { warmthWorker } from '../modules/twitter/warmth/warmth.worker.js';
import { riskService } from '../modules/twitter/risk/risk.service.js';
import { sessionNotifier } from '../modules/twitter/notifications/session-notifier.js';
import { TwitterSessionModel } from '../modules/twitter/sessions/session.model.js';
import { proxySlotService } from '../modules/twitter/slots/proxy-slot.service.js';

export interface WorkerConfig {
  // Warmth check interval (ms)
  warmthIntervalMs: number;
  // Risk calculation interval (ms)
  riskIntervalMs: number;
  // Daily summary time (hour in UTC)
  dailySummaryHour: number;
}

const DEFAULT_CONFIG: WorkerConfig = {
  warmthIntervalMs: 30 * 60 * 1000,  // 30 minutes
  riskIntervalMs: 15 * 60 * 1000,    // 15 minutes
  dailySummaryHour: 9,               // 9 AM UTC
};

export class SessionHealthWorker {
  private config: WorkerConfig;
  private warmthInterval: NodeJS.Timeout | null = null;
  private riskInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastDailySummary: Date | null = null;

  constructor(config: Partial<WorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the worker
   */
  start(): void {
    if (this.isRunning) {
      console.log('[SessionHealthWorker] Already running');
      return;
    }

    console.log('[SessionHealthWorker] Starting...');
    this.isRunning = true;

    // Run initial checks
    this.runRiskCheck();

    // Schedule warmth checks
    this.warmthInterval = setInterval(() => {
      this.runWarmthCheck();
    }, this.config.warmthIntervalMs);

    // Schedule risk calculations
    this.riskInterval = setInterval(() => {
      this.runRiskCheck();
      this.checkDailySummary();
    }, this.config.riskIntervalMs);

    console.log(`[SessionHealthWorker] Started with warmth=${this.config.warmthIntervalMs}ms, risk=${this.config.riskIntervalMs}ms`);
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.warmthInterval) {
      clearInterval(this.warmthInterval);
      this.warmthInterval = null;
    }

    if (this.riskInterval) {
      clearInterval(this.riskInterval);
      this.riskInterval = null;
    }

    this.isRunning = false;
    console.log('[SessionHealthWorker] Stopped');
  }

  /**
   * Run warmth check on eligible sessions
   */
  async runWarmthCheck(): Promise<void> {
    console.log('[SessionHealthWorker] Running warmth check...');
    try {
      const result = await warmthWorker.runAll();
      console.log(`[SessionHealthWorker] Warmth check complete: ${result.checked} checked, ${result.success} success, ${result.failed} failed`);
    } catch (error) {
      console.error('[SessionHealthWorker] Warmth check error:', error);
    }
  }

  /**
   * Run risk calculation on all sessions
   */
  async runRiskCheck(): Promise<void> {
    console.log('[SessionHealthWorker] Running risk check...');
    try {
      // Also recover any proxies from cooldown
      await proxySlotService.checkAndRecoverCooldowns();
      
      const result = await riskService.updateAllSessions();
      console.log(`[SessionHealthWorker] Risk check complete: ${result.checked} checked, ${result.changed} status changes`);
    } catch (error) {
      console.error('[SessionHealthWorker] Risk check error:', error);
    }
  }

  /**
   * Check if daily summary should be sent
   */
  async checkDailySummary(): Promise<void> {
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Check if it's the right hour and we haven't sent today
    if (currentHour !== this.config.dailySummaryHour) return;
    
    if (this.lastDailySummary) {
      const hoursSince = (now.getTime() - this.lastDailySummary.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 20) return; // Don't send more than once per 20 hours
    }

    await this.sendDailySummary();
    this.lastDailySummary = now;
  }

  /**
   * Send daily summary notification
   */
  async sendDailySummary(): Promise<void> {
    console.log('[SessionHealthWorker] Sending daily summary...');
    try {
      const sessions = await TwitterSessionModel.find().lean();
      
      const stats = {
        total: sessions.length,
        ok: sessions.filter(s => s.status === 'OK').length,
        stale: sessions.filter(s => s.status === 'STALE').length,
        invalid: sessions.filter(s => s.status === 'INVALID' || s.status === 'EXPIRED').length,
        avgRisk: sessions.length > 0
          ? Math.round(sessions.reduce((sum, s) => sum + (s.riskScore ?? 50), 0) / sessions.length)
          : 0,
      };

      await sessionNotifier.notifyDailySummary(stats);
      console.log('[SessionHealthWorker] Daily summary sent');
    } catch (error) {
      console.error('[SessionHealthWorker] Daily summary error:', error);
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    isRunning: boolean;
    config: WorkerConfig;
    lastDailySummary: Date | null;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      lastDailySummary: this.lastDailySummary,
    };
  }
}

// Singleton instance
export const sessionHealthWorker = new SessionHealthWorker();
