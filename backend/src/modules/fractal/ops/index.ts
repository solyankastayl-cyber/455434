/**
 * FRACTAL OPS — Operations Module Index
 * 
 * Production infrastructure:
 * - Telegram notifications (admin only)
 * - Cron authentication
 * - Daily job orchestration
 * - BLOCK E: Hardened services
 */

// Core telegram
export { tgSendMessage, getTelegramConfig } from './telegram.notifier.js';
export {
  buildDailyReport,
  buildCriticalAlert,
  buildMilestone30Resolved,
  buildTestMessage,
  buildJobFailedAlert
} from './telegram.messages.js';

// Auth
export { requireCronAuth, cronAuthHook, hasCronAuth } from './cron.auth.js';

// Daily orchestration
export { runDailyWithTelegram } from './daily-run-telegram.service.js';

// BLOCK E — Hardened services
export {
  TelegramHardenedService,
  initTelegramHardened,
  getTelegramHardenedService,
  type TelegramSendResult,
  type AlertLevel,
} from './telegram.hardened.js';

export {
  CronHardeningService,
  initCronHardening,
  getCronHardeningService,
  type CronJobResult,
  type CronExecution,
} from './cron.hardening.js';

export {
  buildCronMissedAlert,
  buildCronTimeoutAlert,
  buildSystemHealthAlert,
  buildRateLimitWarning,
  buildShadowDivergenceAlert,
  buildDailyDigest,
  buildStartupNotification,
  buildShutdownNotification,
} from './telegram.alerts.extended.js';

export { registerHardenedOpsRoutes } from './ops.hardened.routes.js';
