/**
 * Parser Client Service - Phase 1.4 + 2.5 (Engine Adapter)
 * 
 * HTTP client для вызова twitter-parser-v2
 * Backend → Parser (5001)
 * 
 * ВАЖНО: Используем EngineResultAdapter для маппинга engine → product
 */

import axios, { AxiosError } from 'axios';
import type { ParserRuntimeConfig } from './session-selector.service.js';
import { EngineResultAdapter } from '../../twitter/engine/engine-result.adapter.js';

// Parser host (same pod or kubernetes service)
const PARSER_URL = process.env.TWITTER_PARSER_URL || 'http://localhost:5001';

export interface ParsedTweet {
  id: string;
  text: string;
  createdAt: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  author: {
    id: string;
    username: string;
    name: string;
    avatar: string;
    verified: boolean;
    followers: number;
  };
  media?: string[];
}

// Re-export types from adapter
export type { ParserEngineSummary } from '../../twitter/engine/engine-result.adapter.js';

export interface ParserSearchResult {
  tweets: ParsedTweet[];
  engineSummary: {
    durationMs: number;
    riskMax: number;
    aborted: boolean;
    abortReason?: string;
  };
}

export interface ParserClientOptions {
  timeoutMs?: number;
}

export class ParserClientService {
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;

  constructor(options: ParserClientOptions = {}) {
    this.baseUrl = PARSER_URL;
    this.defaultTimeout = options.timeoutMs || 10 * 60 * 1000; // 10 min default
  }

