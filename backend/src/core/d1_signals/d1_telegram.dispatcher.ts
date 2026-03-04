/**
 * EPIC D1 — Telegram Signal Dispatcher
 * 
 * ETAP 5: Read-only Telegram notifications for HIGH severity signals
 * 
 * Rules:
 * - ONLY severity = HIGH
 * - ONLY status = ACTIVE or NEW
 * - ONLY first seen (not already sent)
 * - One signal = one message (idempotent)
 * 
 * NO trading advice. NO ML. FACTS ONLY.
 */
import { sendTelegramMessage } from '../notifications/telegram.service.js';
import { SignalNotificationModel, wasAlreadySent, markAsSent } from './d1_signal_notification.model.js';
import type { D1Signal } from './d1_signal.types.js';

// ==================== CONFIG ====================

const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED !== 'false';
const TELEGRAM_DRY_RUN = process.env.TELEGRAM_DRY_RUN === 'true';
const APP_DOMAIN = process.env.REACT_APP_BACKEND_URL || 'https://blockview.app';

// Import connection models for broadcast
import { TelegramConnectionModel } from '../notifications/telegram.service.js';
import { TelegramLinkModel } from './d1_telegram_link.service.js';

// ==================== TYPES ====================

interface DispatchResult {
  signalId: string;
  sent: boolean;
  reason?: string;
  messageId?: string;
  error?: string;
}

// ==================== ELIGIBILITY ====================

/**
 * Check if signal is eligible for Telegram notification
 * 
 * Criteria (ETAP 7 Updated):
 * - severity = HIGH
 * - status = ACTIVE or NEW  
 * - confidenceLabel != HIDDEN
 * - not already sent
 */
function isEligibleForTelegram(signal: D1Signal): boolean {
  // Only HIGH severity
  if (signal.severity !== 'high') {
    return false;
  }
  
  // Only ACTIVE or NEW status
  if (!['active', 'new'].includes(signal.status)) {
    return false;
  }
  
  // ETAP 7: Check confidence label
  const confidenceLabel = (signal as any).confidenceLabel;
  if (confidenceLabel === 'HIDDEN') {
    return false;
  }
  
  return true;
}

// ==================== MESSAGE FORMATTING ====================

/**
 * Format signal for Telegram message
 * 
 * SPEC: ETAP 7 format with confidence
 */
function formatSignalMessage(signal: D1Signal): string {
  // Get actors from entities
  const actors = signal.entities || [];
  const actorNames = actors.map(a => a.label).slice(0, 3);
  
  // Format actor flow
  let actorFlow = '';
  if (actorNames.length >= 2) {
    actorFlow = `• ${actorNames[0]} → ${actorNames[1]}`;
  } else if (actorNames.length === 1) {
    actorFlow = `• ${actorNames[0]}`;
  }
  
  // Get "why" explanation
  const why = signal.summary?.what || signal.subtitle || 'Structural change detected above historical baseline.';
  
  // ETAP 7: Get confidence info
  const confidenceLabel = (signal as any).confidenceLabel || 'MEDIUM';
  const confidenceReasons = (signal as any).confidenceReasons || [];
  
  // Format confidence reasons (top 2-3)
  const reasonsText = confidenceReasons.slice(0, 3)
    .map((r: string) => `• ${r}`)
    .join('\n');
  
  return `🚨 <b>${confidenceLabel} CONFIDENCE SIGNAL</b>

Type: <b>${signal.type}</b>
Severity: <b>HIGH</b>
Window: ${signal.window}

<b>Actors:</b>
${actorFlow || '• See details'}

<b>Why:</b>
${escapeHtml(why)}

<b>Confidence:</b>
${reasonsText || '• Data validated'}

<i>This is NOT trading advice. Not a prediction.</i>`;
}

/**
 * Create inline keyboard with "View Signal" button
 */
function createInlineKeyboard(signalId: string): object {
  const signalUrl = `${APP_DOMAIN}/signals/${signalId}`;
  
  return {
    inline_keyboard: [[
      {
        text: '📊 View Signal',
        url: signalUrl
      }
    ]]
  };
}

// ==================== SEND FUNCTION ====================

/**
 * Send Telegram message with inline button
 */
