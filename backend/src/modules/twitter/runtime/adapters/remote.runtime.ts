// B3.2 - Remote Twitter Runtime
// Connects to Twitter Parser V2 service (Playwright + Cookie Sessions)

import {
  TwitterRuntime,
  TwitterTweet,
  TwitterAccount,
  SearchParams,
} from '../runtime.interface.js';
import { RuntimeResponse, RuntimeStatus } from '../runtime.types.js';

export interface RemoteRuntimeConfig {
  baseUrl: string;  // e.g., http://localhost:5001 or Railway URL
  timeout?: number;
  sessionId?: string;  // Optional: force specific session
}

export class RemoteTwitterRuntime implements TwitterRuntime {
  readonly sourceType = 'REMOTE';
  private baseUrl: string;
  private timeout: number;
  private slotId: string;
  private accountId: string;
  private sessionId?: string;

  constructor(
    config: RemoteRuntimeConfig,
    slotId: string = 'unknown',
    accountId: string = 'unknown'
  ) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 60000;
    this.slotId = slotId;
    this.accountId = accountId;
    this.sessionId = config.sessionId;
  }

  async getHealth(): Promise<RuntimeStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        return 'ERROR';
      }

      const data = await response.json();
      
      if (data.ok && data.sessions?.available > 0) {
        return 'OK';
      }
      
      if (data.ok && data.sessions?.active > 0) {
        return 'DEGRADED';
      }

      return 'ERROR';
    } catch (error) {
      console.error('[RemoteRuntime] Health check failed:', error);
      return 'ERROR';
    }
  }

  async fetchTweetsByKeyword(
    params: SearchParams
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const { keyword, limit = 20 } = params;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const startTime = Date.now();
      
      const response = await fetch(`${this.baseUrl}/search/${encodeURIComponent(keyword)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        
        // Check for rate limit
        if (response.status === 429) {
          return {
            ok: false,
            status: 'RATE_LIMITED',
            error: `Rate limited: ${error}`,
          };
        }

        return {
          ok: false,
          status: 'ERROR',
          error: `Remote error: ${response.status} - ${error}`,
        };
      }

      const data = await response.json();

      if (!data.ok) {
        // Check for session errors
        if (data.error?.includes('No available sessions')) {
          return {
            ok: false,
            status: 'RATE_LIMITED',
            error: 'No available sessions',
          };
        }

        if (data.error?.includes('blocked') || data.error?.includes('banned')) {
          return {
            ok: false,
            status: 'ERROR',
            error: `Account blocked: ${data.error}`,
          };
        }

        return {
          ok: false,
          status: 'ERROR',
          error: data.error || 'Unknown remote error',
        };
      }

      // Transform tweets to our format
      const tweets: TwitterTweet[] = (data.data?.tweets || []).map((t: any) => ({
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
        meta: {
          source: 'REMOTE',
          slotId: this.slotId,
          accountId: this.accountId,
          duration,
        },
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const startTime = Date.now();

      const response = await fetch(`${this.baseUrl}/profile/${encodeURIComponent(username)}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        return {
          ok: false,
          status: 'ERROR',
          error: `Remote error: ${response.status}`,
        };
      }

      const data = await response.json();

      if (!data.ok || !data.data) {
        return {
          ok: false,
          status: 'ERROR',
          error: data.error || 'User not found',
        };
      }

      const profile = data.data;

      return {
        ok: true,
        status: 'OK',
        data: {
          username: profile.username,
          displayName: profile.name,
          bio: profile.description,
          followers: profile.followers,
          following: profile.following,
          verified: profile.verified,
          avatarUrl: profile.avatar,
        },
        meta: {
          source: 'REMOTE',
          slotId: this.slotId,
          accountId: this.accountId,
          duration,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        status: 'ERROR',
        error: `Connection failed: ${error.message}`,
      };
    }
  }

  async fetchAccountTweets(
    username: string,
    limit: number = 20
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const startTime = Date.now();

      const response = await fetch(`${this.baseUrl}/tweets/${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        return {
          ok: false,
          status: 'ERROR',
          error: `Remote error: ${response.status}`,
        };
      }

      const data = await response.json();

      if (!data.ok) {
        return {
          ok: false,
          status: 'ERROR',
          error: data.error || 'Unknown error',
        };
      }

      const tweets: TwitterTweet[] = (data.data?.tweets || []).map((t: any) => ({
        id: t.id,
        text: t.text,
        createdAt: new Date(t.createdAt).getTime(),
        likes: t.likes || 0,
        reposts: t.reposts || 0,
        replies: t.replies || 0,
        views: t.views || 0,
        author: {
          username: t.author?.username || username,
          displayName: t.author?.name || '',
          verified: t.author?.verified || false,
        },
      }));

      return {
        ok: true,
        status: 'OK',
        data: tweets,
        meta: {
          source: 'REMOTE',
          slotId: this.slotId,
          accountId: this.accountId,
          duration,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        status: 'ERROR',
        error: `Connection failed: ${error.message}`,
      };
    }
  }
}
