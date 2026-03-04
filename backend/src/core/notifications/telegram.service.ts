/**
 * Telegram Notification Service
 * 
 * Handles:
 * - User Telegram connections
 * - Alert notifications via Telegram bot
 * - Message formatting
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

// ============================================================================
// TELEGRAM CONNECTION MODEL
// ============================================================================

export interface ITelegramConnection extends Document {
  _id: Types.ObjectId;
  userId: string;
  chatId?: string; // Optional until connection is completed
  username?: string;
  firstName?: string;
  isActive: boolean;
  connectedAt: Date;
  lastMessageAt?: Date;
  // P1 Deep-Link fields
  pendingLinkToken?: string;
  pendingLinkExpires?: Date;
  // B.2.3 - Event Preferences
  eventPreferences?: {
    sessionOk: boolean;
    sessionStale: boolean;
    sessionInvalid: boolean;
    parseCompleted: boolean;
    parseAborted: boolean;
    cooldown: boolean;
    highRisk: boolean;
  };
}

const TelegramConnectionSchema = new Schema<ITelegramConnection>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    chatId: {
      type: String,
      required: false, // Not required until connection is completed
      index: true,
    },
    username: String,
    firstName: String,
    isActive: {
      type: Boolean,
      default: true,
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    lastMessageAt: Date,
    // P1 Deep-Link fields
    pendingLinkToken: String,
    pendingLinkExpires: Date,
    // B.2.3 - Event Preferences (FINAL v1 Contract)
    // newTweets: true (via NEW_TWEETS event)
    // sessionAlerts: true (sessionOk, sessionStale, sessionInvalid)
    // cooldownAlerts: false
    // riskAlerts: false
    eventPreferences: {
      sessionOk: { type: Boolean, default: true },       // sessionAlerts ON
      sessionStale: { type: Boolean, default: true },    // sessionAlerts ON
      sessionInvalid: { type: Boolean, default: true },  // sessionAlerts ON
      parseCompleted: { type: Boolean, default: false }, // OFF (noisy)
      parseAborted: { type: Boolean, default: true },    // ON
      cooldown: { type: Boolean, default: false },       // cooldownAlerts OFF
      highRisk: { type: Boolean, default: false },       // riskAlerts OFF
    },
  },
  {
    timestamps: true,
    collection: 'telegram_connections',
  }
);

export const TelegramConnectionModel = mongoose.model<ITelegramConnection>(
  'TelegramConnection',
  TelegramConnectionSchema
);

// ============================================================================
// TELEGRAM BOT SERVICE
// ============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

interface TelegramSendResult {
  ok: boolean;
  error?: string;
  messageId?: number;
}

/**
 * Send message via Telegram Bot API
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableNotification?: boolean;
  } = {}
): Promise<TelegramSendResult> {
  console.log(`[TG] Attempting to send message to chatId: ${chatId}`);
  
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return { ok: false, error: 'Bot token not configured' };
  }

  try {
    const url = `${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    console.log(`[TG] Sending to ${url.replace(TELEGRAM_BOT_TOKEN, 'TOKEN')}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parseMode || 'HTML',
        disable_notification: options.disableNotification || false,
      }),
    });

    const data = await response.json();
    
    console.log(`[TG] Response:`, data.ok ? 'SUCCESS' : `ERROR: ${data.description}`);

    if (data.ok) {
      // Update last message timestamp
      await TelegramConnectionModel.updateOne(
        { chatId },
        { lastMessageAt: new Date() }
      ).catch(() => {});
      
      return { ok: true, messageId: data.result?.message_id };
    } else {
      console.error('[Telegram] API error:', data);
      return { ok: false, error: data.description || 'Unknown error' };
    }
  } catch (err) {
    console.error('[Telegram] Send error:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Format alert for Telegram
 */
export function formatAlertMessage(alert: {
  title: string;
  message: string;
  scope: string;
  targetId: string;
  signalType: string;
  confidence: number;
  severity: number;
}): string {
  const emoji = getSignalEmoji(alert.signalType);
  const confidencePct = Math.round(alert.confidence * 100);
  
  // Truncate targetId for display
  const targetDisplay = alert.targetId.length > 20 
    ? `${alert.targetId.slice(0, 10)}...${alert.targetId.slice(-6)}`
    : alert.targetId;
  
  return `${emoji} <b>${escapeHtml(alert.title)}</b>

${escapeHtml(alert.message)}

📊 <b>Details:</b>
• Type: ${formatScope(alert.scope)}
• Target: <code>${targetDisplay}</code>
• Confidence: ${confidencePct}%
• Severity: ${alert.severity}/100

<a href="https://blockview.app/${alert.scope}s/${alert.targetId}">View Details →</a>`;
}

/**
 * Format token alert for Telegram (A3 Contract)
 * 
 * CONTRACT: Each notification contains:
 * 1. Insight - What happened
 * 2. Evidence - Supporting data  
 * 3. Implication - Why it matters
 * 4. Next Action - What to do
 */