async function sendTelegramWithButton(
  chatId: string,
  text: string,
  replyMarkup: object
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'Bot token not configured' };
  }
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
    
    const data = await response.json();
    
    if (data.ok) {
      return { ok: true, messageId: data.result?.message_id };
    } else {
      return { ok: false, error: data.description || 'Unknown error' };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ==================== DISPATCHER ====================

/**
 * Dispatch a single signal to Telegram if eligible
 */
export async function dispatchSignalToTelegram(signal: D1Signal): Promise<DispatchResult> {
  const result: DispatchResult = {
    signalId: signal.id,
    sent: false,
  };
  
  // Check if Telegram is enabled
  if (!TELEGRAM_ENABLED) {
    result.reason = 'Telegram disabled';
    return result;
  }
  
  // ETAP 7: Detailed eligibility check with specific reasons
  if (signal.severity !== 'high') {
    result.reason = `Not eligible: severity=${signal.severity} (must be HIGH)`;
    return result;
  }
  
  if (!['active', 'new'].includes(signal.status)) {
    result.reason = `Not eligible: status=${signal.status} (must be ACTIVE or NEW)`;
    return result;
  }
  
  const confidenceLabel = (signal as any).confidenceLabel;
  if (confidenceLabel === 'HIDDEN') {
    result.reason = `Not eligible: confidenceLabel=HIDDEN (confidence < 40)`;
    return result;
  }
  
  // Check if already sent
  const alreadySent = await wasAlreadySent(signal.id, 'telegram');
  if (alreadySent) {
    result.reason = 'Already sent';
    return result;
  }
  
  // Get target chat IDs
  // Priority: 1) Specific TELEGRAM_CHAT_ID, 2) D1 Telegram Links, 3) Legacy connections
  let chatIds: string[] = [];
  
  if (TELEGRAM_CHAT_ID) {
    chatIds = [TELEGRAM_CHAT_ID];
  } else {
    // Get D1 telegram links (primary for signals)
    const d1Links = await TelegramLinkModel.find({ isActive: true }).lean();
    const d1ChatIds = d1Links.map((l: any) => l.telegramChatId);
    
    // Also get legacy connections as fallback
    const legacyConnections = await TelegramConnectionModel.find({ isActive: true }).lean();
    const legacyChatIds = legacyConnections.map((c: any) => c.chatId);
    
    // Merge and dedupe
    chatIds = [...new Set([...d1ChatIds, ...legacyChatIds])];
  }
  
  if (chatIds.length === 0) {
    result.reason = 'No recipients configured';
    return result;
  }
  
  // Dry run mode
  if (TELEGRAM_DRY_RUN) {
    console.log(`[TG Dispatcher] DRY RUN - Would send signal ${signal.id} to ${chatIds.length} recipients`);
    result.sent = true;
    result.reason = 'Dry run';
    return result;
  }
  
  // Format message
  const messageText = formatSignalMessage(signal);
  const keyboard = createInlineKeyboard(signal.id);
  
  console.log(`[TG Dispatcher] Sending signal ${signal.id} to ${chatIds.length} recipients`);
  
  // Send to all recipients
  let successCount = 0;
  let lastMessageId: string | undefined;
  let lastError: string | undefined;
  
  for (const chatId of chatIds) {
    const sendResult = await sendTelegramWithButton(chatId, messageText, keyboard);
    if (sendResult.ok) {
      successCount++;
      lastMessageId = sendResult.messageId?.toString();
    } else {
      lastError = sendResult.error;
    }
  }
  
  // Mark as sent (success or failure)
  await markAsSent(signal.id, 'telegram', {
    success: successCount > 0,
    error: successCount === 0 ? lastError : undefined,
    messageId: lastMessageId,
  });
  
  if (successCount > 0) {
    result.sent = true;
    result.messageId = lastMessageId;
    console.log(`[TG Dispatcher] SUCCESS - Signal ${signal.id} sent to ${successCount}/${chatIds.length} recipients`);
  } else {
    result.error = lastError || 'Failed to send';
    console.error(`[TG Dispatcher] FAILED - Signal ${signal.id}: ${lastError}`);
  }
  
  return result;
}

/**
 * Dispatch multiple signals to Telegram
 * Called after Engine run
 */
export async function dispatchSignalsToTelegram(signals: D1Signal[]): Promise<{
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  results: DispatchResult[];
}> {
  const results: DispatchResult[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const signal of signals) {
    const result = await dispatchSignalToTelegram(signal);
    results.push(result);
    
    if (result.sent) {
      sent++;
    } else if (result.error) {
      failed++;
    } else {
      skipped++;
    }
  }
  
  console.log(`[TG Dispatcher] Batch complete: ${sent} sent, ${skipped} skipped, ${failed} failed`);
  
  return {
    total: signals.length,
    sent,
    skipped,
    failed,
    results,
  };
}

/**
 * Send test signal to verify Telegram is working
 */
export async function sendTestSignal(): Promise<DispatchResult> {
  const mockSignal: D1Signal = {
    id: `sig_test_${Date.now()}`,
    type: 'NEW_CORRIDOR',
    scope: 'corridor',
    status: 'active',
    severity: 'high',
    confidence: 'high',
    window: '7d',
    title: 'Test Signal - New Corridor Detected',
    subtitle: 'This is a test notification from the Signal Engine.',
    entities: [
      { kind: 'actor', id: 'test_actor_1', label: 'Test Actor A' },
      { kind: 'actor', id: 'test_actor_2', label: 'Test Actor B' },
    ],
    metrics: {
      density: { current: 10, previous: 2, deltaPct: 400 },
    },
    tags: ['Test'],
    evidence: {
      rule: { name: 'TEST', version: '1.0' },
    },
    summary: {
      what: 'This is a test signal to verify Telegram integration.',
      whyNow: 'Triggered manually for testing.',
      soWhat: 'No action needed - this is just a test.',
    },
    links: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as D1Signal;
  
  // Add ETAP 7 confidence fields for test signal
  (mockSignal as any).confidenceScore = 85;
  (mockSignal as any).confidenceLabel = 'HIGH';
  (mockSignal as any).confidenceBreakdown = {
    coverage: 80,
    actors: 90,
    flow: 85,
    temporal: 80,
    evidence: 90,
  };
  (mockSignal as any).confidenceReasons = [
    'Test data coverage',
    'Verified test actors',
    'High flow significance',
  ];
  
  return dispatchSignalToTelegram(mockSignal);
}

// ==================== HELPERS ====================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
