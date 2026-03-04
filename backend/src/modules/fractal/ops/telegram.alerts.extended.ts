/**
 * BLOCK E.3 — Alert Templates Extended
 * 
 * Новые типы алертов:
 * - System health degradation
 * - Cron job missed/timeout
 * - Rate limit warnings
 * - Shadow divergence alerts
 */

// ═══════════════════════════════════════════════════════════════
// EXTENDED ALERT TEMPLATES
// ═══════════════════════════════════════════════════════════════

export function buildCronMissedAlert(payload: {
  jobName: string;
  expectedTime: string;
  lastRun?: string;
  missedCount: number;
}): string {
  return [
    `⏰ <b>FRACTAL CRON MISSED</b>`,
    ``,
    `Job: <b>${payload.jobName}</b>`,
    `Expected: ${payload.expectedTime}`,
    `Last Run: ${payload.lastRun || 'NEVER'}`,
    `Missed: <b>${payload.missedCount}</b> times`,
    ``,
    `<b>Action:</b>`,
    `→ Check cron daemon status`,
    `→ Verify FRACTAL_CRON_SECRET`,
    `→ Manual trigger may be needed`,
  ].join('\n');
}

export function buildCronTimeoutAlert(payload: {
  jobName: string;
  executionId: string;
  startedAt: string;
  timeoutAfterMs: number;
}): string {
  const timeoutMin = Math.round(payload.timeoutAfterMs / 60000);
  return [
    `⏱️ <b>FRACTAL CRON TIMEOUT</b>`,
    ``,
    `Job: <b>${payload.jobName}</b>`,
    `Execution: <code>${payload.executionId}</code>`,
    `Started: ${payload.startedAt}`,
    `Timeout: ${timeoutMin} minutes`,
    ``,
    `<b>Possible causes:</b>`,
    `→ Database slow/locked`,
    `→ External API timeout`,
    `→ Data volume spike`,
  ].join('\n');
}

export function buildSystemHealthAlert(payload: {
  component: string;
  status: 'DEGRADED' | 'DOWN' | 'RECOVERED';
  message: string;
  metrics?: Record<string, any>;
}): string {
  const emoji = {
    'DEGRADED': '🟡',
    'DOWN': '🔴',
    'RECOVERED': '🟢',
  }[payload.status];

  const metricsText = payload.metrics
    ? Object.entries(payload.metrics).map(([k, v]) => `${k}: ${v}`).join(' | ')
    : '';

  return [
    `${emoji} <b>FRACTAL SYSTEM ${payload.status}</b>`,
    ``,
    `Component: <b>${payload.component}</b>`,
    `Message: ${payload.message}`,
    metricsText ? `\nMetrics: ${metricsText}` : '',
  ].filter(Boolean).join('\n');
}

export function buildRateLimitWarning(payload: {
  endpoint: string;
  currentRate: number;
  maxRate: number;
  blockedRequests: number;
}): string {
  const pct = Math.round((payload.currentRate / payload.maxRate) * 100);
  return [
    `⚠️ <b>FRACTAL RATE LIMIT WARNING</b>`,
    ``,
    `Endpoint: <b>${payload.endpoint}</b>`,
    `Rate: ${payload.currentRate}/${payload.maxRate} (${pct}%)`,
    `Blocked: ${payload.blockedRequests}`,
    ``,
    `Consider increasing limits or throttling clients.`,
  ].join('\n');
}

export function buildShadowDivergenceAlert(payload: {
  symbol: string;
  horizon: string;
  activeSharpe: number;
  shadowSharpe: number;
  deltaSharpe: number;
  recommendation: string;
  url?: string;
}): string {
  const deltaEmoji = payload.deltaSharpe > 0 ? '📈' : '📉';
  return [
    `${deltaEmoji} <b>FRACTAL SHADOW DIVERGENCE</b>`,
    ``,
    `Symbol: <b>${payload.symbol}</b>`,
    `Horizon: ${payload.horizon}`,
    ``,
    `Active Sharpe: <b>${fmt(payload.activeSharpe)}</b>`,
    `Shadow Sharpe: <b>${fmt(payload.shadowSharpe)}</b>`,
    `Delta: <b>${fmt(payload.deltaSharpe)}</b>`,
    ``,
    `Recommendation: <b>${payload.recommendation}</b>`,
    payload.url ? `\n🔗 ${payload.url}` : '',
  ].filter(Boolean).join('\n');
}

export function buildDailyDigest(payload: {
  date: string;
  symbol: string;
  signals: { total: number; resolved: number; pending: number };
  performance: { sharpe: number; maxDD: number; hitRate: number };
  health: string;
  nextMilestone: string;
}): string {
  return [
    `📊 <b>FRACTAL DAILY DIGEST</b>`,
    ``,
    `📅 ${payload.date} | ${payload.symbol}`,
    ``,
    `<b>Signals</b>`,
    `Total: ${payload.signals.total} | Resolved: ${payload.signals.resolved} | Pending: ${payload.signals.pending}`,
    ``,
    `<b>Performance</b>`,
    `Sharpe: ${fmt(payload.performance.sharpe)} | MaxDD: ${fmtPct(payload.performance.maxDD)} | HitRate: ${fmtPct(payload.performance.hitRate)}`,
    ``,
    `Health: <b>${payload.health}</b>`,
    `Next: ${payload.nextMilestone}`,
  ].join('\n');
}

export function buildStartupNotification(payload: {
  version: string;
  environment: string;
  instanceId: string;
  enabledFeatures: string[];
}): string {
  return [
    `🚀 <b>FRACTAL STARTED</b>`,
    ``,
    `Version: <b>${payload.version}</b>`,
    `Environment: ${payload.environment}`,
    `Instance: <code>${payload.instanceId}</code>`,
    ``,
    `<b>Enabled:</b>`,
    payload.enabledFeatures.map(f => `✓ ${f}`).join('\n'),
  ].join('\n');
}

export function buildShutdownNotification(payload: {
  reason: string;
  uptime: string;
  lastJob?: string;
}): string {
  return [
    `🛑 <b>FRACTAL SHUTDOWN</b>`,
    ``,
    `Reason: ${payload.reason}`,
    `Uptime: ${payload.uptime}`,
    payload.lastJob ? `Last Job: ${payload.lastJob}` : '',
  ].filter(Boolean).join('\n');
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function fmt(x: any): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return typeof x === 'number' ? x.toFixed(3) : String(x);
}

function fmtPct(x: any): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const n = typeof x === 'number' ? x : Number(x);
  if (Number.isNaN(n)) return '—';
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return pct.toFixed(1) + '%';
}