export function formatTokenAlertMessage(alert: {
  tokenSymbol?: string;
  tokenAddress: string;
  signalType: string;
  confidence: number;
  message: string;
  amount?: number;
  timeframe?: string;
  targetUrl?: string;
}): string {
  const signalConfig = getSignalConfig(alert.signalType);
  const symbol = escapeHtml(alert.tokenSymbol || 'Token');
  const addressDisplay = `${alert.tokenAddress.slice(0, 10)}...${alert.tokenAddress.slice(-6)}`;
  const baseUrl = alert.targetUrl || `https://blockview.app/tokens/${alert.tokenAddress}`;
  
  // Format amount if present
  const amountStr = alert.amount 
    ? formatAmount(alert.amount) 
    : '';
  
  const timeframeStr = alert.timeframe || 'recently';

  // A3 CONTRACT: Insight + Evidence + Implication + Next Action
  return `🔔 <b>${signalConfig.title} — ${symbol}</b>

${signalConfig.insight}${amountStr ? ` ${amountStr}` : ''} ${timeframeStr}.

${signalConfig.implication}

<i>Last observed: just now</i>

👉 <a href="${baseUrl}">View details</a>
👉 <a href="${baseUrl}?action=pause">Pause monitoring</a>`;
}

/**
 * Get signal configuration with product-friendly copy
 */
function getSignalConfig(signalType: string): {
  title: string;
  insight: string;
  implication: string;
} {
  const configs: Record<string, { title: string; insight: string; implication: string }> = {
    'accumulation': {
      title: 'Consistent Buying Observed',
      insight: 'Large wallets accumulated funds',
      implication: 'This behavior often signals long-term positioning.',
    },
    'distribution': {
      title: 'Increasing Selling Observed',
      insight: 'Holders distributed tokens',
      implication: 'This pattern may indicate profit-taking or risk reduction.',
    },
    'large_move': {
      title: 'Unusual Large Transfer Detected',
      insight: 'A significant transfer was detected',
      implication: 'This may indicate whale movement or institutional activity.',
    },
    'smart_money_entry': {
      title: 'Smart Money Entry Detected',
      insight: 'Historically profitable wallets started accumulating',
      implication: 'This is often an early positioning signal.',
    },
    'smart_money_exit': {
      title: 'Smart Money Exit Detected',
      insight: 'Historically profitable wallets are reducing positions',
      implication: 'This may indicate profit-taking or risk assessment.',
    },
    'activity_spike': {
      title: 'Activity Spike Detected',
      insight: 'Unusual surge in activity detected',
      implication: 'This often precedes significant price movement.',
    },
    'net_flow_spike': {
      title: 'Flow Spike Detected',
      insight: 'Unusual flow pattern detected',
      implication: 'This may signal changing market dynamics.',
    },
  };
  
  return configs[signalType] || {
    title: 'Activity Detected',
    insight: 'Notable activity was observed',
    implication: 'Monitor for further developments.',
  };
}

/**
 * Format amount for display
 */
function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  return `$${amount.toLocaleString()}`;
}

/**
 * Send alert notification to user
 */
export async function sendAlertNotification(
  userId: string,
  alert: {
    title: string;
    message: string;
    scope: string;
    targetId: string;
    signalType: string;
    confidence: number;
    severity: number;
  }
): Promise<TelegramSendResult> {
  // Find user's Telegram connection
  const connection = await TelegramConnectionModel.findOne({
    userId,
    isActive: true,
  });

  if (!connection) {
    return { ok: false, error: 'No active Telegram connection' };
  }

  const text = formatAlertMessage(alert);
  return sendTelegramMessage(connection.chatId, text);
}

/**
 * Send token alert notification
 */
export async function sendTokenAlertNotification(
  userId: string,
  alert: {
    tokenSymbol?: string;
    tokenAddress: string;
    signalType: string;
    confidence: number;
    message: string;
  }
): Promise<TelegramSendResult> {
  const connection = await TelegramConnectionModel.findOne({
    userId,
    isActive: true,
  });

  if (!connection) {
    return { ok: false, error: 'No active Telegram connection' };
  }

  const text = formatTokenAlertMessage(alert);
  return sendTelegramMessage(connection.chatId, text);
}

/**
 * Send feedback message when alert triggers too frequently
 * This is NOT an alert - it's an advisory message to reduce noise
 * 
 * A5.3: Telegram Noise Nudge
 * Rules:
 * - Only 1 nudge per 24h
 * - Not for high-priority alerts
 * - Advisory tone, not warning
 */
