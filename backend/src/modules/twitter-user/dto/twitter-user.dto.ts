// User query DTO (likes/reposts/timeRange)

export interface TimeRangeDTO {
  from?: string; // ISO
  to?: string; // ISO
}

export interface TweetsQueryDTO {
  keyword?: string;
  minLikes?: number;
  minReposts?: number;
  timeRange?: TimeRangeDTO;
  limit?: number; // default 50
  cursor?: string; // optional (createdAt < cursor)
}

export interface ParsedTweetDTO {
  tweetId: string;
  text: string;
  username: string;
  displayName?: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  tweetedAt?: string;
  url?: string;
  createdAt: string;
}
