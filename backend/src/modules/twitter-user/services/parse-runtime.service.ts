/**
 * Parse Runtime Service - Phase 1.4 + Phase 5.3 + Connections Integration
 * 
 * Главный orchestrator для парсинга:
 * 1. Select runtime config (Phase 1.3)
 * 2. Call parser
 * 3. Handle abort
 * 4. Save tweets
 * 5. Return result
 * 6. Track quality metrics (Phase 5.3)
 * 7. Send to Connections service for author analysis
 */

import { SessionSelectorService, type ParserRuntimeConfig } from './session-selector.service.js';
import { ParserClientService, type ParsedTweet } from './parser-client.service.js';
import { AbortHandlerService } from './abort-handler.service.js';
import { UserTwitterParsedTweetModel } from '../models/twitter-parsed-tweet.model.js';
import { UserTwitterParseTaskModel, type ParseTaskStatus } from '../models/twitter-parse-task.model.js';
import { UserTwitterParseTargetModel } from '../models/user-twitter-parse-target.model.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { userScope } from '../acl/ownership.js';
import { cooldownService } from '../../twitter/execution/cooldown/index.js';
import { telegramRouter } from '../../telegram/index.js';
import { parserQualityService } from './parser-quality.service.js';
import { getConnectionsClient } from '../../../clients/connections.client.js';
import type { ParseSearchRequest, ParseSearchResponse, ParseAccountRequest } from '../dto/parse-request.dto.js';

export class ParseRuntimeService {
  private readonly sessionSelector: SessionSelectorService;
  private readonly parserClient: ParserClientService;
  private readonly abortHandler: AbortHandlerService;

  constructor(crypto: CryptoService) {
    this.sessionSelector = new SessionSelectorService(crypto);
    this.parserClient = new ParserClientService();
    this.abortHandler = new AbortHandlerService();
  }

