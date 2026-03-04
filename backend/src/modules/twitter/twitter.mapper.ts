// Mapper: Parser Response -> Backend DTO

import type { TwitterTweetDTO, TwitterAccountDTO } from './twitter.dto.js';

export function mapParserTweet(raw: any): TwitterTweetDTO {
  return {
    id: raw.id || raw.tweetId || String(Math.random()),
    text: raw.text || '',
    author: raw.author ? {
      username: raw.author.username || raw.username,
      displayName: raw.author.displayName || raw.author.name,
      verified: raw.author.verified || false,
    } : undefined,
    engagement: {
      likes: raw.likes || raw.favoriteCount || 0,
      reposts: raw.retweets || raw.retweetCount || 0,
      replies: raw.replies || raw.replyCount || 0,
      views: raw.views || raw.viewCount || 0,
    },
    timestamp: raw.createdAt ? new Date(raw.createdAt).getTime() : Date.now(),
    source: 'twitter',
    url: raw.url,
  };
}

export function mapParserAccount(raw: any): TwitterAccountDTO {
  return {
    username: raw.username || raw.screen_name || '',
    displayName: raw.displayName || raw.name || '',
    bio: raw.bio || raw.description,
    followers: raw.followers || raw.followersCount || raw.followers_count || 0,
    following: raw.following || raw.followingCount || raw.friends_count || 0,
    tweets: raw.tweets || raw.tweetsCount || raw.statuses_count || 0,
    verified: raw.verified || raw.isVerified || false,
    avatar: raw.avatar || raw.profile_image_url,
    banner: raw.banner || raw.profile_banner_url,
    createdAt: raw.createdAt || raw.created_at,
  };
}

export function mapParserFollower(raw: any): TwitterAccountDTO {
  return {
    username: raw.username || '',
    displayName: raw.name || '',
    bio: raw.description,
    followers: raw.followersCount || 0,
    following: raw.followingCount || 0,
    tweets: raw.tweetsCount || 0,
    verified: raw.isVerified || false,
    avatar: raw.avatar,
    banner: raw.banner,
    createdAt: raw.createdAt,
  };
}
