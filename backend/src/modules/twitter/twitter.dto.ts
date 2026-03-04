// Backend DTO Contracts - STABLE API

export interface TwitterTweetDTO {
  id: string;
  text: string;
  author?: {
    username: string;
    displayName?: string;
    verified?: boolean;
  };
  engagement: {
    likes: number;
    reposts: number;
    replies: number;
    views?: number;
  };
  timestamp: number;
  source: 'twitter';
  url?: string;
}

export interface TwitterAccountDTO {
  username: string;
  displayName: string;
  bio?: string;
  followers: number;
  following: number;
  tweets: number;
  verified: boolean;
  avatar?: string;
  banner?: string;
  createdAt?: string;
}

export interface TwitterSearchResultDTO {
  query: string;
  mode: string;
  count: number;
  tweets: TwitterTweetDTO[];
  limits?: {
    requested: number;
    returned: number;
    max: number;
  };
}

export interface TwitterAccountTweetsDTO {
  username: string;
  user: TwitterAccountDTO;
  tweets: TwitterTweetDTO[];
  count: number;
}

export interface TwitterFollowersDTO {
  username: string;
  mode: string;
  followers: TwitterAccountDTO[];
  count: number;
  limits?: {
    found: number;
    returned: number;
    max: number;
  };
}
