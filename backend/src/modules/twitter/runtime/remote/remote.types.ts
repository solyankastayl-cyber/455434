// B3.3 - Remote Runtime Types
// Contract for Railway / External Parser communication

export interface RemoteHealthResponse {
  status: 'OK' | 'ERROR' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'DOWN';
  message?: string;
  version?: string;
  uptime?: number;
}

export interface RemoteTweetAuthor {
  id?: string;
  username: string;
  displayName?: string;
  name?: string; // alias for displayName
  verified?: boolean;
  profileImageUrl?: string;
  avatar_url?: string; // alias
}

export interface RemoteTweetStats {
  likes: number;
  reposts: number;
  retweets?: number; // alias for reposts
  replies: number;
  views?: number;
  impressions?: number; // alias for views
}

export interface RemoteTweet {
  id: string;
  text: string;
  full_text?: string; // alias
  content?: string; // alias
  author: RemoteTweetAuthor;
  user?: RemoteTweetAuthor; // alias
  stats: RemoteTweetStats;
  metrics?: RemoteTweetStats; // alias
  createdAt: number;
  created_at?: string | number; // alias
  timestamp?: number; // alias
}

export interface RemoteSearchResponse {
  ok?: boolean;
  tweets: RemoteTweet[];
  items?: RemoteTweet[]; // alias
  data?: RemoteTweet[]; // alias
  meta?: {
    requested?: number;
    returned?: number;
    cursor?: string;
  };
}

export interface RemoteAccountResponse {
  ok?: boolean;
  account?: {
    id?: string;
    username: string;
    displayName?: string;
    name?: string;
    bio?: string;
    description?: string;
    followers: number;
    followers_count?: number;
    following?: number;
    following_count?: number;
    verified?: boolean;
    avatar?: string;
    profile_image_url?: string;
  };
  user?: RemoteAccountResponse['account']; // alias
  data?: RemoteAccountResponse['account']; // alias
}
