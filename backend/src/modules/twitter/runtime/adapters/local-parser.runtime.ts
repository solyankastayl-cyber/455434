// LocalParser Runtime - MULTI Architecture
// HTTP client to local Twitter Parser service
// Runtime принимает session/proxy и вызывает парсер
// Поддерживает USER и SYSTEM scopes

import {
  TwitterRuntime,
  TwitterTweet,
  TwitterAccount,
  SearchParams,
} from '../runtime.interface.js';
import { RuntimeResponse, RuntimeStatus } from '../runtime.types.js';
import { sessionService } from '../../sessions/session.service.js';
import { proxySlotService } from '../../slots/proxy-slot.service.js';
import { metricsService } from '../../freeze/metrics.service.js';
import { markSessionInvalid, markSessionOk } from '../../sessions/session-health.observer.js';
import { UserTwitterSessionModel } from '../../../twitter-user/models/twitter-session.model.js';
import crypto from 'crypto';

export interface LocalParserConfig {
  parserUrl: string;  // URL to local parser service (e.g., http://localhost:5001)
  timeout?: number;
  scope?: 'USER' | 'SYSTEM';  // Which session pool to use
  userId?: string;  // For USER scope
}

// Get encryption key from environment
const COOKIE_ENC_KEY = process.env.COOKIE_ENC_KEY || '';

