/**
 * Phase 5.2.1 - Telegram Binding Routes for Twitter Module
 * 
 * Endpoints:
 * - POST /api/v4/user/telegram/bind-link - Generate bind link
 * - GET /api/v4/user/telegram/status - Get connection status
 * - POST /api/v4/user/telegram/unbind - Disconnect Telegram
 * - POST /api/v4/user/telegram/test - Send test message
 * - PATCH /api/v4/user/telegram/preferences - Update notification preferences
 * 
 * RULES:
 * - Telegram = output channel ONLY
 * - All settings controlled via WEB/ADMIN
 * - No Telegram-side configuration
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TelegramNotifierV2 } from '../notifications/telegram-notifier.js';
import { 
  TelegramConnectionModel, 
  createPendingConnection,
  sendTelegramMessage,
} from '../../../core/notifications/telegram.service.js';
import crypto from 'crypto';

// Bot username from env or default
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'FOMO_a_bot';

// Helper to get userId from request
function getUserId(request: FastifyRequest): string | null {
  const userId = request.headers['x-user-id'] as string;
  return userId || null;
}

export async function telegramBindingRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/v4/user/telegram/bind-link
   * Generate a new bind link for the user
   * 
   * Response:
   * {
   *   ok: true,
   *   url: "https://t.me/bot?start=bind_xxx"
   * }
   */
  app.post('/api/v4/user/telegram/bind-link', async (request, reply) => {
    const userId = getUserId(request);
    
    if (!userId) {
      return reply.code(401).send({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }
    
    try {
      // Generate unique bind token
      const token = `bind_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Store pending link in TelegramConnection
      await TelegramConnectionModel.findOneAndUpdate(
        { userId },
        {
          userId,
          pendingLinkToken: token,
          pendingLinkExpires: expiresAt,
        },
        { upsert: true }
      );
      
      // Also store in memory for quick validation (existing system)
      createPendingConnection(userId);
      
      const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`;
      
      console.log(`[Telegram Binding] Generated bind link for user ${userId}: ${token}`);
      
      return reply.send({
        ok: true,
        url,
        expiresIn: 600, // seconds
      });
    } catch (err: any) {
      console.error('[Telegram Binding] Error generating bind link:', err);
      return reply.code(500).send({
        ok: false,
        error: 'BIND_LINK_ERROR',
        message: err.message,
      });
    }
  });
  
  /**
   * GET /api/v4/user/telegram/status
   * Get current Telegram connection status
   * 
   * Response:
   * {
   *   connected: true/false,
   *   telegramChatId?: "masked",
   *   username?: "@username",
   *   enabled?: true/false,
   *   eventPreferences?: {...}
   * }
   */
  app.get('/api/v4/user/telegram/status', async (request, reply) => {
    const userId = getUserId(request);
    
    if (!userId) {
      return reply.code(401).send({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }
    
    try {
      const info = await TelegramNotifierV2.getConnectionInfo(userId);
      
      return reply.send({
        ok: true,
        data: info,
      });
    } catch (err: any) {
      console.error('[Telegram Binding] Error getting status:', err);
      return reply.code(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: err.message,
      });
    }
  });
  
  /**
   * POST /api/v4/user/telegram/unbind
   * Disconnect Telegram (disable, keep chatId for future)
   */
  app.post('/api/v4/user/telegram/unbind', async (request, reply) => {
    const userId = getUserId(request);
    
    if (!userId) {
      return reply.code(401).send({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }
    
    try {
      const disconnected = await TelegramNotifierV2.disconnect(userId);
      
      return reply.send({
        ok: true,
        disconnected,
        message: disconnected 
          ? 'Telegram disconnected successfully' 
          : 'No active connection found',
      });
    } catch (err: any) {
      console.error('[Telegram Binding] Error unbinding:', err);
      return reply.code(500).send({
        ok: false,
        error: 'UNBIND_ERROR',
        message: err.message,
      });
    }
  });
  
  /**
   * POST /api/v4/user/telegram/test
   * Send a test message to verify connection
   */
  app.post('/api/v4/user/telegram/test', async (request, reply) => {
    const userId = getUserId(request);
    
    if (!userId) {
      return reply.code(401).send({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }
    
    try {
      const result = await TelegramNotifierV2.sendTestMessage(userId);
      
      return reply.send({
        ok: result.sent,
        error: result.error,
        message: result.sent 
          ? 'Test message sent successfully' 
          : `Failed to send: ${result.error}`,
      });
    } catch (err: any) {
      console.error('[Telegram Binding] Error sending test:', err);
      return reply.code(500).send({
        ok: false,
        error: 'TEST_ERROR',
        message: err.message,
      });
    }
  });
  
  /**
   * PATCH /api/v4/user/telegram/preferences
   * Update notification event preferences
   * 
   * Body:
   * {
   *   sessionOk?: boolean,
   *   sessionStale?: boolean,
   *   sessionInvalid?: boolean,
   *   parseCompleted?: boolean,
   *   parseAborted?: boolean,
   *   cooldown?: boolean,
   *   highRisk?: boolean
   * }
   */
  app.patch('/api/v4/user/telegram/preferences', async (request, reply) => {
    const userId = getUserId(request);
    
    if (!userId) {
      return reply.code(401).send({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }
    
    const body = request.body as {
      sessionOk?: boolean;
      sessionStale?: boolean;
      sessionInvalid?: boolean;
      parseCompleted?: boolean;
      parseAborted?: boolean;
      cooldown?: boolean;
      highRisk?: boolean;
    };
    
    try {
      const result = await TelegramNotifierV2.updateEventPreferences(userId, body);
      
      if (!result.updated) {
        return reply.code(404).send({
          ok: false,
          error: 'NO_CONNECTION',
          message: 'No active Telegram connection found',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          eventPreferences: result.eventPreferences,
        },
        message: 'Preferences updated successfully',
      });
    } catch (err: any) {
      console.error('[Telegram Binding] Error updating preferences:', err);
      return reply.code(500).send({
        ok: false,
        error: 'PREFERENCES_ERROR',
        message: err.message,
      });
    }
  });
  
  app.log.info('Telegram binding routes registered (Phase 5.2.1)');
}
