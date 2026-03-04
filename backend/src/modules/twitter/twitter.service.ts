// Twitter Service - Business Logic
// Integrated with B2 Execution Core

import { TwitterParserClient } from './twitter.client.js';
import { TwitterCache } from './twitter.cache.js';
import { mapParserTweet, mapParserAccount, mapParserFollower } from './twitter.mapper.js';
import type { TwitterSearchResultDTO, TwitterAccountTweetsDTO, TwitterFollowersDTO } from './twitter.dto.js';
import type { ParserHealth } from './twitter.types.js';
import { twitterExecutionAdapter, TwitterExecutionAdapter } from './execution/execution.adapter.js';

const CACHE_TTL = {
  search: 60_000, // 1 min
  account: 5 * 60_000, // 5 min
  followers: 30 * 60_000, // 30 min
  health: 10_000, // 10 sec
};

export class TwitterService {
  private client: TwitterParserClient;
  private cache: TwitterCache;
  private executionAdapter: TwitterExecutionAdapter;
  private useExecutionCore: boolean;

  constructor(
    client: TwitterParserClient = new TwitterParserClient(),
    cache: TwitterCache = new TwitterCache(),
    executionAdapter: TwitterExecutionAdapter = twitterExecutionAdapter,
    useExecutionCore = false // Set to true to use B2 execution
  ) {
    this.client = client;
    this.cache = cache;
    this.executionAdapter = executionAdapter;
    this.useExecutionCore = useExecutionCore;
  }

  /**
   * Enable/disable B2 Execution Core
   */
  setExecutionMode(useExecutionCore: boolean): void {
    this.useExecutionCore = useExecutionCore;
  }

  /**
   * Get execution adapter (for controller access)
   */
  getExecutionAdapter(): TwitterExecutionAdapter {
    return this.executionAdapter;
  }

  async health(): Promise<ParserHealth> {
    const key = 'health';
    const cached = this.cache.get<ParserHealth>(key);
    if (cached) return cached;

    const health = await this.client.health();
    this.cache.set(key, health, CACHE_TTL.health);
    return health;
  }

  async search(query: string): Promise<TwitterSearchResultDTO> {
    if (!query || query.trim().length === 0) {
      throw new Error('Query is required');
    }

    const key = `search:${query}`;
    const cached = this.cache.get<TwitterSearchResultDTO>(key);
    if (cached) return cached;

    // Check parser health first
    const health = await this.health();
    if (health.state === 'PAUSED') {
      throw new Error('PARSER_PAUSED');
    }
    if (health.state === 'ERROR') {
      throw new Error('PARSER_ERROR');
    }

    // Use B2 Execution Core if enabled
    if (this.useExecutionCore) {
      const execResult = await this.executionAdapter.search(query);
      if (!execResult.ok) {
        throw new Error(execResult.error || 'Execution failed');
      }
      
      const result: TwitterSearchResultDTO = {
        query,
        mode: health.mode,
        count: execResult.data?.items?.length || 0,
        tweets: (execResult.data?.items || []).map(mapParserTweet),
        limits: execResult.data?.limits,
      };
      
      this.cache.set(key, result, CACHE_TTL.search);
      return result;
    }

    // Legacy direct client call
    const raw = await this.client.search(query);
    
    const result: TwitterSearchResultDTO = {
      query,
      mode: raw.mode,
      count: raw.items?.length || 0,
      tweets: (raw.items || []).map(mapParserTweet),
      limits: raw.limits,
    };

    this.cache.set(key, result, CACHE_TTL.search);
    return result;
  }

  async account(username: string): Promise<any> {
    if (!username) {
      throw new Error('Username is required');
    }

    const key = `account:${username}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const raw = await this.client.accountSummary(username);
    
    const result = {
      username: raw.username,
      user: raw.user ? mapParserAccount(raw.user) : null,
      tweetsCount: raw.tweetsCount || 0,
    };

    this.cache.set(key, result, CACHE_TTL.account);
    return result;
  }

  async tweets(username: string): Promise<TwitterAccountTweetsDTO> {
    if (!username) {
      throw new Error('Username is required');
    }

    const key = `tweets:${username}`;
    const cached = this.cache.get<TwitterAccountTweetsDTO>(key);
    if (cached) return cached;

    // Use B2 Execution Core if enabled
    if (this.useExecutionCore) {
      const execResult = await this.executionAdapter.getAccountTweets(username);
      if (!execResult.ok) {
        throw new Error(execResult.error || 'Execution failed');
      }
      
      const result: TwitterAccountTweetsDTO = {
        username,
        user: execResult.data?.user ? mapParserAccount(execResult.data.user) : ({} as any),
        tweets: (execResult.data?.tweets || []).map(mapParserTweet),
        count: execResult.data?.tweets?.length || 0,
      };
      
      this.cache.set(key, result, CACHE_TTL.account);
      return result;
    }

    // Legacy direct client call
    const raw = await this.client.accountTweets(username);
    
    const result: TwitterAccountTweetsDTO = {
      username: raw.username,
      user: raw.user ? mapParserAccount(raw.user) : ({} as any),
      tweets: (raw.tweets || []).map(mapParserTweet),
      count: raw.tweets?.length || 0,
    };

    this.cache.set(key, result, CACHE_TTL.account);
    return result;
  }

  async followers(username: string, mode?: string): Promise<TwitterFollowersDTO> {
    if (!username) {
      throw new Error('Username is required');
    }

    // Check mode restriction
    const health = await this.health();
    const currentMode = mode || health.mode;
    
    if (currentMode === 'LIMITED') {
      throw new Error('FOLLOWERS_NOT_AVAILABLE_IN_LIMITED_MODE');
    }

    const key = `followers:${username}`;
    const cached = this.cache.get<TwitterFollowersDTO>(key);
    if (cached) return cached;

    // Use B2 Execution Core if enabled
    if (this.useExecutionCore) {
      const execResult = await this.executionAdapter.getAccountFollowers(username);
      if (!execResult.ok) {
        throw new Error(execResult.error || 'Execution failed');
      }
      
      const result: TwitterFollowersDTO = {
        username,
        mode: health.mode,
        followers: (execResult.data?.items || []).map(mapParserFollower),
        count: execResult.data?.items?.length || 0,
        limits: execResult.data?.limits,
      };
      
      this.cache.set(key, result, CACHE_TTL.followers);
      return result;
    }

    // Legacy direct client call
    const raw = await this.client.accountFollowers(username);
    
    const result: TwitterFollowersDTO = {
      username: raw.username,
      mode: raw.mode,
      followers: (raw.items || []).map(mapParserFollower),
      count: raw.items?.length || 0,
      limits: raw.limits,
    };

    this.cache.set(key, result, CACHE_TTL.followers);
    return result;
  }

  // Admin methods
  async setMode(mode: string): Promise<any> {
    const result = await this.client.setMode(mode);
    this.cache.clear(); // Clear cache on mode change
    return result;
  }

  async pause(): Promise<any> {
    return await this.client.pause();
  }

  async resume(): Promise<any> {
    return await this.client.resume();
  }

  async boost(minutes: number): Promise<any> {
    return await this.client.boost(minutes);
  }

  async getState(): Promise<any> {
    return await this.client.getState();
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  // B2 Execution methods
  getExecutionStatus() {
    return this.executionAdapter.getStatus();
  }

  startExecutionWorker(): void {
    this.executionAdapter.startWorker();
  }

  stopExecutionWorker(): void {
    this.executionAdapter.stopWorker();
  }

  resetExecutionCounters(): void {
    this.executionAdapter.resetCounters();
  }
}
