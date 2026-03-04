// P2 - Tweet Query Builder
// Builds MongoDB queries for filtered tweet retrieval

import { Filter } from 'mongodb';
import { ParsedTweetDoc } from './parsed_tweet.model.js';

export interface TweetQueryFilters {
  // Engagement filters
  minLikes?: number;
  minReposts?: number;
  minReplies?: number;
  minViews?: number;
  
  // Time range
  timeRange?: {
    from?: number;  // unix ms
    to?: number;    // unix ms
  };
  
  // Content filters
  keyword?: string;
  author?: string;
  hashtags?: string[];
  
  // Source filters
  source?: 'SEARCH' | 'ACCOUNT_TWEETS';
  query?: string;
  username?: string;
  
  // Pagination
  limit?: number;
  offset?: number;
}

/**
 * Build MongoDB query from filters
 */
export function buildTweetQuery(
  filters: TweetQueryFilters
): Filter<ParsedTweetDoc> {
  const query: Filter<ParsedTweetDoc> = {};

  // Engagement filters
  if (filters.minLikes !== undefined && filters.minLikes > 0) {
    query['tweet.engagement.likes'] = { $gte: filters.minLikes };
  }

  if (filters.minReposts !== undefined && filters.minReposts > 0) {
    query['tweet.engagement.reposts'] = { $gte: filters.minReposts };
  }

  if (filters.minReplies !== undefined && filters.minReplies > 0) {
    query['tweet.engagement.replies'] = { $gte: filters.minReplies };
  }

  if (filters.minViews !== undefined && filters.minViews > 0) {
    query['tweet.engagement.views'] = { $gte: filters.minViews };
  }

  // Time range
  if (filters.timeRange?.from || filters.timeRange?.to) {
    query['tweet.timestamp'] = {};

    if (filters.timeRange.from) {
      (query['tweet.timestamp'] as any).$gte = filters.timeRange.from;
    }

    if (filters.timeRange.to) {
      (query['tweet.timestamp'] as any).$lte = filters.timeRange.to;
    }
  }

  // Author filter
  if (filters.author) {
    query['tweet.author.username'] = filters.author.replace('@', '').toLowerCase();
  }

  // Hashtags filter
  if (filters.hashtags && filters.hashtags.length > 0) {
    query['tweet.hashtags'] = { $in: filters.hashtags };
  }

  // Source filter
  if (filters.source) {
    query.source = filters.source;
  }

  // Query filter (for SEARCH source)
  if (filters.query) {
    query.query = filters.query;
  }

  // Username filter (for ACCOUNT_TWEETS source)
  if (filters.username) {
    query.username = filters.username.replace('@', '');
  }

  // Text search (keyword in tweet text)
  if (filters.keyword) {
    query['tweet.text'] = { 
      $regex: filters.keyword, 
      $options: 'i' 
    };
  }

  return query;
}

/**
 * Helper to create time range from preset
 */
export function createTimeRange(preset: '1h' | '24h' | '7d' | '30d'): { from: number; to: number } {
  const now = Date.now();
  const to = now;
  
  let from: number;
  switch (preset) {
    case '1h':
      from = now - 60 * 60 * 1000;
      break;
    case '24h':
      from = now - 24 * 60 * 60 * 1000;
      break;
    case '7d':
      from = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      from = now - 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      from = 0;
  }

  return { from, to };
}

/**
 * Normalize filters with defaults
 */
export function normalizeFilters(input: Partial<TweetQueryFilters>): TweetQueryFilters {
  return {
    minLikes: input.minLikes,
    minReposts: input.minReposts,
    minReplies: input.minReplies,
    minViews: input.minViews,
    timeRange: input.timeRange,
    keyword: input.keyword?.trim(),
    author: input.author?.trim(),
    hashtags: input.hashtags?.filter(h => h.trim()),
    source: input.source,
    query: input.query?.trim(),
    username: input.username?.trim(),
    limit: Math.min(input.limit || 50, 200),
    offset: input.offset || 0,
  };
}
