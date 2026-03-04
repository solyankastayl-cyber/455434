// B3 - Parsed Tweet Model
// Storage for parsed tweets

export interface ParsedTweetAuthor {
  username: string;
  displayName?: string;
  verified?: boolean;
  avatarUrl?: string;
}

export interface ParsedTweetEngagement {
  likes: number;
  reposts: number;
  replies: number;
  views?: number;
  bookmarks?: number;
}

export interface ParsedTweet {
  _id?: string;
  network: 'twitter';
  source: 'SEARCH' | 'ACCOUNT_TWEETS';
  
  // Context
  query?: string;           // for SEARCH
  username?: string;        // for ACCOUNT_TWEETS
  
  // Tweet data
  tweet: {
    id: string;
    url?: string;
    text: string;
    timestamp: number;
    author: ParsedTweetAuthor;
    engagement: ParsedTweetEngagement;
    media?: Array<{
      type: 'image' | 'video' | 'gif';
      url: string;
    }>;
    hashtags?: string[];
    mentions?: string[];
    isReply?: boolean;
    isRetweet?: boolean;
    isQuote?: boolean;
  };
  
  // Execution metadata
  taskId?: string;
  slotId?: string;
  accountId?: string;
  fetchedAt: number;
  
  // For indexing
  createdAt: number;
}

export interface ParsedTweetDoc extends ParsedTweet {
  _id: any;
}

// DTO for API responses
export interface ParsedTweetDTO {
  id: string;
  url?: string;
  text: string;
  timestamp: number;
  author: ParsedTweetAuthor;
  engagement: ParsedTweetEngagement;
  media?: Array<{ type: string; url: string }>;
  hashtags?: string[];
  mentions?: string[];
}

// Transform raw parser response to ParsedTweet
export function mapRawToParsedTweet(
  raw: any,
  source: 'SEARCH' | 'ACCOUNT_TWEETS',
  context: { query?: string; username?: string; taskId?: string; slotId?: string; accountId?: string }
): Omit<ParsedTweet, '_id'> {
  const now = Date.now();
  
  return {
    network: 'twitter',
    source,
    query: context.query,
    username: context.username,
    tweet: {
      id: raw.id || raw.tweetId || String(now),
      url: raw.url || raw.tweetUrl,
      text: raw.text || raw.content || '',
      timestamp: raw.timestamp || raw.createdAt || now,
      author: {
        username: raw.author?.username || raw.username || raw.user?.username || 'unknown',
        displayName: raw.author?.displayName || raw.author?.name || raw.user?.name,
        verified: raw.author?.verified || raw.user?.verified || false,
        avatarUrl: raw.author?.avatarUrl || raw.user?.avatar,
      },
      engagement: {
        likes: raw.likes || raw.likeCount || raw.engagement?.likes || 0,
        reposts: raw.reposts || raw.retweetCount || raw.engagement?.reposts || 0,
        replies: raw.replies || raw.replyCount || raw.engagement?.replies || 0,
        views: raw.views || raw.viewCount || raw.engagement?.views,
        bookmarks: raw.bookmarks || raw.bookmarkCount,
      },
      media: raw.media,
      hashtags: raw.hashtags,
      mentions: raw.mentions,
      isReply: raw.isReply,
      isRetweet: raw.isRetweet,
      isQuote: raw.isQuote,
    },
    taskId: context.taskId,
    slotId: context.slotId,
    accountId: context.accountId,
    fetchedAt: now,
    createdAt: now,
  };
}

// Transform ParsedTweet to DTO
export function parsedTweetToDTO(tweet: ParsedTweet): ParsedTweetDTO {
  return {
    id: tweet.tweet.id,
    url: tweet.tweet.url,
    text: tweet.tweet.text,
    timestamp: tweet.tweet.timestamp,
    author: tweet.tweet.author,
    engagement: tweet.tweet.engagement,
    media: tweet.tweet.media,
    hashtags: tweet.tweet.hashtags,
    mentions: tweet.tweet.mentions,
  };
}
