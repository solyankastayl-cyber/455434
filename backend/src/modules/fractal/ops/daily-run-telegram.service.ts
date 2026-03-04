/**
 * FRACTAL OPS — Daily Run with Telegram Integration
 * 
 * Production orchestrator that:
 * 1. Runs daily job (write → resolve → rebuild → audit)
 * 2. Checks health/status
 * 3. Sends appropriate Telegram notifications
 * 
 * Notification policy (institutional):
 * - Daily report: always (after job)
 * - Critical alert: on ALERT/CRITICAL health
 * - Milestone: when resolved >= 30
 * - Job failed: on any step failure
 */

import { tgSendMessage, getTelegramConfig } from './telegram.notifier';
import {
  buildDailyReport,
  buildCriticalAlert,
  buildMilestone30Resolved,
  buildJobFailedAlert
} from './telegram.messages';

type DailyRunContext = {
  logger: any;
  symbol: string;
  // Service functions
  dailyRun: (symbol: string) => Promise<any>;
  getHealth?: (symbol: string) => Promise<any>;
  getStatus?: () => Promise<any>;
  getShadowDivergence?: (symbol: string) => Promise<any>;
  // Optional: track milestone sent
  milestoneSent?: boolean;
};

export async function runDailyWithTelegram(ctx: DailyRunContext): Promise<{
  ok: boolean;
  telegram: boolean;
  daily?: any;
  notifications?: string[];
  error?: string;
}> {
  const { logger, symbol } = ctx;
  const tgConfig = getTelegramConfig();
  const notifications: string[] = [];
  const asofDate = new Date().toISOString().slice(0, 10);

  let jobResult: any;
  let jobError: string | null = null;

  // 1. Run daily job
  try {
    jobResult = await ctx.dailyRun(symbol);
    logger.info?.({ symbol, result: jobResult }, '[DailyTG] Job completed') ||
      console.log('[DailyTG] Job completed', symbol);
  } catch (err: any) {
    jobError = err?.message || String(err);
    logger.error?.({ symbol, err: jobError }, '[DailyTG] Job failed') ||
      console.error('[DailyTG] Job failed', jobError);

    // Send failure alert
    if (tgConfig.enabled) {
      const failMsg = buildJobFailedAlert({
        symbol,
        step: 'daily-run',
        error: jobError,
        asofDate
      });
      await tgSendMessage(logger, {
        token: tgConfig.token,
        chatId: tgConfig.chatId,
        text: failMsg
      });
      notifications.push('JOB_FAILED');
    }

    return { ok: false, telegram: tgConfig.enabled, notifications, error: jobError };
  }

  // 2. Get health/status (gracefully handle missing services)
  let health: any = { level: 'WATCH', reasons: [] };
  let status: any = {};

  try {
    if (ctx.getHealth) {
      health = await ctx.getHealth(symbol);
    }
  } catch (e) {
    logger.warn?.('[DailyTG] getHealth failed') || console.warn('[DailyTG] getHealth failed');
  }

  try {
    if (ctx.getStatus) {
      status = await ctx.getStatus();
    }
  } catch (e) {
    logger.warn?.('[DailyTG] getStatus failed') || console.warn('[DailyTG] getStatus failed');
  }

  // 3. Build daily summary
  const dailyPayload = {
    asofDate: jobResult?.asofDate || asofDate,
    symbol,
    steps: {
      write: jobResult?.steps?.write ?? { success: true },
      resolve: jobResult?.steps?.resolve ?? { success: true },
      rebuild: jobResult?.steps?.rebuild ?? { success: true },
      audit: jobResult?.steps?.audit ?? { success: true }
    },
    health: {
      level: health?.level || health?.status || 'WATCH',
      reasons: health?.reasons || health?.alerts || []
    },
    reliability: {
      badge: status?.model?.reliability?.badge || 'UNKNOWN',
      score: status?.model?.reliability?.score || 0
    },
    forward: {
      sharpe30: status?.performance?.forward?.sharpe30,
      maxDD60: status?.performance?.forward?.maxDD60,
      hitRate7: status?.performance?.forward?.hitRate7,
      trades: status?.performance?.forward?.trades
    },
    resolvedCount: status?.snapshots?.resolvedCount || status?.snapshots?.countResolved || 0,
    governanceMode: status?.governance?.mode || 'NORMAL'
  };

  // 4. Skip telegram if not configured
  if (!tgConfig.enabled) {
    logger.warn?.('[DailyTG] Telegram not configured, skipping notifications') ||
      console.warn('[DailyTG] Telegram not configured');
    return { ok: true, telegram: false, daily: dailyPayload, notifications };
  }

  const baseUrl = process.env.PUBLIC_ADMIN_URL || '';
  const isCritical = ['CRITICAL', 'ALERT', 'HALT', 'PROTECTION'].includes(
    String(dailyPayload.health.level).toUpperCase()
  );

  // 5. Send CRITICAL alert first (if applicable)
  if (isCritical) {
    const alertText = buildCriticalAlert({
      symbol,
      mode: dailyPayload.governanceMode,
      triggeredBy: dailyPayload.health.reasons,
      reliabilityBadge: dailyPayload.reliability.badge,
      reliabilityScore: dailyPayload.reliability.score,
      tailRiskP95: status?.risk?.mcP95_DD,
      entropy: status?.risk?.entropy,
      maxDDForward: dailyPayload.forward?.maxDD60,
      url: baseUrl ? `${baseUrl}/admin/fractal?tab=shadow` : undefined
    });
    await tgSendMessage(logger, {
      token: tgConfig.token,
      chatId: tgConfig.chatId,
      text: alertText
    });
    notifications.push('CRITICAL_ALERT');
  }

  // 6. Send daily report
  const dailyText = buildDailyReport(dailyPayload);
  await tgSendMessage(logger, {
    token: tgConfig.token,
    chatId: tgConfig.chatId,
    text: dailyText
  });
  notifications.push('DAILY_REPORT');

  // 7. Check milestone (30+ resolved)
  const rc = dailyPayload.resolvedCount;
  if (rc >= 30 && !ctx.milestoneSent) {
    let divData: any = null;
    try {
      if (ctx.getShadowDivergence) {
        divData = await ctx.getShadowDivergence(symbol);
      }
    } catch (e) {
      logger.warn?.('[DailyTG] getShadowDivergence failed') ||
        console.warn('[DailyTG] getShadowDivergence failed');
    }

    const milestoneText = buildMilestone30Resolved({
      symbol,
      resolvedCount: rc,
      verdict: divData?.recommendation?.verdict || 'REVIEW_REQUIRED',
      deltaSharpe: divData?.summary?.BALANCED?.['7d']?.delta?.sharpe,
      deltaMaxDD: divData?.summary?.BALANCED?.['7d']?.delta?.maxDD,
      url: baseUrl ? `${baseUrl}/admin/fractal?tab=shadow` : undefined
    });
    await tgSendMessage(logger, {
      token: tgConfig.token,
      chatId: tgConfig.chatId,
      text: milestoneText
    });
    notifications.push('MILESTONE_30');
  }

  return { ok: true, telegram: true, daily: dailyPayload, notifications };
}
