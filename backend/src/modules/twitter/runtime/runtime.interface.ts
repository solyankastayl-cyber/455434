// B3.1 - Twitter Runtime Interface
// THE MOST IMPORTANT FILE IN v4.0
// Execution Core works ONLY with this interface

import { RuntimeResponse, RuntimeStatus } from './runtime.types.js';

/**
 * Minimal Tweet model for runtime responses
 * Real Twitter may return more - we normalize to this
 */
export interface TwitterTweet {
  id: string;
  text: string;
  createdAt: number;
  likes: number;
  reposts: number;
  replies?: number;
  views?: number;
  author?: {
    username: string;
    displayName?: string;
    verified?: boolean;
  };
}

/**
 * Minimal Account model for runtime responses
 */
export interface TwitterAccount {
  username: string;
  displayName?: string;
  bio?: string;
  followers: number;
  following?: number;
  verified: boolean;
  avatarUrl?: string;
}

/**
 * Search parameters
 */
export interface SearchParams {
  keyword: string;
  limit?: number;
  mode?: 'TOP' | 'LATEST';
}

/**
 * Twitter Runtime Interface
 * 
 * ALL implementations (Mock, Remote, Proxy, API) MUST implement this.
 * Execution Core is decoupled from actual data source.
 */
export interface TwitterRuntime {
  /** Get runtime source type */
  readonly sourceType: string;

  /** Check if runtime is healthy and available */
  getHealth(): Promise<RuntimeStatus>;

  /** Search tweets by keyword */
  fetchTweetsByKeyword(
    params: SearchParams
  ): Promise<RuntimeResponse<TwitterTweet[]>>;

  /** Get account summary/profile */
  fetchAccountSummary(
    username: string
  ): Promise<RuntimeResponse<TwitterAccount>>;

  /** Get tweets from specific account */
  fetchAccountTweets(
    username: string,
    limit?: number
  ): Promise<RuntimeResponse<TwitterTweet[]>>;
}
