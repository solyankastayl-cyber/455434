// TwitterEgressSlot Service - v4.0 Parser Control Plane
// CRUD operations for Egress Slots (PROXY or REMOTE_WORKER)

import { Collection, Db, ObjectId } from 'mongodb';
import {
  TwitterEgressSlot,
  TwitterEgressSlotDoc,
  EgressSlotType,
  EgressSlotHealthStatus,
  DEFAULT_SLOT_LIMITS,
  DEFAULT_SLOT_USAGE,
  DEFAULT_SLOT_HEALTH,
} from '../models/twitterEgressSlot.model.js';
import {
  CreateTwitterEgressSlotDto,
  UpdateTwitterEgressSlotDto,
  TwitterEgressSlotResponseDto,
} from '../dto/twitterEgressSlot.dto.js';
import { TwitterAccountService } from './twitterAccount.service.js';

const COLLECTION = 'twitter_egress_slots';

export class TwitterEgressSlotService {
  private collection: Collection<TwitterEgressSlotDoc>;
  private accountService: TwitterAccountService;

  constructor(db: Db, accountService: TwitterAccountService) {
    this.collection = db.collection(COLLECTION);
    this.accountService = accountService;
  }

  // Ensure indexes
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ enabled: 1 });
    await this.collection.createIndex({ accountId: 1 });
    await this.collection.createIndex({ 'health.status': 1 });
    await this.collection.createIndex({ 'usage.windowStartAt': 1 });
  }

  // Transform doc to response (with account label)
  private async toResponse(doc: TwitterEgressSlotDoc): Promise<TwitterEgressSlotResponseDto> {
    let accountLabel: string | undefined;
    if (doc.accountId) {
      const account = await this.accountService.getById(doc.accountId.toString());
      accountLabel = account?.label;
    }

    return {
      _id: doc._id.toString(),
      label: doc.label,
      type: doc.type,
      enabled: doc.enabled,
      accountId: doc.accountId?.toString(),
      accountLabel,
      proxy: doc.proxy,
      worker: doc.worker,
      limits: doc.limits,
      usage: doc.usage,
      health: doc.health,
      cooldownUntil: doc.cooldownUntil,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  // List all slots
  async list(filter?: { enabled?: boolean; type?: EgressSlotType }): Promise<TwitterEgressSlotResponseDto[]> {
    const query: any = {};
    if (filter?.enabled !== undefined) query.enabled = filter.enabled;
    if (filter?.type) query.type = filter.type;

    const docs = await this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return Promise.all(docs.map((doc) => this.toResponse(doc)));
  }

  // Get by ID
  async getById(id: string): Promise<TwitterEgressSlotResponseDto | null> {
    try {
      const doc = await this.collection.findOne({ _id: new ObjectId(id) });
      if (!doc) return null;
      return this.toResponse(doc);
    } catch {
      return null;
    }
  }

  // Create
  async create(dto: CreateTwitterEgressSlotDto): Promise<TwitterEgressSlotResponseDto> {
    const now = Date.now();
    const doc: Omit<TwitterEgressSlotDoc, '_id'> = {
      label: dto.label,
      type: dto.type,
      enabled: dto.enabled ?? true,
      accountId: dto.accountId ? new ObjectId(dto.accountId) : undefined,
      proxy: dto.type === 'PROXY' ? dto.proxy : undefined,
      worker: dto.type === 'REMOTE_WORKER' ? dto.worker : undefined,
      limits: {
        ...DEFAULT_SLOT_LIMITS,
        ...dto.limits,
      },
      usage: { ...DEFAULT_SLOT_USAGE },
      health: { ...DEFAULT_SLOT_HEALTH },
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(doc as TwitterEgressSlotDoc);
    return this.toResponse({ ...doc, _id: result.insertedId } as TwitterEgressSlotDoc);
  }

  // Update
  async update(id: string, dto: UpdateTwitterEgressSlotDto): Promise<TwitterEgressSlotResponseDto | null> {
    try {
      const updates: any = { updatedAt: Date.now() };
      if (dto.label !== undefined) updates.label = dto.label;
      if (dto.type !== undefined) updates.type = dto.type;
      if (dto.enabled !== undefined) updates.enabled = dto.enabled;
      if (dto.proxy !== undefined) updates.proxy = dto.proxy;
      if (dto.worker !== undefined) updates.worker = dto.worker;
      if (dto.limits !== undefined) {
        // Merge limits
        const current = await this.collection.findOne({ _id: new ObjectId(id) });
        if (current) {
          updates.limits = { ...current.limits, ...dto.limits };
        }
      }

      const result = await this.collection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updates },
        { returnDocument: 'after' }
      );

      if (!result) return null;
      return this.toResponse(result);
    } catch {
      return null;
    }
  }

  // Enable
  async enable(id: string): Promise<TwitterEgressSlotResponseDto | null> {
    return this.update(id, { enabled: true });
  }

  // Disable
  async disable(id: string): Promise<TwitterEgressSlotResponseDto | null> {
    return this.update(id, { enabled: false });
  }

  // Bind account
  async bindAccount(slotId: string, accountId: string): Promise<TwitterEgressSlotResponseDto | null> {
    try {
      // Check account exists
      const account = await this.accountService.getById(accountId);
      if (!account) return null;

      const result = await this.collection.findOneAndUpdate(
        { _id: new ObjectId(slotId) },
        { $set: { accountId: new ObjectId(accountId), updatedAt: Date.now() } },
        { returnDocument: 'after' }
      );

      if (!result) return null;
      return this.toResponse(result);
    } catch {
      return null;
    }
  }

  // Unbind account
  async unbindAccount(slotId: string): Promise<TwitterEgressSlotResponseDto | null> {
    try {
      const result = await this.collection.findOneAndUpdate(
        { _id: new ObjectId(slotId) },
        { $unset: { accountId: '' }, $set: { updatedAt: Date.now() } },
        { returnDocument: 'after' }
      );

      if (!result) return null;
      return this.toResponse(result);
    } catch {
      return null;
    }
  }

  // Delete
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
      return result.deletedCount > 0;
    } catch {
      return false;
    }
  }

  // Get stats for monitor
  async getStats(): Promise<{
    totalSlots: number;
    enabledSlots: number;
    healthySlots: number;
    degradedSlots: number;
    errorSlots: number;
    totalCapacityPerHour: number;
    usedThisHour: number;
  }> {
    const pipeline = [
      {
        $facet: {
          byEnabled: [{ $group: { _id: '$enabled', count: { $sum: 1 } } }],
          byHealth: [{ $match: { enabled: true } }, { $group: { _id: '$health.status', count: { $sum: 1 } } }],
          capacity: [
            { $match: { enabled: true } },
            {
              $group: {
                _id: null,
                totalCapacity: { $sum: '$limits.requestsPerHour' },
                usedThisHour: { $sum: '$usage.usedInWindow' },
              },
            },
          ],
        },
      },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    const data = results[0];

    let totalSlots = 0;
    let enabledSlots = 0;
    for (const r of data.byEnabled || []) {
      totalSlots += r.count;
      if (r._id === true) enabledSlots = r.count;
    }

    let healthySlots = 0;
    let degradedSlots = 0;
    let errorSlots = 0;
    for (const r of data.byHealth || []) {
      switch (r._id) {
        case 'HEALTHY':
          healthySlots = r.count;
          break;
        case 'DEGRADED':
          degradedSlots = r.count;
          break;
        case 'ERROR':
          errorSlots = r.count;
          break;
      }
    }

    const capacityData = data.capacity?.[0] || { totalCapacity: 0, usedThisHour: 0 };

    return {
      totalSlots,
      enabledSlots,
      healthySlots,
      degradedSlots,
      errorSlots,
      totalCapacityPerHour: capacityData.totalCapacity,
      usedThisHour: capacityData.usedThisHour,
    };
  }

  // Update health
  async setHealth(id: string, status: EgressSlotHealthStatus, error?: string): Promise<void> {
    try {
      const updates: any = {
        'health.status': status,
        'health.lastCheckAt': Date.now(),
        updatedAt: Date.now(),
      };
      if (error) {
        updates['health.lastError'] = error;
      }

      await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    } catch {
      // ignore
    }
  }

  // Increment usage
  async incrementUsage(id: string): Promise<void> {
    try {
      const now = Date.now();
      const hourStart = Math.floor(now / 3600000) * 3600000;

      // Reset window if new hour
      const doc = await this.collection.findOne({ _id: new ObjectId(id) });
      if (doc && doc.usage.windowStartAt !== hourStart) {
        await this.collection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              'usage.windowStartAt': hourStart,
              'usage.usedInWindow': 1,
              updatedAt: now,
            },
          }
        );
      } else {
        await this.collection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { 'usage.usedInWindow': 1 },
            $set: { updatedAt: now },
          }
        );
      }
    } catch {
      // ignore
    }
  }

  // Set cooldown
  async setCooldown(id: string, durationMs: number): Promise<void> {
    try {
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            cooldownUntil: Date.now() + durationMs,
            updatedAt: Date.now(),
          },
        }
      );
    } catch {
      // ignore
    }
  }

  // Clear cooldown
  async clearCooldown(id: string): Promise<void> {
    try {
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        {
          $unset: { cooldownUntil: '' },
          $set: { updatedAt: Date.now() },
        }
      );
    } catch {
      // ignore
    }
  }

  // Reset usage window (for dev/testing)
  async resetUsageWindow(id: string): Promise<void> {
    try {
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            'usage.windowStartAt': Math.floor(Date.now() / 3600000) * 3600000,
            'usage.usedInWindow': 0,
            updatedAt: Date.now(),
          },
        }
      );
    } catch {
      // ignore
    }
  }
}