function decryptUserCookies(session: any): any[] | null {
  try {
    if (!COOKIE_ENC_KEY) {
      console.error('[LocalParserRuntime] COOKIE_ENC_KEY not set');
      return null;
    }
    
    const key = Buffer.from(COOKIE_ENC_KEY, 'hex');
    const iv = Buffer.from(session.cookiesIv, 'base64');
    const tag = Buffer.from(session.cookiesTag, 'base64');
    const enc = Buffer.from(session.cookiesEnc, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed = JSON.parse(dec.toString('utf8'));
    
    // Return cookies array
    return parsed.cookies || parsed;
  } catch (err) {
    console.error('[LocalParserRuntime] Failed to decrypt USER cookies:', err);
    return null;
  }
}

export class LocalParserRuntime implements TwitterRuntime {
  readonly sourceType = 'LOCAL_PARSER';
  private config: LocalParserConfig;

  constructor(config: LocalParserConfig) {
    this.config = {
      ...config,
      timeout: config.timeout || 120000,
      scope: config.scope || 'USER',  // Default to USER scope
    };
  }

  /**
   * Get session based on scope (USER or SYSTEM)
   */
  private async getSession(): Promise<{ session: any; cookies: any[] | null } | null> {
    if (this.config.scope === 'USER') {
      // USER scope - use user_twitter_sessions
      const userSession = await UserTwitterSessionModel.findOne({
        isActive: true,
        status: 'OK',
      }).sort({ updatedAt: -1 }).lean();

      if (!userSession) {
        console.log('[LocalParserRuntime] No active USER sessions');
        return null;
      }

      const cookies = decryptUserCookies(userSession);
      return { 
        session: { 
          sessionId: userSession._id.toString(),
          userAgent: userSession.userAgent,
        }, 
        cookies 
      };
    } else {
      // SYSTEM scope - use twitter_sessions (original behavior)
      const sessions = await sessionService.findActive();
      const session = sessions[0];

      if (!session) {
        console.log('[LocalParserRuntime] No active SYSTEM sessions');
        return null;
      }

      const cookies = await sessionService.getCookies(session.sessionId);
      return { session, cookies };
    }
  }

  async getHealth(): Promise<RuntimeStatus> {
    try {
      // Check if parser service is running
      const response = await fetch(`${this.config.parserUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) return 'ERROR';
      
      const data = await response.json();
      
      // Check sessions availability based on scope
      const sessionResult = await this.getSession();
      if (!sessionResult || !sessionResult.cookies) {
        console.log(`[LocalParserRuntime] No active sessions (scope=${this.config.scope})`);
        return 'DEGRADED';
      }

      // Check slots availability
      const slots = await proxySlotService.findAvailable();
      if (slots.length === 0) {
        console.log('[LocalParserRuntime] No available proxy slots');
        return 'DEGRADED';
      }

      return data.ok ? 'OK' : 'ERROR';
    } catch (error) {
      console.error('[LocalParserRuntime] Health check failed:', error);
      return 'ERROR';
    }
  }

  async fetchTweetsByKeyword(
    params: SearchParams
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const { keyword, limit = 20 } = params;

    try {
      // 1. Get session based on scope
      const sessionResult = await this.getSession();
      if (!sessionResult) {
        return {
          ok: false,
          status: 'ERROR',
          error: `No active sessions available (scope=${this.config.scope})`,
        };
      }

      const { session, cookies } = sessionResult;

      if (!cookies || cookies.length === 0) {
        return {
          ok: false,
          status: 'ERROR',
          error: 'Failed to get session cookies',
        };
      }

      // 2. Select proxy slot
      const slot = await proxySlotService.selectBestSlot();
      if (!slot) {
        return {
          ok: false,
          status: 'RATE_LIMITED',
          error: 'No proxy slots available (all in cooldown or rate limited)',
        };
      }

      // 3. Build proxy URL (null if direct/no proxy)
      const proxyUrl = proxySlotService.getProxyUrl(slot);

      const startTime = Date.now();
      metricsService.incRuntimeCalls();

      console.log(`[LocalParserRuntime] Calling parser: keyword="${keyword}", scope=${this.config.scope}, session=${session.sessionId}, proxy=${proxyUrl || 'DIRECT (no proxy)'}`);

      // 4. Call local parser with credentials
      const requestBody: any = {
        limit,
        cookies,
        userAgent: session.userAgent,
      };
      // Only add proxyUrl if it's not null
      if (proxyUrl) {
        requestBody.proxyUrl = proxyUrl;
      }
      
      const response = await fetch(`${this.config.parserUrl}/search/${encodeURIComponent(keyword)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout!),
      });

      const duration = Date.now() - startTime;
      metricsService.recordRuntimeLatency(duration);

      // 5. Increment slot usage
      const slotId = (slot as any)._id?.toString() || slot.name;
      await proxySlotService.incrementUsage(slotId);

      // 6. Handle response
      if (!response.ok) {
        const errorText = await response.text();
        metricsService.incRuntimeErrors();

        // Rate limit (429)
        if (response.status === 429) {
          metricsService.incRateLimitHits();
          await proxySlotService.setCooldown(slotId);
          return {
            ok: false,
            status: 'RATE_LIMITED',
            error: `Rate limited: ${errorText}`,
          };
        }

        // Session invalid (401/403) - only mark for SYSTEM scope
        if (response.status === 401 || response.status === 403) {
          if (this.config.scope === 'SYSTEM') {
            await markSessionInvalid(session.sessionId, errorText);
          }
          return {
            ok: false,
            status: 'AUTH_REQUIRED',
            error: `Session invalid: ${errorText}`,
          };
        }

        return {
          ok: false,
          status: 'ERROR',
          error: `Parser error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();

      if (!data.ok) {
        metricsService.incRuntimeErrors();
        
        // Check if error indicates session problem
        const errorMsg = data.error || '';
        if (this.config.scope === 'SYSTEM' && (errorMsg.includes('blocked') || errorMsg.includes('login') || errorMsg.includes('suspended'))) {
          await markSessionInvalid(session.sessionId, errorMsg);
        }
        
        return {
          ok: false,
          status: 'ERROR',
          error: data.error || 'Unknown parser error',
        };
      }

      // Mark session as OK (only for SYSTEM scope)
      if (this.config.scope === 'SYSTEM') {
        await markSessionOk(session.sessionId);
      }

      // 7. Transform tweets to standard format
      // Handle various response formats
      let rawTweets: any[] = [];
      if (data.data?.tweets?.tweets && Array.isArray(data.data.tweets.tweets)) {
        rawTweets = data.data.tweets.tweets;
      } else if (Array.isArray(data.data?.tweets)) {
        rawTweets = data.data.tweets;
      } else if (Array.isArray(data.tweets)) {
        rawTweets = data.tweets;
      } else if (Array.isArray(data.data)) {
        rawTweets = data.data;
      }

      const tweets: TwitterTweet[] = rawTweets.map((t: any) => ({
        id: t.id,
        text: t.text,
        createdAt: new Date(t.createdAt).getTime(),
        likes: t.likes || 0,
        reposts: t.reposts || 0,
        replies: t.replies || 0,
        views: t.views || 0,
        author: {
          username: t.author?.username || '',
          displayName: t.author?.name || '',
          verified: t.author?.verified || false,
        },
      }));

      console.log(`[LocalParserRuntime] Success: ${tweets.length} tweets in ${duration}ms (scope=${this.config.scope})`);

      return {
        ok: true,
        status: 'OK',
        data: tweets,
        meta: {
          source: 'LOCAL_PARSER' as any,
          slotId,
          accountId: session.sessionId,
          duration,
        },
      };
    } catch (error: any) {
      metricsService.incRuntimeErrors();

      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return {
          ok: false,
          status: 'ERROR',
          error: 'Request timeout',
        };
      }

      return {
        ok: false,
        status: 'ERROR',
        error: `Connection failed: ${error.message}`,
      };
    }
  }

  async fetchAccountSummary(
    username: string
  ): Promise<RuntimeResponse<TwitterAccount>> {
    try {
      const sessionResult = await this.getSession();
      if (!sessionResult || !sessionResult.cookies) {
        return { ok: false, status: 'ERROR', error: `No active sessions (scope=${this.config.scope})` };
      }

      const { session, cookies } = sessionResult;

      const slot = await proxySlotService.selectBestSlot();
      if (!slot) {
        return { ok: false, status: 'RATE_LIMITED', error: 'No slots available' };
      }

      const proxyUrl = proxySlotService.getProxyUrl(slot);

      const requestBody: any = {
        cookies,
        userAgent: session.userAgent,
      };
      if (proxyUrl) {
        requestBody.proxyUrl = proxyUrl;
      }

      const response = await fetch(`${this.config.parserUrl}/profile/${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout!),
      });

      const slotId = (slot as any)._id?.toString() || slot.name;
      await proxySlotService.incrementUsage(slotId);

      if (!response.ok) {
        return { ok: false, status: 'ERROR', error: `Error: ${response.status}` };
      }

      const data = await response.json();
      if (!data.ok || !data.data) {
        return { ok: false, status: 'ERROR', error: data.error || 'User not found' };
      }

      return {
        ok: true,
        status: 'OK',
        data: {
          username: data.data.username,
          displayName: data.data.name,
          bio: data.data.description,
          followers: data.data.followers,
          following: data.data.following,
          verified: data.data.verified,
          avatarUrl: data.data.avatar,
        },
      };
    } catch (error: any) {
      return { ok: false, status: 'ERROR', error: error.message };
    }
  }

  async fetchAccountTweets(
    username: string,
    limit: number = 20
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    try {
      const sessionResult = await this.getSession();
      if (!sessionResult || !sessionResult.cookies) {
        return { ok: false, status: 'ERROR', error: `No active sessions (scope=${this.config.scope})` };
      }

      const { session, cookies } = sessionResult;

      const slot = await proxySlotService.selectBestSlot();
      if (!slot) {
        return { ok: false, status: 'RATE_LIMITED', error: 'No slots available' };
      }

      const proxyUrl = proxySlotService.getProxyUrl(slot);

      console.log(`[LocalParserRuntime] Fetching tweets: @${username}, scope=${this.config.scope}, cookies=${cookies?.length || 0}, proxy=${proxyUrl || 'DIRECT'}`);

      const requestBody: any = {
        limit,
        cookies,
        userAgent: session.userAgent,
      };
      if (proxyUrl) {
        requestBody.proxyUrl = proxyUrl;
      }

      const response = await fetch(`${this.config.parserUrl}/tweets/${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout!),
      });

      const slotId = (slot as any)._id?.toString() || slot.name;
      await proxySlotService.incrementUsage(slotId);

      if (!response.ok) {
        return { ok: false, status: 'ERROR', error: `Error: ${response.status}` };
      }

      const data = await response.json();
      if (!data.ok) {
        return { ok: false, status: 'ERROR', error: data.error || 'Failed to get tweets' };
      }

      // Handle various response formats
      let rawTweets: any[] = [];
      if (data.data?.tweets?.tweets && Array.isArray(data.data.tweets.tweets)) {
        // Nested format: { data: { tweets: { tweets: [...] } } }
        rawTweets = data.data.tweets.tweets;
      } else if (Array.isArray(data.data?.tweets)) {
        // Standard format: { data: { tweets: [...] } }
        rawTweets = data.data.tweets;
      } else if (Array.isArray(data.tweets)) {
        // Direct format: { tweets: [...] }
        rawTweets = data.tweets;
      } else if (Array.isArray(data.data)) {
        // Array format: { data: [...] }
        rawTweets = data.data;
      }

      if (rawTweets.length === 0 && data.ok) {
        // Valid empty result
        return { ok: true, status: 'OK', data: [] };
      }

      const tweets: TwitterTweet[] = rawTweets.map((t: any) => ({
        id: t.id,
        text: t.text,
        createdAt: new Date(t.createdAt).getTime(),
        likes: t.likes || 0,
        reposts: t.reposts || 0,
        replies: t.replies || 0,
        views: t.views || 0,
        author: {
          username: t.author?.username || '',
          displayName: t.author?.name || '',
          verified: t.author?.verified || false,
        },
      }));

      return {
        ok: true,
        status: 'OK',
        data: tweets,
      };
    } catch (error: any) {
      return { ok: false, status: 'ERROR', error: error.message };
    }
  }
}

// Factory function
export function createLocalParserRuntime(
  parserUrl: string = 'http://localhost:5001',
  scope: 'USER' | 'SYSTEM' = 'USER'
): LocalParserRuntime {
  return new LocalParserRuntime({ parserUrl, scope });
}
