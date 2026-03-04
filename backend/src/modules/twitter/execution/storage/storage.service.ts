// B3 - Storage Service
// Persists parsed results to MongoDB

import { Collection, Db, ObjectId } from 'mongodb';
import {
  ParsedTweet,
  ParsedTweetDoc,
  mapRawToParsedTweet,
} from './parsed_tweet.model.js';
import {
  ParsedAccount,
  ParsedAccountDoc,
  mapRawToParsedAccount,
} from './parsed_account.model.js';
import {
  ExecutionTask,
  ExecutionTaskDoc,
  ExecutionTaskStatus,
  CreateExecutionTaskDto,
  createExecutionTask,
  ExecutionTaskResultRef,
} from './execution_task.model.js';

const TWEETS_COLLECTION = 'twitter_parsed_tweets';
const ACCOUNTS_COLLECTION = 'twitter_parsed_accounts';
const TASKS_COLLECTION = 'twitter_execution_tasks';

export class StorageService {
  private tweets: Collection<ParsedTweetDoc>;
  private accounts: Collection<ParsedAccountDoc>;
  private tasks: Collection<ExecutionTaskDoc>;

  constructor(db: Db) {
    this.tweets = db.collection(TWEETS_COLLECTION);
    this.accounts = db.collection(ACCOUNTS_COLLECTION);
    this.tasks = db.collection(TASKS_COLLECTION);
  }

  // ==================== INDEXES ====================

  async ensureIndexes(): Promise<void> {
    // Tweets indexes
    await this.tweets.createIndex({ 'tweet.id': 1 }, { unique: true, sparse: true });
    await this.tweets.createIndex({ source: 1, query: 1 });
    await this.tweets.createIndex({ source: 1, username: 1 });
    await this.tweets.createIndex({ fetchedAt: -1 });
    await this.tweets.createIndex({ taskId: 1 });
    
    // P2 - Engagement filter indexes
    await this.tweets.createIndex({ 'tweet.engagement.likes': -1 });
    await this.tweets.createIndex({ 'tweet.engagement.reposts': -1 });
    await this.tweets.createIndex({ 'tweet.timestamp': -1 });
    await this.tweets.createIndex({ 'tweet.author.username': 1 });
    await this.tweets.createIndex({ 'tweet.hashtags': 1 });

    // Accounts indexes
    await this.accounts.createIndex({ username: 1 });
    await this.accounts.createIndex({ fetchedAt: -1 });

    // Tasks indexes
    await this.tasks.createIndex({ status: 1 });
    await this.tasks.createIndex({ createdAt: -1 });
    await this.tasks.createIndex({ status: 1, priority: -1, createdAt: 1 });
  }

  // ==================== TWEETS ====================

  /**
   * Store parsed tweets from raw response
   */
  async storeTweets(
    rawItems: any[],
    source: 'SEARCH' | 'ACCOUNT_TWEETS',
    context: { query?: string; username?: string; taskId?: string; slotId?: string; accountId?: string }
  ): Promise<string[]> {
    if (!rawItems || rawItems.length === 0) return [];

    const tweets = rawItems.map((raw) =>
      mapRawToParsedTweet(raw, source, context)
    );

    const insertedIds: string[] = [];

    // Use upsert to avoid duplicates
    for (const tweet of tweets) {
      try {
        // Remove createdAt/updatedAt from tweet to avoid $set/$setOnInsert conflict
        const { createdAt, updatedAt, ...tweetData } = tweet as any;
        
        const result = await this.tweets.updateOne(
          { 'tweet.id': tweet.tweet.id },
          {
            $set: tweetData,
            $setOnInsert: { createdAt: Date.now() },
          },
          { upsert: true }
        );

        if (result.upsertedId) {
          insertedIds.push(result.upsertedId.toString());
        }
      } catch (error) {
        // Ignore duplicate key errors
        console.error('[Storage] Tweet insert error:', error);
      }
    }

    return insertedIds;
  }

