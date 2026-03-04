/**
 * TwitterSchedulerService - планировщик задач (Phase 5.3)
 * 
 * Превращает targets + quota → planned tasks
 * НЕ парсит, НЕ знает про scroll
 * Учитывает качество парсинга при планировании
 */

import { UserTwitterParseTargetModel, type IUserTwitterParseTarget, TwitterParseTargetType } from '../models/user-twitter-parse-target.model.js';
import { TwitterQuotaService, type QuotaStatusDTO } from './quota.service.js';
import { TwitterTaskModel, TaskStatus } from '../../twitter/execution/queue/task.model.js';
import { IntegrationService } from './integration.service.js';
import { TwitterIntegrationState } from '../types/twitter-integration-state.js';
import { userScope } from '../acl/ownership.js';
import { parserQualityService, QUALITY_THRESHOLDS } from './parser-quality.service.js';
import { ParserQualityMetricsModel, QualityStatus } from '../models/parser-quality-metrics.model.js';

/** Task kind mapping */
export enum TwitterTaskKind {
  SEARCH = 'search',
  ACCOUNT = 'account',
  THREAD = 'thread',
}

/** Task type for queue */
type TaskType = 'SEARCH' | 'ACCOUNT_TWEETS' | 'THREAD';

/** Planned task DTO */
export interface PlannedTask {
  targetId: string;
  kind: TwitterTaskKind;
  query: string;
  estimatedPosts: number;
  priority: number;
}

/** Batch DTO */
export interface PlannedBatch {
  ownerUserId: string;
  window: 'hour';
  totalPlannedPosts: number;
  tasks: PlannedTask[];
  skipped: {
    cooldown: number;
    alreadyPending: number;
    disabled: number;
    degradedQuality: number;  // Phase 5.3: skipped due to quality issues
  };
}

/** Priority multipliers by type */
const TYPE_PRIORITY: Record<TwitterParseTargetType, number> = {
  [TwitterParseTargetType.ACCOUNT]: 100,
  [TwitterParseTargetType.KEYWORD]: 50,
};

export class TwitterSchedulerService {
  private quotaService: TwitterQuotaService;
  private integrationService: IntegrationService;

  constructor() {
    this.quotaService = new TwitterQuotaService();
    this.integrationService = new IntegrationService();
  }

  /**
   * Создать план задач для пользователя
   * НЕ ставит в очередь, только планирует
   */
  async plan(ownerUserId: string): Promise<PlannedBatch> {
    const batch: PlannedBatch = {
      ownerUserId,
      window: 'hour',
      totalPlannedPosts: 0,
      tasks: [],
      skipped: {
        cooldown: 0,
        alreadyPending: 0,
        disabled: 0,
        degradedQuality: 0,  // Phase 5.3
      },
    };

    // 1. Check integration state
    const status = await this.integrationService.getStatus(ownerUserId);
    if (![TwitterIntegrationState.SESSION_OK, TwitterIntegrationState.SESSION_STALE].includes(status.state)) {
      return batch; // Can't plan without active sessions
    }

    // 2. Get quota
    const quota = await this.quotaService.getStatus(ownerUserId);
    let remainingBudget = quota.remainingHour;

    if (remainingBudget <= 0) {
      return batch; // No budget
    }

    // 3. Get enabled targets
    const targets = await UserTwitterParseTargetModel.find({
      ...userScope(ownerUserId),
      enabled: true,
    }).lean();

    // 4. Check pending tasks
    const pendingTargetIds = await this.getPendingTargetIds(ownerUserId);

    // 5. Sort targets by effective priority
    const sortedTargets = this.sortByPriority(targets);

    // 6. Plan tasks
    const now = new Date();

    for (const target of sortedTargets) {
      if (remainingBudget <= 0) break;

      // Skip disabled
      if (!target.enabled) {
        batch.skipped.disabled++;
        continue;
      }

      // Skip if already pending
      if (pendingTargetIds.has(target._id.toString())) {
        batch.skipped.alreadyPending++;
        continue;
      }

      // Phase 4.2: Skip if target on cooldown
      if (target.cooldownUntil && target.cooldownUntil > now) {
        console.log(`[Scheduler] SKIPPED_COOLDOWN target ${target._id} | reason: ${target.cooldownReason}`);
        batch.skipped.cooldown++;
        continue;
      }

      // Phase 5.3: Check quality metrics and reduce frequency if needed
      const qualityMetrics = await ParserQualityMetricsModel.findOne({
        targetId: target._id,
      }).lean();
      
      if (qualityMetrics) {
        // Skip UNSTABLE targets more aggressively
        if (qualityMetrics.qualityStatus === QualityStatus.UNSTABLE) {
          // Only run 1 in 3 times for unstable targets
          if (Math.random() > 0.33) {
            console.log(`[Scheduler] SKIPPED_UNSTABLE target ${target._id} | score: ${qualityMetrics.qualityScore}`);
            batch.skipped.degradedQuality++;
            continue;
          }
        }
        
        // DEGRADED targets run at 70% frequency
        if (qualityMetrics.qualityStatus === QualityStatus.DEGRADED) {
          if (Math.random() > 0.7) {
            console.log(`[Scheduler] SKIPPED_DEGRADED target ${target._id} | score: ${qualityMetrics.qualityScore}`);
            batch.skipped.degradedQuality++;
            continue;
          }
        }
      }

      // Skip if in scheduling cooldown (different from Phase 4.2 cooldown)
      if (target.lastPlannedAt) {
        const cooldownMs = target.cooldownMin * 60 * 1000;
        const elapsed = now.getTime() - new Date(target.lastPlannedAt).getTime();
        if (elapsed < cooldownMs) {
          batch.skipped.cooldown++;
          continue;
        }
      }

      // Calculate posts for this task
      const postsForTask = Math.min(target.maxPostsPerRun, remainingBudget);

      if (postsForTask < 10) continue; // Minimum viable task

      // Add to plan
      batch.tasks.push({
        targetId: target._id.toString(),
        kind: this.mapTargetTypeToKind(target.type),
        query: target.query,
        estimatedPosts: postsForTask,
        priority: this.calculateEffectivePriority(target),
      });

      batch.totalPlannedPosts += postsForTask;
      remainingBudget -= postsForTask;
    }

    return batch;
  }