  /**
   * Parse search - main entry point
   * 
   * Flow:
   * 1. Create task record (PENDING)
   * 2. Select runtime (SessionSelector)
   * 3. Update task (RUNNING)
   * 4. Call parser
   * 5. Handle result (abort/success)
   * 6. Save tweets
   * 7. Update task (DONE/PARTIAL/FAILED)
   * 8. Return response
   */
  async parseSearch(input: {
    ownerUserId: string;
    query: string;
    limit: number;
    filters?: ParseSearchRequest['filters'];
    targetId?: string;  // For scheduled tasks - to update target stats
  }): Promise<ParseSearchResponse> {
    const { ownerUserId, query, limit, filters, targetId } = input;

    console.log(`[ParseRuntime] Starting search | user: ${ownerUserId} | query: "${query}" | limit: ${limit}`);

    // 1. Select runtime
    const selection = await this.sessionSelector.selectForUser(ownerUserId);

    if (!selection.ok || !selection.config) {
      console.log(`[ParseRuntime] No runtime available | reason: ${selection.reason}`);
      return {
        status: 'FAILED',
        reason: selection.reason || 'NO_ACTIVE_SESSION',
      };
    }

    const runtime = selection.config;

    // 2. Create task record
    const task = await UserTwitterParseTaskModel.create({
      ownerUserId,
      accountId: runtime.accountId,
      sessionId: runtime.sessionId,
      type: 'SEARCH',
      query,
      limit,
      filters,
      status: 'PENDING',
      fetched: 0,
    });

    const taskId = String(task._id);

    try {
      // 3. Update task to RUNNING
      await UserTwitterParseTaskModel.updateOne(
        { _id: taskId },
        { $set: { status: 'RUNNING', startedAt: new Date() } }
      );

      // 4. Call parser
      const result = await this.parserClient.parseSearch({
        query,
        limit,
        filters,
        runtime,
      });

      const { tweets, engineSummary } = result;

      // 5. Handle abort - but distinguish real errors from "nothing found"
      // aborted:true with NO abortReason and fetched=0 is just "no results found" (valid)
      const isRealAbort = engineSummary.aborted && 
        engineSummary.abortReason && 
        engineSummary.abortReason !== 'NO_RESULTS';
      
      if (isRealAbort) {
        await this.abortHandler.handleAbort({
          ownerUserId,
          runtime,
          engineSummary,
          taskId,
        });

        // Determine status: PARTIAL if some tweets, FAILED if none with real error
        const status: ParseTaskStatus = tweets.length > 0 ? 'PARTIAL' : 'FAILED';

        // Save whatever tweets we got
        if (tweets.length > 0) {
          await this.saveTweets({
            ownerUserId,
            accountId: runtime.accountId,
            sessionId: runtime.sessionId,
            taskId,
            source: 'SEARCH',
            query,
            tweets,
            targetId,  // Pass targetId for stats update
          });
        }

        // Update task
        await UserTwitterParseTaskModel.updateOne(
          { _id: taskId },
          {
            $set: {
              status,
              fetched: tweets.length,
              durationMs: engineSummary.durationMs,
              engineSummary,
              error: engineSummary.abortReason,
              completedAt: new Date(),
            },
          }
        );

        return {
          status: status === 'PARTIAL' ? 'PARTIAL' : 'ABORTED',
          fetched: tweets.length,
          durationMs: engineSummary.durationMs,
          reason: engineSummary.abortReason,
          taskId,
          accountId: runtime.accountId,
        };
      }

      // 5b. Handle "soft abort" - aborted:true but no real error (just no results)
      // This is NOT an error, just an empty search result
      if (engineSummary.aborted && !engineSummary.abortReason && tweets.length === 0) {
        console.log(`[ParseRuntime] Empty result (no tweets found) - this is OK, not an error`);
        
        // Update task to DONE with 0 tweets (valid result)
        await UserTwitterParseTaskModel.updateOne(
          { _id: taskId },
          {
            $set: {
              status: 'DONE',
              fetched: 0,
              durationMs: engineSummary.durationMs,
              engineSummary,
              completedAt: new Date(),
            },
          }
        );

        // Phase 4.2: Track consecutive empty results for cooldown
        if (targetId) {
          const triggeredCooldown = await cooldownService.trackEmptyResult(targetId);
          if (triggeredCooldown) {
            console.log(`[ParseRuntime] Target ${targetId} entered cooldown due to consecutive empty results`);
          }
          await this.updateTargetStats(targetId, 0);
        }

        return {
          status: 'OK',
          fetched: 0,
          durationMs: engineSummary.durationMs,
          taskId,
          accountId: runtime.accountId,
        };
      }

      // 6. Save tweets (success path)
      // Phase 4.2: Reset consecutive empty count on success
      if (targetId && tweets.length > 0) {
        await cooldownService.resetEmptyCount(targetId);
      }
      
      const saved = await this.saveTweets({
        ownerUserId,
        accountId: runtime.accountId,
        sessionId: runtime.sessionId,
        taskId,
        source: 'SEARCH',
        query,
        tweets,
        targetId,  // Pass targetId for stats update
      });

      // 7. Update task to DONE
      await UserTwitterParseTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'DONE',
            fetched: saved,
            durationMs: engineSummary.durationMs,
            engineSummary,
            completedAt: new Date(),
          },
        }
      );

      // 8. Update session metrics (success)
      await this.updateSessionMetrics(runtime.sessionId, engineSummary);

      console.log(`[ParseRuntime] Search complete | fetched: ${saved} | duration: ${engineSummary.durationMs}ms`);

      return {
        status: 'OK',
        fetched: saved,
        durationMs: engineSummary.durationMs,
        taskId,
        accountId: runtime.accountId,
      };

    } catch (error: any) {
      console.error(`[ParseRuntime] Unexpected error:`, error.message);

      // Update task to FAILED
      await UserTwitterParseTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'FAILED',
            error: error.message,
            completedAt: new Date(),
          },
        }
      );

      return {
        status: 'FAILED',
        reason: error.message,
        taskId,
      };
    }
  }

  /**
   * Parse account tweets
   */
  async parseAccount(input: {
    ownerUserId: string;
    username: string;
    limit: number;
    targetId?: string;  // For scheduled tasks - to update target stats
  }): Promise<ParseSearchResponse> {
    const { ownerUserId, username, limit, targetId } = input;

    console.log(`[ParseRuntime] Starting account parse | user: ${ownerUserId} | target: @${username}`);

    // Select runtime
    const selection = await this.sessionSelector.selectForUser(ownerUserId);

    if (!selection.ok || !selection.config) {
      return {
        status: 'FAILED',
        reason: selection.reason || 'NO_ACTIVE_SESSION',
      };
    }

    const runtime = selection.config;

    // Create task
    const task = await UserTwitterParseTaskModel.create({
      ownerUserId,
      accountId: runtime.accountId,
      sessionId: runtime.sessionId,
      type: 'ACCOUNT',
      targetUsername: username,
      limit,
      status: 'PENDING',
      fetched: 0,
    });

    const taskId = String(task._id);

    try {
      await UserTwitterParseTaskModel.updateOne(
        { _id: taskId },
        { $set: { status: 'RUNNING', startedAt: new Date() } }
      );

      const result = await this.parserClient.parseAccount({
        username,
        limit,
        runtime,
      });

      const { tweets, engineSummary } = result;

      if (engineSummary.aborted) {
        await this.abortHandler.handleAbort({
          ownerUserId,
          runtime,
          engineSummary,
          taskId,
        });

        const status: ParseTaskStatus = tweets.length > 0 ? 'PARTIAL' : 'FAILED';

        if (tweets.length > 0) {
          await this.saveTweets({
            ownerUserId,
            accountId: runtime.accountId,
            sessionId: runtime.sessionId,
            taskId,
            source: 'ACCOUNT',
            targetUsername: username,
            tweets,
            targetId,  // Pass targetId for stats update
          });
        }

        await UserTwitterParseTaskModel.updateOne(
          { _id: taskId },
          {
            $set: {
              status,
              fetched: tweets.length,
              durationMs: engineSummary.durationMs,
              engineSummary,
              error: engineSummary.abortReason,
              completedAt: new Date(),
            },
          }
        );

        return {
          status: status === 'PARTIAL' ? 'PARTIAL' : 'ABORTED',
          fetched: tweets.length,
          durationMs: engineSummary.durationMs,
          reason: engineSummary.abortReason,
          taskId,
          accountId: runtime.accountId,
        };
      }

      const saved = await this.saveTweets({
        ownerUserId,
        accountId: runtime.accountId,
        sessionId: runtime.sessionId,
        taskId,
        source: 'ACCOUNT',
        targetUsername: username,
        tweets,
        targetId,  // Pass targetId for stats update
      });

      await UserTwitterParseTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'DONE',
            fetched: saved,
            durationMs: engineSummary.durationMs,
            engineSummary,
            completedAt: new Date(),
          },
        }
      );

      await this.updateSessionMetrics(runtime.sessionId, engineSummary);

      return {
        status: 'OK',
        fetched: saved,
        durationMs: engineSummary.durationMs,
        taskId,
        accountId: runtime.accountId,
      };

    } catch (error: any) {
      await UserTwitterParseTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'FAILED',
            error: error.message,
            completedAt: new Date(),
          },
        }
      );

      return {
        status: 'FAILED',
        reason: error.message,
        taskId,
      };
    }
  }

  /**
   * Save tweets to database with deduplication
   * Also updates target stats if targetId is provided
   */
  private async saveTweets(input: {
    ownerUserId: string;
    accountId: string;
    sessionId: string;
    taskId: string;
    source: 'SEARCH' | 'ACCOUNT';
    query?: string;
    targetUsername?: string;
    tweets: ParsedTweet[];
    targetId?: string;  // For scheduled tasks - to update target stats
  }): Promise<number> {
    const { ownerUserId, accountId, sessionId, taskId, source, query, targetUsername, tweets, targetId } = input;

    console.log(`[ParseRuntime] saveTweets called | tweets.length: ${tweets.length} | targetId: ${targetId || 'none'}`);
    
    if (tweets.length === 0) {
      console.log(`[ParseRuntime] No tweets to save`);
      // Still update target stats even if no new tweets (run happened)
      if (targetId) {
        await this.updateTargetStats(targetId, 0);
      }
      return 0;
    }

    const scope = userScope(ownerUserId);
    const docs = tweets.map(tweet => ({
      ...scope,
      accountId,
      sessionId,
      taskId,
      source,
      query,
      targetUsername,
      tweetId: tweet.id,
      text: tweet.text,
      username: tweet.author.username,
      displayName: tweet.author.name,
      likes: tweet.likes,
      reposts: tweet.reposts,
      replies: tweet.replies,
      views: tweet.views,
      author: tweet.author,
      media: tweet.media,
      tweetedAt: tweet.createdAt ? new Date(tweet.createdAt) : undefined,
      parsedAt: new Date(),
      // Legacy field for backward compatibility
      keyword: query,
    }));

    let insertedCount = 0;

    try {
      console.log(`[ParseRuntime] Inserting ${docs.length} docs, first tweetId: ${docs[0]?.tweetId}`);
      // Use ordered: false for bulk insert with dedupe
      const result = await UserTwitterParsedTweetModel.insertMany(docs, {
        ordered: false,
        rawResult: true, // Get raw result for debugging
      });
      console.log(`[ParseRuntime] insertMany rawResult: ${JSON.stringify(result)}`);
      // @ts-ignore - rawResult changes return type
      insertedCount = result.insertedCount ?? result.length ?? 0;
      console.log(`[ParseRuntime] insertedCount: ${insertedCount}`);
    } catch (error: any) {
      console.log(`[ParseRuntime] insertMany error: ${error.message}, code: ${error.code}, insertedCount: ${error.result?.insertedCount}`);
      // Handle duplicate key errors gracefully
      if (error.code === 11000 || error.writeErrors) {
        // Some documents were inserted, some were duplicates
        insertedCount = error.insertedDocs?.length || 
          (tweets.length - (error.writeErrors?.length || 0));
        console.log(`[ParseRuntime] Saved ${insertedCount} tweets (${error.writeErrors?.length || 0} duplicates skipped)`);
      } else {
        throw error;
      }
    }

    // Send tweets to Connections service for author profile analysis (async, non-blocking)
    this.sendToConnectionsService(tweets).catch(err => {
      console.warn(`[ParseRuntime] Connections integration error:`, err.message);
    });

    // Update target stats if targetId is provided (scheduled tasks)
    if (targetId) {
      await this.updateTargetStats(targetId, insertedCount);
      
      // Phase 5.3: Record quality metrics
      try {
        const target = await UserTwitterParseTargetModel.findById(targetId).lean();
        if (target && target.ownerUserId) {
          const qualityAssessment = await parserQualityService.recordRun({
            targetId,
            accountId,
            ownerUserId: target.ownerUserId.toString(),
            fetched: insertedCount,
          });
          
          // Log quality status
          console.log(`[ParseRuntime] Quality: ${qualityAssessment.status} (score: ${qualityAssessment.score})`);
          
          // Phase 5.2.2: Notify user about new tweets via Telegram
          if (insertedCount > 0) {
            await telegramRouter.notifyNewTweets(target.ownerUserId.toString(), {
              count: insertedCount,
              target: target.query || target.targetUsername || 'unknown',
              targetType: target.type === 'KEYWORD' ? 'keyword' : 'account',
            });
          }
        }
      } catch (notifyErr: any) {
        console.warn(`[ParseRuntime] Quality/notification error:`, notifyErr.message);
        // Don't fail the operation for secondary errors
      }
    }

    return insertedCount;
  }

  /**
   * Update target statistics after parsing
   */
  private async updateTargetStats(targetId: string, postsFetched: number, error?: string): Promise<void> {
    console.log(`[ParseRuntime] Updating target stats | targetId: ${targetId} | postsFetched: ${postsFetched}`);
    
    try {
      await UserTwitterParseTargetModel.updateOne(
        { _id: targetId },
        {
          $inc: {
            'stats.totalRuns': 1,
            'stats.totalPostsFetched': postsFetched,
          },
          $set: {
            'stats.lastRunAt': new Date(),
            'stats.lastError': error ?? null,
          },
        }
      );
      console.log(`[ParseRuntime] Target stats updated successfully`);
    } catch (err: any) {
      console.error(`[ParseRuntime] Failed to update target stats:`, err.message);
      // Don't throw - this is a secondary operation
    }
  }

  /**
   * Update session metrics after successful parse
   */
  private async updateSessionMetrics(
    sessionId: string,
    engineSummary: { durationMs: number; riskMax: number }
  ): Promise<void> {
    const { UserTwitterSessionModel } = await import('../models/twitter-session.model.js');

    // Calculate running average latency
    // Ensure riskScore is a valid number
    const validRiskScore = Number.isFinite(engineSummary.riskMax) 
      ? Math.max(0, Math.min(engineSummary.riskMax, 100)) 
      : 0;
    
    await UserTwitterSessionModel.updateOne(
      { _id: sessionId, isActive: true },
      {
        $set: {
          lastOkAt: new Date(),
          // Update risk score (decay towards 0 on success)
          riskScore: validRiskScore,
        },
      }
    );
  }

  /**
   * Send parsed tweets to Connections service for author profile analysis
   * Non-blocking, fire-and-forget approach to not slow down parsing
   */
  private async sendToConnectionsService(tweets: ParsedTweet[]): Promise<void> {
    if (tweets.length === 0) return;
    
    const connectionsClient = getConnectionsClient();
    
    // Map tweets to the format expected by Connections service
    const mappedTweets = tweets.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      author: {
        id: tweet.author.id,
        username: tweet.author.username,
        name: tweet.author.name,
        avatar: tweet.author.avatar,
        verified: tweet.author.verified,
        followers: tweet.author.followers,
      },
      likes: tweet.likes,
      reposts: tweet.reposts,
      replies: tweet.replies,
      views: tweet.views,
      createdAt: tweet.createdAt,
    }));
    
    const ingestedCount = await connectionsClient.ingestTweetsBatch(mappedTweets);
    console.log(`[ParseRuntime] Connections: ${ingestedCount}/${tweets.length} tweets sent for analysis`);
  }
}
