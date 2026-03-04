/**
 * TwitterParseTargetService - управление targets
 * 
 * Все операции user-scoped
 */

import { UserTwitterParseTargetModel, TwitterParseTargetType, type IUserTwitterParseTarget } from '../models/user-twitter-parse-target.model.js';
import { userScope } from '../acl/ownership.js';

/** DTO для создания target */
export interface CreateTargetDTO {
  type: 'KEYWORD' | 'ACCOUNT';
  query: string;
  priority?: number;
  enabled?: boolean;
  maxPostsPerRun?: number;
  cooldownMin?: number;
  filters?: {
    minLikes?: number;
    minReposts?: number;
    timeRange?: '24h' | '48h' | '7d';
  };
  mode?: 'TWEETS' | 'REPLIES' | 'BOTH';
}

/** DTO для обновления target */
export interface UpdateTargetDTO {
  enabled?: boolean;
  priority?: number;
  maxPostsPerRun?: number;
  cooldownMin?: number;
  filters?: {
    minLikes?: number;
    minReposts?: number;
    timeRange?: '24h' | '48h' | '7d';
  };
  mode?: 'TWEETS' | 'REPLIES' | 'BOTH';
}

/** Лимиты */
const MAX_TARGETS_PER_USER = 20;

export class TwitterParseTargetService {
  /**
   * Получить все targets пользователя
   */
  async list(ownerUserId: string): Promise<IUserTwitterParseTarget[]> {
    return UserTwitterParseTargetModel.find(userScope(ownerUserId))
      .sort({ priority: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Получить только активные targets
   */
  async listEnabled(ownerUserId: string): Promise<IUserTwitterParseTarget[]> {
    return UserTwitterParseTargetModel.find({
      ...userScope(ownerUserId),
      enabled: true,
    })
      .sort({ priority: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Получить один target по ID
   */
  async getById(ownerUserId: string, targetId: string): Promise<IUserTwitterParseTarget | null> {
    return UserTwitterParseTargetModel.findOne({
      _id: targetId,
      ...userScope(ownerUserId),
    }).lean();
  }

  /**
   * Создать новый target
   */
  async create(ownerUserId: string, dto: CreateTargetDTO): Promise<IUserTwitterParseTarget> {
    // Validate
    if (!dto.query || dto.query.length < 2) {
      throw new Error('Query must be at least 2 characters');
    }

    // Normalize query
    let query = dto.query.trim();
    if (dto.type === 'ACCOUNT') {
      // Remove @ if present
      query = query.replace(/^@/, '');
    }

    // Check limits
    const count = await UserTwitterParseTargetModel.countDocuments(userScope(ownerUserId));
    if (count >= MAX_TARGETS_PER_USER) {
      throw new Error(`Maximum ${MAX_TARGETS_PER_USER} targets allowed`);
    }

    // Check for duplicate
    const existing = await UserTwitterParseTargetModel.findOne({
      ...userScope(ownerUserId),
      type: dto.type,
      query: query.toLowerCase(),
    });
    if (existing) {
      throw new Error(`Target "${query}" already exists`);
    }

    const target = new UserTwitterParseTargetModel({
      ownerUserId,
      type: dto.type,
      query: query.toLowerCase(),
      enabled: dto.enabled ?? true,
      priority: dto.priority ?? 3,
      maxPostsPerRun: dto.maxPostsPerRun ?? 50,
      cooldownMin: dto.cooldownMin ?? 10,
      filters: dto.type === 'KEYWORD' ? dto.filters : undefined,
      mode: dto.type === 'ACCOUNT' ? (dto.mode || 'TWEETS') : undefined,
      stats: {
        totalRuns: 0,
        totalPostsFetched: 0,
      },
    });

    await target.save();
    return target.toObject();
  }

  /**
   * Обновить target
   */
  async update(
    ownerUserId: string,
    targetId: string,
    dto: UpdateTargetDTO
  ): Promise<IUserTwitterParseTarget | null> {
    const updateFields: Record<string, any> = {};

    if (dto.enabled !== undefined) updateFields.enabled = dto.enabled;
    if (dto.priority !== undefined) updateFields.priority = Math.min(5, Math.max(1, dto.priority));
    if (dto.maxPostsPerRun !== undefined) updateFields.maxPostsPerRun = Math.min(200, Math.max(10, dto.maxPostsPerRun));
    if (dto.cooldownMin !== undefined) updateFields.cooldownMin = Math.min(60, Math.max(5, dto.cooldownMin));
    if (dto.filters !== undefined) updateFields.filters = dto.filters;
    if (dto.mode !== undefined) updateFields.mode = dto.mode;

    const result = await UserTwitterParseTargetModel.findOneAndUpdate(
      {
        _id: targetId,
        ...userScope(ownerUserId),
      },
      { $set: updateFields },
      { new: true }
    ).lean();

    return result;
  }

  /**
   * Удалить target
   */
  async delete(ownerUserId: string, targetId: string): Promise<boolean> {
    const result = await UserTwitterParseTargetModel.deleteOne({
      _id: targetId,
      ...userScope(ownerUserId),
    });

    return result.deletedCount > 0;
  }

  /**
   * Toggle enabled status
   */
  async toggle(ownerUserId: string, targetId: string): Promise<IUserTwitterParseTarget | null> {
    const target = await UserTwitterParseTargetModel.findOne({
      _id: targetId,
      ...userScope(ownerUserId),
    });

    if (!target) return null;

    target.enabled = !target.enabled;
    await target.save();

    return target.toObject();
  }

  /**
   * Получить статистику targets
   */
  async getStats(ownerUserId: string): Promise<{
    total: number;
    enabled: number;
    keywords: number;
    accounts: number;
  }> {
    const targets = await UserTwitterParseTargetModel.find(userScope(ownerUserId)).lean();

    return {
      total: targets.length,
      enabled: targets.filter(t => t.enabled).length,
      keywords: targets.filter(t => t.type === TwitterParseTargetType.KEYWORD).length,
      accounts: targets.filter(t => t.type === TwitterParseTargetType.ACCOUNT).length,
    };
  }

  /**
   * Обновить lastPlannedAt (для scheduler)
   */
  async markPlanned(targetId: string): Promise<void> {
    await UserTwitterParseTargetModel.updateOne(
      { _id: targetId },
      { $set: { lastPlannedAt: new Date() } }
    );
  }

  /**
   * Обновить статистику после run
   */
  async recordRun(targetId: string, postsFetched: number, error?: string): Promise<void> {
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
  }
}