  /**
   * Commit план в очередь
   */
  async commit(ownerUserId: string, batch: PlannedBatch): Promise<{
    committed: number;
    taskIds: string[];
  }> {
    const taskIds: string[] = [];

    // Reserve quota
    const reserved = await this.quotaService.reserve(ownerUserId, batch.totalPlannedPosts);
    if (!reserved) {
      throw new Error('Failed to reserve quota');
    }

    try {
      for (const task of batch.tasks) {
        // Map numeric priority to enum
        const priorityEnum = task.priority >= 80 ? 'HIGH' : task.priority >= 50 ? 'NORMAL' : 'LOW';
        
        // Create task in queue
        const queueTask = new TwitterTaskModel({
          type: this.kindToTaskType(task.kind),
          payload: {
            query: task.query,
            targetId: task.targetId,
            maxTweets: task.estimatedPosts,
          },
          status: TaskStatus.PENDING,
          priority: priorityEnum,
          priorityValue: task.priority,
          ownerType: 'USER',
          ownerUserId,
          scope: 'USER',  // Important: ensures USER flow in worker
        });

        await queueTask.save();
        taskIds.push(queueTask._id.toString());

        // Mark target as planned
        await UserTwitterParseTargetModel.updateOne(
          { _id: task.targetId },
          { $set: { lastPlannedAt: new Date() } }
        );
      }

      return {
        committed: taskIds.length,
        taskIds,
      };
    } catch (err) {
      // Release quota on failure
      await this.quotaService.release(ownerUserId, batch.totalPlannedPosts);
      throw err;
    }
  }

  /**
   * Preview + Commit в одном вызове
   */
  async planAndCommit(ownerUserId: string): Promise<{
    batch: PlannedBatch;
    committed: number;
    taskIds: string[];
  }> {
    const batch = await this.plan(ownerUserId);
    
    if (batch.tasks.length === 0) {
      return { batch, committed: 0, taskIds: [] };
    }

    const result = await this.commit(ownerUserId, batch);
    return { batch, ...result };
  }

  /**
   * Get IDs of targets that already have pending tasks
   */
  private async getPendingTargetIds(ownerUserId: string): Promise<Set<string>> {
    const pendingTasks = await TwitterTaskModel.find({
      ownerUserId,
      status: { $in: [TaskStatus.PENDING, TaskStatus.RUNNING] },
      'metadata.targetId': { $exists: true },
    }).lean();

    return new Set(pendingTasks.map(t => t.metadata?.targetId).filter(Boolean));
  }

  /**
   * Sort targets by effective priority
   */
  private sortByPriority(targets: IUserTwitterParseTarget[]): IUserTwitterParseTarget[] {
    return [...targets].sort((a, b) => {
      const prioA = this.calculateEffectivePriority(a);
      const prioB = this.calculateEffectivePriority(b);
      
      if (prioB !== prioA) return prioB - prioA;
      
      // Tie-breaker: older first
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  /**
   * Calculate effective priority
   */
  private calculateEffectivePriority(target: IUserTwitterParseTarget): number {
    return target.priority * 20 + TYPE_PRIORITY[target.type];
  }

  /**
   * Map target type to task kind
   */
  private mapTargetTypeToKind(type: TwitterParseTargetType): TwitterTaskKind {
    switch (type) {
      case TwitterParseTargetType.ACCOUNT:
        return TwitterTaskKind.ACCOUNT;
      case TwitterParseTargetType.KEYWORD:
        return TwitterTaskKind.SEARCH;
      default:
        return TwitterTaskKind.SEARCH;
    }
  }

  /**
   * Map kind to TaskType string
   */
  private kindToTaskType(kind: TwitterTaskKind): string {
    switch (kind) {
      case TwitterTaskKind.ACCOUNT:
        return 'ACCOUNT_TWEETS';
      case TwitterTaskKind.SEARCH:
        return 'SEARCH';
      case TwitterTaskKind.THREAD:
        return 'THREAD';
      default:
        return 'SEARCH';
    }
  }
}
