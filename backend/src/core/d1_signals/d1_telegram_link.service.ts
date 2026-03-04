/**
 * EPIC D1 — Telegram Linking Service
 * 
 * ETAP 5.1: User-to-Telegram linking for Signal alerts
 * 
 * Features:
 * - One-time linking tokens (TTL 5 min)
 * - /link command support
 * - Test signal endpoint
 * 
 * NO subscriptions. NO settings. Read-only alerts.
 */
import mongoose, { Schema, Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

// ==================== MODELS ====================

/**
 * Telegram Link - connects userId to telegramChatId
 */
export interface ITelegramLink extends Document {
  userId: string;
  telegramChatId: string;
  linkedAt: Date;
  isActive: boolean;
}

const TelegramLinkSchema = new Schema<ITelegramLink>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    telegramChatId: {
      type: String,
      required: true,
      index: true,
    },
    linkedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'd1_telegram_links',
  }
);

export const TelegramLinkModel = mongoose.model<ITelegramLink>(
  'D1TelegramLink',
  TelegramLinkSchema
);

// ==================== LINKING TOKEN STORAGE ====================

interface PendingLink {
  userId: string;
  code: string;
  expiresAt: number;
}

// In-memory storage for pending links (TTL 5 min)
const pendingLinks = new Map<string, PendingLink>();

// Cleanup expired links every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, link] of pendingLinks.entries()) {
    if (now > link.expiresAt) {
      pendingLinks.delete(code);
    }
  }
}, 60 * 1000);

// ==================== LINKING FUNCTIONS ====================

/**
 * Generate a short linking code
 */
function generateLinkCode(): string {
  // Format: FOMO-XXXX (4 chars)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars
  let code = 'FOMO-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a pending link for a user
 * Returns the linking code
 */
export function createLinkCode(userId: string): { code: string; expiresIn: number } {
  // Remove any existing pending link for this user
  for (const [code, link] of pendingLinks.entries()) {
    if (link.userId === userId) {
      pendingLinks.delete(code);
    }
  }
  
  const code = generateLinkCode();
  const expiresIn = 5 * 60; // 5 minutes
  
  pendingLinks.set(code, {
    userId,
    code,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  
  console.log(`[D1 TG Link] Created code ${code} for user ${userId}`);
  
  return { code, expiresIn };
}

/**
 * Validate and consume a linking code
 * Returns userId if valid, null otherwise
 */
export function validateLinkCode(code: string): string | null {
  const upperCode = code.toUpperCase();
  const link = pendingLinks.get(upperCode);
  
  if (!link) {
    console.log(`[D1 TG Link] Code ${upperCode} not found`);
    return null;
  }
  
  if (Date.now() > link.expiresAt) {
    console.log(`[D1 TG Link] Code ${upperCode} expired`);
    pendingLinks.delete(upperCode);
    return null;
  }
  
  // Consume the code
  pendingLinks.delete(upperCode);
  console.log(`[D1 TG Link] Code ${upperCode} validated for user ${link.userId}`);
  
  return link.userId;
}

/**
 * Save telegram link
 */
export async function saveTelegramLink(
  userId: string,
  chatId: string
): Promise<ITelegramLink> {
  const link = await TelegramLinkModel.findOneAndUpdate(
    { userId },
    {
      telegramChatId: chatId,
      linkedAt: new Date(),
      isActive: true,
    },
    { upsert: true, new: true }
  );
  
  console.log(`[D1 TG Link] Saved link: user=${userId}, chat=${chatId}`);
  
  return link;
}

/**
 * Get telegram link for user
 */
export async function getTelegramLink(userId: string): Promise<ITelegramLink | null> {
  return TelegramLinkModel.findOne({ userId, isActive: true });
}

/**
 * Get all active telegram links (for broadcast)
 */
export async function getAllActiveLinks(): Promise<ITelegramLink[]> {
  return TelegramLinkModel.find({ isActive: true }).lean();
}

/**
 * Unlink telegram
 */
export async function unlinkTelegram(userId: string): Promise<boolean> {
  const result = await TelegramLinkModel.updateOne(
    { userId },
    { isActive: false }
  );
  return result.modifiedCount > 0;
}

// ==================== TEST SIGNAL ====================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const APP_DOMAIN = process.env.REACT_APP_BACKEND_URL || 'https://blockview.app';

/**
 * Send test signal to user
 */
export async function sendTestSignal(userId: string): Promise<{ ok: boolean; error?: string }> {
  // Get user's telegram link
  const link = await getTelegramLink(userId);
  
  if (!link) {
    return { ok: false, error: 'Telegram not linked' };
  }
  
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'Bot not configured' };
  }
  
  // Send test message
  const message = `🧪 <b>Test Alert</b>

Your Telegram is successfully connected to FOMO.

You will receive high-severity structural signals here.

<i>This is NOT trading advice.</i>`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: link.telegramChatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    const data = await response.json();
    
    if (data.ok) {
      console.log(`[D1 TG Link] Test signal sent to user ${userId}`);
      return { ok: true };
    } else {
      console.error(`[D1 TG Link] Test signal failed:`, data.description);
      return { ok: false, error: data.description };
    }
  } catch (err) {
    console.error(`[D1 TG Link] Test signal error:`, err);
    return { ok: false, error: String(err) };
  }
}
