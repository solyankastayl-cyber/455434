/**
 * FRACTAL OPS — Telegram Message Templates (Institutional Style)
 * 
 * Message types:
 * 1. Daily Job Report
 * 2. Critical/Halt Alert
 * 3. Milestone (30+ resolved)
 * 4. Test message
 */

type DailyRunSummary = {
  asofDate: string;
  symbol: string;
  steps: {
    write: { success?: boolean; written?: number; skipped?: number };
    resolve: { success?: boolean; resolved?: number };
    rebuild: { success?: boolean };
    alerts?: { success?: boolean; sent?: number; blocked?: number; quotaUsed?: number; quotaMax?: number };
    audit: { success?: boolean };
    memory?: { success?: boolean; written?: number; resolved?: number };
  };
  health: { level: 'HEALTHY' | 'WATCH' | 'ALERT' | 'CRITICAL'; reasons: string[] };
  reliability: { badge: string; score: number };
  forward?: {
    sharpe30?: number;
    maxDD60?: number;
    hitRate7?: number;
    trades?: number;
  };
  resolvedCount?: number;
  governanceMode?: string;
  alerts?: {
    sent: number;
    blocked: number;
    quotaUsed: number;
    quotaMax: number;
  };
  memory?: {
    snapshotsWritten: number;
    outcomesResolved: number;
  };
};

export function buildDailyReport(s: DailyRunSummary): string {
  const r = s.reliability;
  const h = s.health;
  const st = s.steps;

  const healthEmoji = {
    'HEALTHY': '🟢',
    'WATCH': '🟡',
    'ALERT': '🟠',
    'CRITICAL': '🔴'
  }[h.level] || '⚪';

  const reasons = h.reasons?.length ? h.reasons.map(x => `• ${x}`).join('\n') : '—';
  
  const forward = s.forward
    ? [
        `Sharpe(30d): <b>${fmt(s.forward.sharpe30)}</b>`,
        `MaxDD(60d): <b>${fmtPct(s.forward.maxDD60)}</b>`,
        `HitRate(7d): <b>${fmtPct(s.forward.hitRate7)}</b>`,
        `Trades: <b>${s.forward.trades ?? '—'}</b>`
      ].join(' | ')
    : 'Forward: accumulating...';

  // Build alerts line
  const alertsLine = s.alerts
    ? `Alerts: sent <b>${s.alerts.sent}</b> | blocked <b>${s.alerts.blocked}</b> | quota <b>${s.alerts.quotaUsed}/${s.alerts.quotaMax}</b>`
    : 'Alerts: —';

  // Build memory line (BLOCK 75)
  const memoryLine = s.memory
    ? `🧠 MEMORY: wrote <b>${s.memory.snapshotsWritten}</b> | resolved <b>${s.memory.outcomesResolved}</b>`
    : '';

  return [
    `${healthEmoji} <b>FRACTAL DAILY</b> — ${s.symbol}`,
    ``,
    `📅 ${s.asofDate}`,
    `Mode: <b>${s.governanceMode || 'NORMAL'}</b>`,
    `Health: <b>${h.level}</b> | Badge: <b>${r.badge}</b> (${fmtPct(r.score)})`,
    ``,
    `<b>Pipeline</b>`,
    `WRITE: ${badgeOk(st.write?.success)} (${st.write?.written || 0}/${st.write?.skipped || 0})`,
    `RESOLVE: ${badgeOk(st.resolve?.success)} (${st.resolve?.resolved || 0})`,
    `REBUILD: ${badgeOk(st.rebuild?.success)} | AUDIT: ${badgeOk(st.audit?.success)}`,
    alertsLine,
    memoryLine,
    ``,
    `<b>Forward Truth</b>`,
    forward,
    ``,
    `Resolved: <b>${s.resolvedCount ?? 0}</b>/30`,
    reasons !== '—' ? `\n<b>Reasons</b>\n${reasons}` : ''
  ].filter(Boolean).join('\n');
}

export function buildCriticalAlert(payload: {
  symbol: string;
  mode: string;
  triggeredBy: string[];
  reliabilityBadge: string;
  reliabilityScore: number;
  tailRiskP95?: number;
  entropy?: number;
  maxDDForward?: number;
  url?: string;
}): string {
  return [
    `🔴 <b>FRACTAL CRITICAL ALERT</b> — ${payload.symbol}`,
    ``,
    `⚠️ Governance Mode: <b>${payload.mode}</b>`,
    `Triggered By: <b>${payload.triggeredBy.join(', ') || 'UNKNOWN'}</b>`,
    ``,
    `Reliability: <b>${payload.reliabilityBadge}</b> (${fmtPct(payload.reliabilityScore)})`,
    `Tail Risk P95: <b>${fmtPct(payload.tailRiskP95)}</b>`,
    `Entropy: <b>${fmtPct(payload.entropy)}</b>`,
    `Forward MaxDD: <b>${fmtPct(payload.maxDDForward)}</b>`,
    ``,
    `<b>Action Required:</b>`,
    `→ Review admin panel`,
    `→ Consider FREEZE or INVESTIGATION`,
    payload.url ? `\n🔗 ${payload.url}` : ''
  ].filter(Boolean).join('\n');
}

export function buildMilestone30Resolved(payload: {
  symbol: string;
  resolvedCount: number;
  verdict: string;
  deltaSharpe?: number;
  deltaMaxDD?: number;
  url?: string;
}): string {
  return [
    `📊 <b>FRACTAL MILESTONE</b> — ${payload.symbol}`,
    ``,
    `✅ Resolved Signals: <b>${payload.resolvedCount}</b>`,
    `Shadow Verdict: <b>${payload.verdict}</b>`,
    payload.deltaSharpe !== undefined ? `ΔSharpe: <b>${fmt(payload.deltaSharpe)}</b>` : '',
    payload.deltaMaxDD !== undefined ? `ΔMaxDD: <b>${fmtPct(payload.deltaMaxDD)}</b>` : '',
    ``,
    `<b>Governance Actions Now Enabled:</b>`,
    `→ Manual Promotion`,
    `→ Shadow Freeze`,
    `→ Parameter Review`,
    payload.url ? `\n🔗 ${payload.url}` : ''
  ].filter(Boolean).join('\n');
}

export function buildTestMessage(): string {
  const now = new Date().toISOString();
  return [
    `🧪 <b>FRACTAL TEST MESSAGE</b>`,
    ``,
    `Timestamp: ${now}`,
    `Status: Telegram integration working`,
    ``,
    `This is a test notification from Fractal Admin.`
  ].join('\n');
}

export function buildJobFailedAlert(payload: {
  symbol: string;
  step: string;
  error: string;
  asofDate?: string;
}): string {
  return [
    `❌ <b>FRACTAL JOB FAILED</b> — ${payload.symbol}`,
    ``,
    `Date: ${payload.asofDate || new Date().toISOString().slice(0, 10)}`,
    `Failed Step: <b>${payload.step}</b>`,
    `Error: <code>${escapeHtml(payload.error.slice(0, 200))}</code>`,
    ``,
    `Manual intervention may be required.`
  ].join('\n');
}

// Helpers
function fmt(x: any): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return typeof x === 'number' ? x.toFixed(3) : String(x);
}

function fmtPct(x: any): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const n = typeof x === 'number' ? x : Number(x);
  if (Number.isNaN(n)) return '—';
  // If value is already percentage (>1), don't multiply
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return pct.toFixed(1) + '%';
}

function badgeOk(ok: any): string {
  return ok ? '✅' : '❌';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