export async function sendFeedbackMessage(
  userId: string,
  data: {
    targetName: string;
    triggersIn24h: number;
    scope: string;
    dominantReason?: string;
    currentSensitivity?: string;
  }
): Promise<TelegramSendResult> {
  const connection = await TelegramConnectionModel.findOne({
    userId,
    isActive: true,
  });

  if (!connection) {
    return { ok: false, error: 'No active Telegram connection' };
  }

  const scopeLabel = data.scope === 'token' ? 'token' : 'wallet';
  const targetDisplay = escapeHtml(data.targetName);
  const reasonText = data.dominantReason 
    ? `\nMost common trigger: <b>${escapeHtml(data.dominantReason.replace('_', ' '))}</b>` 
    : '';
  const sensitivityText = data.currentSensitivity 
    ? `\nCurrent sensitivity: <b>${data.currentSensitivity}</b>` 
    : '';

  // A5.3: Advisory message - NOT an alert
  const text = `🔔 <b>Monitoring Update — ${targetDisplay}</b>

This behavior was observed ${data.triggersIn24h} times today.
The pattern is now consistent rather than unusual.${reasonText}${sensitivityText}

👉 You may want to <b>reduce sensitivity</b> or <b>pause monitoring</b> if this is expected behavior.

<i>This is not an alert. It's a suggestion to help reduce noise.</i>`;

  return sendTelegramMessage(connection.chatId, text, { disableNotification: true });
}

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

/**
 * Generate connection code for user
 * User sends this code to bot to link account
 */
export function generateConnectionCode(userId: string): string {
  // Simple code: base64 of userId + timestamp
  const payload = `${userId}:${Date.now()}`;
  return Buffer.from(payload).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

/**
 * Store pending connection (before user confirms in Telegram)
 */
const pendingConnections = new Map<string, { userId: string; expiresAt: number }>();

export function createPendingConnection(userId: string): string {
  const code = generateConnectionCode(userId);
  pendingConnections.set(code, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return code;
}

export function validatePendingConnection(code: string): string | null {
  const pending = pendingConnections.get(code);
  if (!pending) return null;
  if (Date.now() > pending.expiresAt) {
    pendingConnections.delete(code);
    return null;
  }
  return pending.userId;
}

export function completePendingConnection(code: string): void {
  pendingConnections.delete(code);
}

/**
 * Save Telegram connection
 * P0 FIX: Also update UserAlertPreferences so Dispatcher can send notifications
 */
export async function saveTelegramConnection(
  userId: string,
  chatId: string,
  username?: string,
  firstName?: string
): Promise<ITelegramConnection> {
  // Save connection
  const connection = await TelegramConnectionModel.findOneAndUpdate(
    { userId },
    {
      chatId,
      username,
      firstName,
      isActive: true,
      connectedAt: new Date(),
    },
    { upsert: true, new: true }
  );
  
  // P0 FIX: Update UserAlertPreferences to enable Telegram and store chatId
  // This is CRITICAL - without this, Dispatcher will not send notifications
  try {
    const { DispatcherEngine } = await import('../alerts/dispatcher/dispatcher.engine.js');
    const dispatcher = new DispatcherEngine();
    
    const currentPrefs = await dispatcher.getUserPreferences(userId);
    
    await dispatcher.updateUserPreferences(userId, {
      channels: currentPrefs.channels.includes('telegram' as any) 
        ? currentPrefs.channels 
        : [...currentPrefs.channels, 'telegram' as any],
      telegram: {
        enabled: true,
        chatId: chatId,
      },
    });
    
    console.log(`[Telegram] Updated UserAlertPreferences for ${userId}: chatId=${chatId}`);
  } catch (error) {
    console.error('[Telegram] Failed to update UserAlertPreferences:', error);
    // Don't fail connection if preferences update fails
  }
  
  return connection;
}

/**
 * Get user's Telegram connection
 */
export async function getTelegramConnection(userId: string): Promise<ITelegramConnection | null> {
  return TelegramConnectionModel.findOne({ userId });
}

/**
 * Disconnect Telegram
 */
export async function disconnectTelegram(userId: string): Promise<boolean> {
  const result = await TelegramConnectionModel.updateOne(
    { userId },
    { isActive: false }
  );
  return result.modifiedCount > 0;
}

// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getSignalEmoji(signalType: string): string {
  const emojis: Record<string, string> = {
    'strategy_detected': '🎯',
    'strategy_confirmed': '✅',
    'strategy_shift': '🔄',
    'strategy_phase_change': '📊',
    'strategy_intensity_spike': '📈',
    'strategy_risk_spike': '⚠️',
    'strategy_influence_jump': '🚀',
    'accumulation': '📥',
    'distribution': '📤',
    'large_move': '💰',
    'smart_money_entry': '🐋',
    'smart_money_exit': '🏃',
  };
  return emojis[signalType] || '🔔';
}

function getTokenSignalEmoji(signalType: string): string {
  const emojis: Record<string, string> = {
    'accumulation': '📥',
    'distribution': '📤',
    'large_move': '💰',
    'smart_money_entry': '🐋',
    'smart_money_exit': '🏃',
    'net_flow_spike': '📊',
    'activity_spike': '⚡',
  };
  return emojis[signalType] || '🚨';
}

function formatScope(scope: string): string {
  const names: Record<string, string> = {
    'token': 'Token',
    'actor': 'Actor',
    'entity': 'Entity',
    'strategy': 'Strategy',
  };
  return names[scope] || scope;
}

function formatSignalType(signalType: string): string {
  return signalType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
