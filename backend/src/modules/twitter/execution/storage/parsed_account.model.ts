// B3 - Parsed Account Model
// Storage for parsed Twitter accounts

export interface ParsedAccountMetrics {
  followers: number;
  following: number;
  tweets: number;
  likes?: number;
  lists?: number;
}

export interface ParsedAccount {
  _id?: string;
  network: 'twitter';
  
  // Account data
  username: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  avatar?: string;
  banner?: string;
  verified?: boolean;
  protected?: boolean;
  
  metrics: ParsedAccountMetrics;
  
  joinedAt?: number;
  
  // Execution metadata
  taskId?: string;
  slotId?: string;
  accountId?: string;
  fetchedAt: number;
  
  createdAt: number;
  updatedAt: number;
}

export interface ParsedAccountDoc extends ParsedAccount {
  _id: any;
}

// DTO for API responses
export interface ParsedAccountDTO {
  username: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  avatar?: string;
  banner?: string;
  verified?: boolean;
  metrics: ParsedAccountMetrics;
  joinedAt?: number;
}

// Transform raw parser response to ParsedAccount
export function mapRawToParsedAccount(
  raw: any,
  context: { taskId?: string; slotId?: string; accountId?: string }
): Omit<ParsedAccount, '_id'> {
  const now = Date.now();
  
  return {
    network: 'twitter',
    username: raw.username || raw.screen_name || raw.handle || 'unknown',
    displayName: raw.displayName || raw.name,
    bio: raw.bio || raw.description,
    location: raw.location,
    website: raw.website || raw.url,
    avatar: raw.avatar || raw.profileImageUrl || raw.profile_image_url,
    banner: raw.banner || raw.profileBannerUrl || raw.profile_banner_url,
    verified: raw.verified || raw.is_verified || false,
    protected: raw.protected || raw.is_protected || false,
    metrics: {
      followers: raw.followers || raw.followersCount || raw.followers_count || 0,
      following: raw.following || raw.friendsCount || raw.friends_count || 0,
      tweets: raw.tweets || raw.statusesCount || raw.statuses_count || 0,
      likes: raw.likes || raw.favouritesCount || raw.favourites_count,
      lists: raw.lists || raw.listedCount || raw.listed_count,
    },
    joinedAt: raw.joinedAt || raw.createdAt,
    taskId: context.taskId,
    slotId: context.slotId,
    accountId: context.accountId,
    fetchedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

// Transform ParsedAccount to DTO
export function parsedAccountToDTO(account: ParsedAccount): ParsedAccountDTO {
  return {
    username: account.username,
    displayName: account.displayName,
    bio: account.bio,
    location: account.location,
    website: account.website,
    avatar: account.avatar,
    banner: account.banner,
    verified: account.verified,
    metrics: account.metrics,
    joinedAt: account.joinedAt,
  };
}
