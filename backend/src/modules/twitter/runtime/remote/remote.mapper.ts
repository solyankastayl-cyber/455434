// B3.3 - Remote Response Mapper
// Normalizes various parser response formats to our standard DTOs

import {
  RemoteTweet,
  RemoteSearchResponse,
  RemoteAccountResponse,
} from './remote.types.js';
import { TwitterTweet, TwitterAccount } from '../runtime.interface.js';

export class RemoteMapper {
  /**
   * Map remote tweet to standard format
   */
  static mapTweet(raw: RemoteTweet): TwitterTweet {
    // Handle various field name aliases
    const author = raw.author || raw.user;
    const stats = raw.stats || raw.metrics || {};
    
    // Parse timestamp from various formats
    let createdAt = raw.createdAt || raw.timestamp;
    if (raw.created_at) {
      createdAt = typeof raw.created_at === 'string' 
        ? new Date(raw.created_at).getTime()
        : raw.created_at;
    }

    return {
      id: raw.id,
      text: raw.text || raw.full_text || raw.content || '',
      createdAt: createdAt || Date.now(),
      likes: stats.likes || 0,
      reposts: stats.reposts || stats.retweets || 0,
      replies: stats.replies || 0,
      views: stats.views || stats.impressions,
      author: author ? {
        username: author.username,
        displayName: author.displayName || author.name,
        verified: author.verified,
      } : undefined,
    };
  }

  /**
   * Map remote search response to tweets array
   */
  static mapSearchResponse(raw: RemoteSearchResponse): TwitterTweet[] {
    // Handle various response formats
    const tweets = raw.tweets || raw.items || raw.data || [];
    
    if (!Array.isArray(tweets)) {
      return [];
    }

    return tweets.map(RemoteMapper.mapTweet);
  }

  /**
   * Map remote account to standard format
   */
  static mapAccount(raw: RemoteAccountResponse): TwitterAccount {
    // Handle various response formats
    const account = raw.account || raw.user || raw.data;
    
    if (!account) {
      throw new Error('Invalid account response');
    }

    return {
      username: account.username,
      displayName: account.displayName || account.name,
      bio: account.bio || account.description,
      followers: account.followers || account.followers_count || 0,
      following: account.following || account.following_count,
      verified: account.verified || false,
      avatarUrl: account.avatar || account.profile_image_url,
    };
  }
}
