// B3.3 - Proxy Twitter Runtime (Real Implementation)
// Calls Twitter Parser V2 service with user cookies

import {
  TwitterRuntime,
  TwitterTweet,
  TwitterAccount,
  SearchParams,
} from '../runtime.interface.js';
import { RuntimeResponse, RuntimeStatus } from '../runtime.types.js';
import { SessionService } from '../../../twitter-user/services/session.service.js';
import { CryptoService } from '../../../twitter-user/crypto/crypto.service.js';

export interface ProxyConfig {
  url?: string;
  region?: string;
  provider?: string;
  parserUrl?: string;
}

// Singleton session service
let sessionService: SessionService | null = null;

function getSessionService(): SessionService {
  if (!sessionService) {
    const crypto = new CryptoService();
    sessionService = new SessionService(crypto);
  }
  return sessionService;
}

// Get decrypted cookies from user session
async function getUserCookies(accountId: string): Promise<any[]> {
  try {
    // First get the session to find ownerUserId
    const { UserTwitterSessionModel } = await import('../../../twitter-user/models/twitter-session.model.js');
    
    const session = await UserTwitterSessionModel.findOne({
      accountId: accountId,
      isActive: true,
      status: { $in: ['OK', 'STALE'] }
    }).lean();
    
    if (!session) {
      console.log(`[ProxyRuntime] No active session for account ${accountId}`);
      return [];
    }
    
    if (!session.cookiesEnc || !session.cookiesIv || !session.cookiesTag) {
      console.log(`[ProxyRuntime] Session has no encrypted cookies`);
      return [];
    }
    
    // Decrypt cookies
    try {
      const svc = getSessionService();
      const cookies = await svc.getDecryptedCookiesForRuntime(
        session.ownerUserId,
        accountId
      );
      console.log(`[ProxyRuntime] Decrypted ${cookies.length} cookies for account ${accountId}`);
      return cookies;
    } catch (decryptErr: any) {
      console.error(`[ProxyRuntime] Decryption error:`, decryptErr.message);
      return [];
    }
  } catch (e: any) {
    console.error(`[ProxyRuntime] Error getting cookies:`, e.message);
    return [];
  }
}

export class ProxyTwitterRuntime implements TwitterRuntime {
  readonly sourceType = 'PROXY';
  private parserUrl: string;
  private slotId: string;
  private accountId: string;

  constructor(
    config: ProxyConfig,
    slotId: string = 'unknown',
    accountId: string = 'unknown'
  ) {
    this.parserUrl = config.parserUrl || process.env.TWITTER_PARSER_V2_URL || 'http://localhost:5001';
    this.slotId = slotId;
    this.accountId = accountId;
    console.log(`[ProxyRuntime] Initialized with parser: ${this.parserUrl}, account: ${accountId}`);
  }

  async getHealth(): Promise<RuntimeStatus> {
    try {
      const res = await fetch(`${this.parserUrl}/health`);
      const data = await res.json();
      return {
        ok: data.ok,
        source: 'PROXY',
        latencyMs: 0,
        error: data.ok ? undefined : 'Parser unhealthy'
      };
    } catch (e: any) {
      return {
        ok: false,
        source: 'PROXY',
        latencyMs: 0,
        error: e.message
      };
    }
  }

  async fetchTweetsByKeyword(
    params: SearchParams
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const startTime = Date.now();
    
    try {
      // Get user cookies
      const cookies = await getUserCookies(this.accountId);
      
      if (cookies.length === 0) {
        return {
          ok: false,
          data: [],
          error: 'No valid session cookies available. Please sync cookies from Chrome Extension.',
          meta: {
            source: 'PROXY',
            slotId: this.slotId,
            accountId: this.accountId,
            latencyMs: Date.now() - startTime
          }
        };
      }

      console.log(`[ProxyRuntime] Searching "${params.keyword}" with ${cookies.length} cookies`);
      
      const res = await fetch(`${this.parserUrl}/search/${encodeURIComponent(params.keyword)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: params.limit || 20,
          cookies,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
      });

      const data = await res.json();
      
      return {
        ok: data.ok,
        data: data.data || [],
        error: data.error,
        meta: {
          source: 'PROXY',
          slotId: this.slotId,
          accountId: this.accountId,
          latencyMs: Date.now() - startTime,
          resultCount: (data.data || []).length
        }
      };
    } catch (e: any) {
      console.error(`[ProxyRuntime] Search error:`, e.message);
      return {
        ok: false,
        data: [],
        error: e.message,
        meta: {
          source: 'PROXY',
          slotId: this.slotId,
          accountId: this.accountId,
          latencyMs: Date.now() - startTime
        }
      };
    }
  }

  async fetchAccountSummary(
    username: string
  ): Promise<RuntimeResponse<TwitterAccount>> {
    const startTime = Date.now();
    
    try {
      const cookies = await getUserCookies(this.accountId);
      
      if (cookies.length === 0) {
        return {
          ok: false,
          data: null as any,
          error: 'No valid session cookies available',
          meta: {
            source: 'PROXY',
            slotId: this.slotId,
            accountId: this.accountId,
            latencyMs: Date.now() - startTime
          }
        };
      }

      const res = await fetch(`${this.parserUrl}/profile/${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
      });

      const data = await res.json();
      
      return {
        ok: data.ok,
        data: data.data,
        error: data.error,
        meta: {
          source: 'PROXY',
          slotId: this.slotId,
          accountId: this.accountId,
          latencyMs: Date.now() - startTime
        }
      };
    } catch (e: any) {
      return {
        ok: false,
        data: null as any,
        error: e.message,
        meta: {
          source: 'PROXY',
          slotId: this.slotId,
          accountId: this.accountId,
          latencyMs: Date.now() - startTime
        }
      };
    }
  }

  async fetchAccountTweets(
    username: string,
    limit?: number
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const startTime = Date.now();
    
    try {
      const cookies = await getUserCookies(this.accountId);
      
      if (cookies.length === 0) {
        return {
          ok: false,
          data: [],
          error: 'No valid session cookies available. Please sync cookies from Chrome Extension.',
          meta: {
            source: 'PROXY',
            slotId: this.slotId,
            accountId: this.accountId,
            latencyMs: Date.now() - startTime
          }
        };
      }

      console.log(`[ProxyRuntime] Fetching tweets for @${username} with ${cookies.length} cookies`);
      
      const res = await fetch(`${this.parserUrl}/tweets/${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: limit || 20,
          cookies,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
      });

      const data = await res.json();
      const tweets = data.data?.tweets || data.data || [];
      
      return {
        ok: data.ok,
        data: tweets,
        error: data.error,
        meta: {
          source: 'PROXY',
          slotId: this.slotId,
          accountId: this.accountId,
          latencyMs: Date.now() - startTime,
          resultCount: tweets.length
        }
      };
    } catch (e: any) {
      console.error(`[ProxyRuntime] Account tweets error:`, e.message);
      return {
        ok: false,
        data: [],
        error: e.message,
        meta: {
          source: 'PROXY',
          slotId: this.slotId,
          accountId: this.accountId,
          latencyMs: Date.now() - startTime
        }
      };
    }
  }
}
