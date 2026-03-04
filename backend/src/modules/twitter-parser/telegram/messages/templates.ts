/**
 * Twitter Parser Module — Telegram Message Templates
 * 
 * HTML templates for all events.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY templates without contract update
 */

import type { TelegramEvent, EventPayload } from './event.types.js';

// Message config
interface MessageConfig {
  emoji: string;
  title: string;
  template: (payload: EventPayload) => string;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Message templates — FROZEN
 */
export const MESSAGE_TEMPLATES: Record<TelegramEvent, MessageConfig> = {
  // ============================================
  // USER Events
  // ============================================
  
  'NEW_TWEETS': {
    emoji: '🟢',
    title: 'New tweets detected',
    template: (p) => {
      let text = `<b>Target:</b> <code>${escapeHtml(p.target || 'unknown')}</code>\n`;
      text += `<b>Fetched:</b> ${p.count} tweets`;
      
      // Top mentions (max 3)
      if (p.tweets && Array.isArray(p.tweets) && p.tweets.length > 0) {
        text += '\n\n<b>Top mentions:</b>';
        const shown = p.tweets.slice(0, 3);
        for (const tweet of shown) {
          const author = tweet.author || 'unknown';
          const content = (tweet.text || '').slice(0, 80);
          text += `\n• <b>${escapeHtml(author)}:</b> "${escapeHtml(content)}${tweet.text?.length > 80 ? '...' : ''}"`;
        }
        if (p.tweets.length > 3) {
          text += `\n\n<i>...and ${p.tweets.length - 3} more</i>`;
        }
      }
      
      if (p.timeAgo) {
        text += `\n\n⏱ ${p.timeAgo}`;
      }
      
      return text;
    },
  },
  
  'SESSION_EXPIRED': {
    emoji: '⚠️',
    title: 'Twitter session expired',
    template: (p) => {
      let text = '';
      if (p.account) {
        text += `<b>Account:</b> <code>@${escapeHtml(p.account)}</code>\n\n`;
      }
      text += '<b>Action required:</b>\nPlease re-sync your Twitter session via the Chrome Extension.';
      return text;
    },
  },
  
  'SESSION_RESYNCED': {
    emoji: '✅',
    title: 'Session restored',
    template: (p) => {
      let text = 'Your Twitter session has been restored successfully.';
      if (p.account) {
        text += `\n\n<b>Account:</b> <code>@${escapeHtml(p.account)}</code>`;
      }
      text += '\n\nParsing will resume automatically.';
      return text;
    },
  },
  
  'SESSION_OK': {
    emoji: '🟢',
    title: 'Session active',
    template: (p) => {
      let text = 'Twitter session is now active and healthy.';
      if (p.account) {
        text += `\n\n<b>Account:</b> <code>@${escapeHtml(p.account)}</code>`;
      }
      return text;
    },
  },
  
  'SESSION_STALE': {
    emoji: '🟠',
    title: 'Session warning',
    template: (p) => {
      let text = 'Your Twitter session needs attention.';
      if (p.account) {
        text += `\n\n<b>Account:</b> <code>@${escapeHtml(p.account)}</code>`;
      }
      text += '\n\n<b>Recommendation:</b> Sync cookies to refresh session.';
      return text;
    },
  },
  
  'TARGET_COOLDOWN': {
    emoji: '⏸',
    title: 'Target temporarily paused',
    template: (p) => {
      let text = `<b>Target:</b> <code>${escapeHtml(p.target || 'unknown')}</code>\n`;
      text += '<b>Reason:</b> no new results\n';
      text += `<b>Cooldown:</b> ${p.durationMinutes || 10} minutes`;
      return text;
    },
  },
  
  'HIGH_RISK': {
    emoji: '⚠️',
    title: 'Account stability warning',
    template: (p) => {
      let text = 'Your Twitter account shows unstable behaviour.\n';
      text += 'We recommend waiting or re-syncing the session.';
      if (p.riskScore) {
        text += `\n\n<b>Risk score:</b> ${p.riskScore}/100`;
      }
      return text;
    },
  },
  
  'PARSE_COMPLETED': {
    emoji: '✅',
    title: 'Parsing complete',
    template: (p) => {
      let text = 'Parsing task completed successfully.';
      if (p.fetched !== undefined) text += `\n\n<b>Fetched:</b> ${p.fetched} posts`;
      if (p.target) text += `\n<b>Target:</b> <code>${escapeHtml(p.target)}</code>`;
      return text;
    },
  },
  
  'PARSE_ABORTED': {
    emoji: '❌',
    title: 'Parsing aborted',
    template: (p) => {
      let text = `<b>Target:</b> <code>${escapeHtml(p.target || p.account || 'unknown')}</code>\n`;
      text += `<b>Reason:</b> ${escapeHtml(p.reason || 'unknown error')}\n\n`;
      text += 'The task will retry automatically if possible.';
      return text;
    },
  },
  
  // ============================================
  // SYSTEM Events
  // ============================================
  
  'PARSER_DOWN': {
    emoji: '🚨',
    title: 'PARSER DOWN',
    template: (p) => {
      let text = '<b>Service:</b> twitter-parser\n';
      text += `<b>Time:</b> ${new Date().toISOString().slice(11, 19)} UTC\n`;
      text += `<b>Reason:</b> ${escapeHtml(p.error || 'connection failed')}`;
      return text;
    },
  },
  
  'PARSER_UP': {
    emoji: '✅',
    title: 'PARSER RESTORED',
    template: (p) => {
      let text = '';
      if (p.downtimeMinutes) {
        text += `<b>Downtime:</b> ${p.downtimeMinutes} min\n`;
      }
      text += 'Service is operational.';
      return text;
    },
  },
  
  'ABORT_RATE_HIGH': {
    emoji: '⚠️',
    title: 'High abort rate detected',
    template: (p) => {
      let text = `<b>Window:</b> last 1h\n`;
      text += `<b>Abort rate:</b> ${p.abortRate || 0}%\n`;
      text += '<b>Action:</b> monitoring';
      return text;
    },
  },
  
  'SYSTEM_COOLDOWN': {
    emoji: '🧊',
    title: 'System cooldown activated',
    template: (p) => {
      let text = '';
      if (p.reason) text += `<b>Reason:</b> ${escapeHtml(p.reason)}\n`;
      if (p.durationMinutes) text += `<b>Duration:</b> ${p.durationMinutes} minutes`;
      return text;
    },
  },
};

/**
 * Get template for event
 */
export function getTemplate(event: TelegramEvent): MessageConfig | undefined {
  return MESSAGE_TEMPLATES[event];
}