  /**
   * Get tweets by query
   */
  async getTweetsByQuery(
    query: string,
    limit = 100
  ): Promise<ParsedTweet[]> {
    const docs = await this.tweets
      .find({ source: 'SEARCH', query })
      .sort({ fetchedAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({ ...doc, _id: doc._id.toString() }));
  }

  /**
   * Get tweets by username
   */
  async getTweetsByUsername(
    username: string,
    limit = 100
  ): Promise<ParsedTweet[]> {
    const docs = await this.tweets
      .find({
        $or: [
          { source: 'ACCOUNT_TWEETS', username },
          { 'tweet.author.username': username },
        ],
      })
      .sort({ fetchedAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({ ...doc, _id: doc._id.toString() }));
  }

  /**
   * Get recent tweets
   */
  async getRecentTweets(limit = 100): Promise<ParsedTweet[]> {
    const docs = await this.tweets
      .find({})
      .sort({ fetchedAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({ ...doc, _id: doc._id.toString() }));
  }

  /**
   * Query tweets with filters (P2 - Filtered Query)
   */
  async queryTweets(
    filters: import('./tweet.query.js').TweetQueryFilters
  ): Promise<{ items: ParsedTweet[]; total: number; limit: number; offset: number }> {
    const { buildTweetQuery, normalizeFilters } = await import('./tweet.query.js');
    
    const normalized = normalizeFilters(filters);
    const query = buildTweetQuery(normalized);
    const limit = normalized.limit || 50;
    const offset = normalized.offset || 0;

    const [docs, total] = await Promise.all([
      this.tweets
        .find(query)
        .sort({ 'tweet.timestamp': -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.tweets.countDocuments(query),
    ]);

    return {
      items: docs.map((doc) => ({ ...doc, _id: doc._id.toString() })),
      total,
      limit,
      offset,
    };
  }

  // ==================== ACCOUNTS ====================

  /**
   * Store parsed account
   */
  async storeAccount(
    raw: any,
    context: { taskId?: string; slotId?: string; accountId?: string }
  ): Promise<string | null> {
    if (!raw) return null;

    const account = mapRawToParsedAccount(raw, context);

    try {
      // Remove createdAt/updatedAt from account to avoid conflict
      const { createdAt, updatedAt, ...accountData } = account as any;
      
      const result = await this.accounts.updateOne(
        { username: account.username },
        {
          $set: { ...accountData, updatedAt: Date.now() },
          $setOnInsert: { createdAt: Date.now() },
        },
        { upsert: true }
      );

      if (result.upsertedId) {
        return result.upsertedId.toString();
      }
      return null;
    } catch (error) {
      console.error('[Storage] Account insert error:', error);
      return null;
    }
  }

  /**
   * Get account by username
   */
  async getAccount(username: string): Promise<ParsedAccount | null> {
    const doc = await this.accounts.findOne({ username });
    if (!doc) return null;
    return { ...doc, _id: doc._id.toString() };
  }

  // ==================== TASKS ====================

  /**
   * Create new task
   */
  async createTask(dto: CreateExecutionTaskDto): Promise<ExecutionTask> {
    const task = createExecutionTask(dto);
    const result = await this.tasks.insertOne(task as ExecutionTaskDoc);
    return { ...task, _id: result.insertedId.toString() };
  }

  /**
   * Get next tasks from queue
   */
  async dequeue(limit = 3): Promise<ExecutionTask[]> {
    const docs = await this.tasks
      .find({ status: 'QUEUED' })
      .sort({ priority: -1, createdAt: 1 }) // HIGH priority first, then oldest
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({ ...doc, _id: doc._id.toString() }));
  }

  /**
   * Mark task as running
   */
  async markRunning(taskId: string, slotId: string): Promise<void> {
    await this.tasks.updateOne(
      { _id: new ObjectId(taskId) },
      {
        $set: {
          status: 'RUNNING',
          slotId,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        },
        $inc: { attempts: 1 },
      }
    );
  }

  /**
   * Mark task as done
   */
  async markDone(
    taskId: string,
    resultRef: ExecutionTaskResultRef,
    resultCount: number
  ): Promise<void> {
    await this.tasks.updateOne(
      { _id: new ObjectId(taskId) },
      {
        $set: {
          status: 'DONE',
          resultRef,
          resultCount,
          finishedAt: Date.now(),
          updatedAt: Date.now(),
        },
      }
    );
  }

  /**
   * Mark task as failed
   */
  async markFailed(
    taskId: string,
    error: { code: string; message: string; raw?: any }
  ): Promise<void> {
    await this.tasks.updateOne(
      { _id: new ObjectId(taskId) },
      {
        $set: {
          status: 'FAILED',
          error,
          finishedAt: Date.now(),
          updatedAt: Date.now(),
        },
      }
    );
  }

  /**
   * Retry or fail task based on attempts
   */
  async retryOrFail(
    task: ExecutionTask,
    error: { code: string; message: string }
  ): Promise<void> {
    if (task.attempts < task.maxAttempts) {
      // Retry - put back in queue
      await this.tasks.updateOne(
        { _id: new ObjectId(task._id) },
        {
          $set: {
            status: 'QUEUED',
            updatedAt: Date.now(),
          },
        }
      );
    } else {
      // Max attempts reached - fail
      await this.markFailed(task._id!, error);
    }
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<ExecutionTask | null> {
    try {
      const doc = await this.tasks.findOne({ _id: new ObjectId(taskId) });
      if (!doc) return null;
      return { ...doc, _id: doc._id.toString() };
    } catch {
      return null;
    }
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(
    status: ExecutionTaskStatus,
    limit = 100
  ): Promise<ExecutionTask[]> {
    const docs = await this.tasks
      .find({ status })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({ ...doc, _id: doc._id.toString() }));
  }

  /**
   * Get task statistics
   */
  async getTaskStats(): Promise<{
    queued: number;
    running: number;
    done: number;
    failed: number;
    total: number;
  }> {
    const pipeline = [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.tasks.aggregate(pipeline).toArray();

    const stats = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      total: 0,
    };

    for (const r of results) {
      const count = r.count;
      stats.total += count;
      switch (r._id) {
        case 'QUEUED':
          stats.queued = count;
          break;
        case 'RUNNING':
          stats.running = count;
          break;
        case 'DONE':
          stats.done = count;
          break;
        case 'FAILED':
          stats.failed = count;
          break;
      }
    }

    return stats;
  }

  /**
   * Cancel pending tasks
   */
  async cancelPendingTasks(): Promise<number> {
    const result = await this.tasks.updateMany(
      { status: { $in: ['QUEUED', 'RUNNING'] } },
      { $set: { status: 'CANCELLED', updatedAt: Date.now() } }
    );
    return result.modifiedCount;
  }

  /**
   * Clear old completed tasks
   */
  async cleanupOldTasks(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const result = await this.tasks.deleteMany({
      status: { $in: ['DONE', 'FAILED', 'CANCELLED'] },
      finishedAt: { $lt: cutoff },
    });
    return result.deletedCount;
  }
}

// Singleton factory
let storageService: StorageService | null = null;

export function getStorageService(db: Db): StorageService {
  if (!storageService) {
    storageService = new StorageService(db);
  }
  return storageService;
}