  /**
   * Search tweets by keyword
   * POST /search/:keyword
   */
  async parseSearch(payload: {
    query: string;
    limit: number;
    filters?: any;
    runtime: ParserRuntimeConfig;
  }): Promise<ParserSearchResult> {
    const startTime = Date.now();
    const keyword = encodeURIComponent(payload.query);

    console.log(`[ParserClient] Search "${payload.query}" | limit: ${payload.limit} | profile: ${payload.runtime.scrollProfileHint}`);

    try {
      const response = await axios.post(
        `${this.baseUrl}/search/${keyword}`,
        {
          limit: payload.limit,
          cookies: payload.runtime.cookies,
          userAgent: payload.runtime.userAgent,
          proxyUrl: payload.runtime.proxy 
            ? `${payload.runtime.proxy.protocol || 'http'}://${payload.runtime.proxy.username}:${payload.runtime.proxy.password}@${payload.runtime.proxy.host}:${payload.runtime.proxy.port}`
            : undefined,
          // ScrollEngine profile hint
          profile: payload.runtime.scrollProfileHint,
        },
        {
          timeout: this.defaultTimeout,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const durationMs = Date.now() - startTime;

      if (!response.data?.ok) {
        throw new Error(response.data?.error || 'Parser returned error');
      }

      const data = response.data.data;
      
      // DEBUG: Log raw parser response
      console.log(`[ParserClient] Raw data keys: ${JSON.stringify(Object.keys(data || {}))}`);
      console.log(`[ParserClient] data.tweets type: ${typeof data?.tweets}, length: ${data?.tweets?.length}`);
      
      // Use EngineResultAdapter to map engine → product terms
      const adapted = EngineResultAdapter.toEngineSummary({
        tweets: data.tweets,
        engineSummary: data.engineSummary,
      });
      
      // Override durationMs if not set
      if (!adapted.durationMs) {
        adapted.durationMs = durationMs;
      }

      console.log(`[ParserClient] Search complete | fetched: ${data.tweets?.length || 0} | duration: ${durationMs}ms | aborted: ${adapted.aborted}`);

      return {
        tweets: data.tweets || [],
        engineSummary: adapted,
      };

    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ ok: boolean; error: string }>;
        
        // Map HTTP status to abort reasons
        const status = axiosError.response?.status;
        const errorMsg = axiosError.response?.data?.error || axiosError.message;
        
        let abortReason: ParserEngineSummary['abortReason'] = undefined;
        let isSessionExpired = false;
        let isParserDown = false;
        
        // Check for connection errors first (parser infrastructure issue)
        if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('ETIMEDOUT')) {
          abortReason = 'PARSER_DOWN';
          isParserDown = true;
        } else if (status === 429) {
          abortReason = 'RATE_LIMIT';
        } else if (status === 403) {
          abortReason = 'SESSION_EXPIRED';
          isSessionExpired = true;
        } else if (errorMsg.includes('captcha')) {
          abortReason = 'CAPTCHA';
        } else if (errorMsg.includes('redirected to login') || errorMsg.includes('Session expired')) {
          // Twitter detected expired cookies
          abortReason = 'SESSION_EXPIRED';
          isSessionExpired = true;
        }

        console.error(`[ParserClient] Search error | status: ${status} | error: ${errorMsg} | sessionExpired: ${isSessionExpired} | parserDown: ${isParserDown}`);

        // Return partial result on error with flags
        return {
          tweets: [],
          engineSummary: {
            fetched: 0,
            planned: payload.limit,
            durationMs,
            riskMax: isParserDown ? 0 : 100, // Don't increase risk if parser is down
            aborted: true,
            abortReason,
            isSessionExpired,
            isParserDown, // NEW: Flag for infrastructure error
            profile: payload.runtime.scrollProfileHint || 'NORMAL',
            profileChanges: 0,
            scrollCount: 0,
          },
        };
      }

      throw error;
    }
  }

  /**
   * Get user tweets
   * POST /tweets/:username
   */
  async parseAccount(payload: {
    username: string;
    limit: number;
    runtime: ParserRuntimeConfig;
  }): Promise<ParserSearchResult> {
    const startTime = Date.now();

    console.log(`[ParserClient] Account @${payload.username} | limit: ${payload.limit}`);

    try {
      const response = await axios.post(
        `${this.baseUrl}/tweets/${payload.username}`,
        {
          limit: payload.limit,
          cookies: payload.runtime.cookies,
          userAgent: payload.runtime.userAgent,
          proxyUrl: payload.runtime.proxy
            ? `${payload.runtime.proxy.protocol || 'http'}://${payload.runtime.proxy.username}:${payload.runtime.proxy.password}@${payload.runtime.proxy.host}:${payload.runtime.proxy.port}`
            : undefined,
          profile: payload.runtime.scrollProfileHint,
        },
        {
          timeout: this.defaultTimeout,
        }
      );

      const durationMs = Date.now() - startTime;

      if (!response.data?.ok) {
        throw new Error(response.data?.error || 'Parser returned error');
      }

      const data = response.data.data;
      
      // Parser returns nested structure: data.tweets.tweets[]
      // Handle both formats for backwards compatibility
      const rawTweets = data.tweets;
      const tweets = Array.isArray(rawTweets) ? rawTweets : (rawTweets?.tweets || []);

      const engineSummary: ParserEngineSummary = data.engineSummary || rawTweets?.engineSummary || {
        fetched: tweets.length || 0,
        planned: payload.limit,
        durationMs,
        riskMax: rawTweets?.finalRisk || 0,
        aborted: rawTweets?.aborted || false,
        profile: payload.runtime.scrollProfileHint || 'NORMAL',
        profileChanges: rawTweets?.profileChanges || 0,
        scrollCount: rawTweets?.scrolls || 0,
      };

      if (!engineSummary.durationMs) {
        engineSummary.durationMs = durationMs;
      }

      console.log(`[ParserClient] Account @${payload.username} complete | tweets: ${tweets.length} | aborted: ${engineSummary.aborted}`);

      return {
        tweets,
        engineSummary,
      };

    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;

        let abortReason: ParserEngineSummary['abortReason'] = undefined;
        if (status === 429) abortReason = 'RATE_LIMIT';
        if (status === 403) abortReason = 'SESSION_EXPIRED';

        return {
          tweets: [],
          engineSummary: {
            fetched: 0,
            planned: payload.limit,
            durationMs,
            riskMax: 100,
            aborted: true,
            abortReason,
            profile: payload.runtime.scrollProfileHint || 'NORMAL',
            profileChanges: 0,
            scrollCount: 0,
          },
        };
      }

      throw error;
    }
  }

  /**
   * Ping session health
   * POST /warmth/ping
   */
  async pingSession(runtime: ParserRuntimeConfig): Promise<{
    success: boolean;
    httpStatus: number;
    latencyMs: number;
    userId?: string;
  }> {
    const startTime = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/warmth/ping`,
        {
          cookies: runtime.cookies,
          userAgent: runtime.userAgent,
          proxyUrl: runtime.proxy
            ? `${runtime.proxy.protocol || 'http'}://${runtime.proxy.username}:${runtime.proxy.password}@${runtime.proxy.host}:${runtime.proxy.port}`
            : undefined,
        },
        { timeout: 30000 }
      );

      return {
        success: response.data?.success || false,
        httpStatus: response.data?.httpStatus || 200,
        latencyMs: Date.now() - startTime,
        userId: response.data?.userId,
      };

    } catch (error) {
      return {
        success: false,
        httpStatus: 500,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
      return response.data?.ok === true;
    } catch {
      return false;
    }
  }
}
