// P1: Warmth Worker
// Executes warmth pings via the parser service (Playwright)
// Uses PING_VIEWER - safe, read-only request to Twitter API

import { WarmthPlan, WarmthResult } from './warmth.types.js';
import { warmthService } from './warmth.service.js';
import { sessionService } from '../sessions/session.service.js';
import { proxySlotService } from '../slots/proxy-slot.service.js';
import { TwitterSessionModel, ITwitterSession } from '../sessions/session.model.js';

const PARSER_URL = process.env.TWITTER_PARSER_V2_URL || 'http://localhost:5001';

export class WarmthWorker {
  private isRunning = false;

  /**
   * Execute a single warmth plan
   * Uses Twitter Viewer API via parser service
   */
  async execute(plan: WarmthPlan): Promise<WarmthResult> {
    const startTime = Date.now();
    
    try {
      // Get session cookies
      const cookies = await sessionService.getCookies(plan.sessionId);
      
      // Get proxy for this session (optional)
      const session = await TwitterSessionModel.findOne({ sessionId: plan.sessionId }).lean();
      let proxyUrl: string | undefined;
      
      // For now, use any available proxy (in future: session-bound proxy)
      const proxy = await proxySlotService.selectBestSlot();
      if (proxy) {
        proxyUrl = proxySlotService.getProxyUrl(proxy);
      }

      // Execute warmth ping via parser
      const response = await fetch(`${PARSER_URL}/warmth/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies,
          proxyUrl,
          userAgent: session?.userAgent,
          action: plan.action,
        }),
        signal: AbortSignal.timeout(30000),
      });

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      if (response.ok && data.ok) {
        return {
          success: true,
          httpStatus: data.httpStatus || 200,
          latencyMs,
          checkedAt: new Date(),
        };
      } else {
        return {
          success: false,
          httpStatus: response.status,
          latencyMs,
          error: data.error || 'Unknown error',
          checkedAt: new Date(),
        };
      }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        latencyMs,
        error: error.message || 'Network error',
        checkedAt: new Date(),
      };
    }
  }

  /**
   * Run warmth check on all eligible sessions
   * Called by cron worker
   */
  async runAll(): Promise<{ checked: number; success: number; failed: number }> {
    if (this.isRunning) {
      console.log('[WarmthWorker] Already running, skipping...');
      return { checked: 0, success: 0, failed: 0 };
    }

    this.isRunning = true;
    console.log('[WarmthWorker] Starting warmth run...');

    let checked = 0;
    let success = 0;
    let failed = 0;

    try {
      const sessions = await warmthService.getSessionsNeedingWarmth();
      console.log(`[WarmthWorker] Found ${sessions.length} sessions needing warmth`);

      for (const session of sessions) {
        // Double-check eligibility
        if (!(await warmthService.shouldRun(session))) {
          continue;
        }

        const plan = await warmthService.buildPlan(session);
        
        // Add jitter delay to avoid patterns
        const jitterDelay = Math.random() * 5000; // 0-5 seconds
        await new Promise(resolve => setTimeout(resolve, jitterDelay));

        const result = await this.execute(plan);
        await warmthService.recordResult(session.sessionId, result);

        checked++;
        if (result.success) {
          success++;
        } else {
          failed++;
        }

        // Rate limit between sessions
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log(`[WarmthWorker] Complete: ${checked} checked, ${success} success, ${failed} failed`);
    } finally {
      this.isRunning = false;
    }

    return { checked, success, failed };
  }

  /**
   * Execute warmth ping for a single session (manual trigger)
   */
  async runOne(sessionId: string): Promise<WarmthResult> {
    const session = await TwitterSessionModel.findOne({ sessionId }).lean();
    if (!session) {
      return {
        success: false,
        error: 'Session not found',
        checkedAt: new Date(),
      };
    }

    const plan = await warmthService.buildPlan(session as ITwitterSession);
    const result = await this.execute(plan);
    await warmthService.recordResult(sessionId, result);
    
    return result;
  }
}

export const warmthWorker = new WarmthWorker();
