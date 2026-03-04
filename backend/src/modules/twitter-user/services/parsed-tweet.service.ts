// Parsed Tweet Service - query with filters
import { UserTwitterParsedTweetModel } from '../models/twitter-parsed-tweet.model.js';
import { userScope } from '../acl/ownership.js';
import type { TweetsQueryDTO, ParsedTweetDTO } from '../dto/twitter-user.dto.js';

export class ParsedTweetService {
  async queryUserTweets(
    userId: string,
    q: TweetsQueryDTO
  ): Promise<{ items: ParsedTweetDTO[]; nextCursor: string | null }> {
    const scope = userScope(userId);

    // Build mongo query
    const mongoQuery: any = { ...scope };

    if (q.keyword) {
      mongoQuery.keyword = q.keyword;
    }

    if (typeof q.minLikes === 'number') {
      mongoQuery.likes = { ...(mongoQuery.likes ?? {}), $gte: q.minLikes };
    }

    if (typeof q.minReposts === 'number') {
      mongoQuery.reposts = { ...(mongoQuery.reposts ?? {}), $gte: q.minReposts };
    }

    if (q.timeRange?.from || q.timeRange?.to) {
      mongoQuery.createdAt = {};
      if (q.timeRange.from) {
        mongoQuery.createdAt.$gte = new Date(q.timeRange.from);
      }
      if (q.timeRange.to) {
        mongoQuery.createdAt.$lte = new Date(q.timeRange.to);
      }
    }

    if (q.cursor) {
      mongoQuery.createdAt = {
        ...(mongoQuery.createdAt ?? {}),
        $lt: new Date(q.cursor),
      };
    }

    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);

    // Execute query
    const rows = await UserTwitterParsedTweetModel.find(mongoQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Map to DTO
    const items: ParsedTweetDTO[] = rows.map((r) => ({
      tweetId: r.tweetId,
      text: r.text,
      username: r.username,
      displayName: r.displayName,
      likes: r.likes,
      reposts: r.reposts,
      replies: r.replies,
      views: r.views,
      tweetedAt: r.tweetedAt?.toISOString(),
      url: r.url,
      createdAt: (r as any).createdAt?.toISOString(),
    }));

    const nextCursor =
      rows.length ? (rows[rows.length - 1] as any).createdAt?.toISOString() : null;

    return { items, nextCursor };
  }
}
