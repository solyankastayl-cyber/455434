// TwitterAccount Service - v4.0 Parser Control Plane
// CRUD operations for Twitter accounts (NO passwords, NO cookies)

import { Collection, Db, ObjectId } from 'mongodb';
import {
  TwitterAccount,
  TwitterAccountDoc,
  TwitterAccountStatus,
} from '../models/twitterAccount.model.js';
import {
  CreateTwitterAccountDto,
  UpdateTwitterAccountDto,
  TwitterAccountResponseDto,
} from '../dto/twitterAccount.dto.js';

const COLLECTION = 'twitter_accounts';

export class TwitterAccountService {
  private collection: Collection<TwitterAccountDoc>;

  constructor(db: Db) {
    this.collection = db.collection(COLLECTION);
  }

  // Ensure indexes
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ status: 1 });
    await this.collection.createIndex({ createdAt: -1 });
  }

  // Transform doc to response
  private toResponse(doc: TwitterAccountDoc): TwitterAccountResponseDto {
    return {
      _id: doc._id.toString(),
      label: doc.label,
      status: doc.status,
      notes: doc.notes,
      lastLoginAt: doc.lastLoginAt,
      lastError: doc.lastError,
      meta: doc.meta,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  // List all accounts
  async list(filter?: { status?: TwitterAccountStatus }): Promise<TwitterAccountResponseDto[]> {
    const query: any = {};
    if (filter?.status) query.status = filter.status;

    const docs = await this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => this.toResponse(doc));
  }

  // Get by ID
  async getById(id: string): Promise<TwitterAccountResponseDto | null> {
    try {
      const doc = await this.collection.findOne({ _id: new ObjectId(id) });
      if (!doc) return null;
      return this.toResponse(doc);
    } catch {
      return null;
    }
  }

  // Create
  async create(dto: CreateTwitterAccountDto): Promise<TwitterAccountResponseDto> {
    const now = Date.now();
    const doc: Omit<TwitterAccountDoc, '_id'> = {
      label: dto.label,
      status: dto.status || 'ACTIVE',
      notes: dto.notes,
      meta: dto.meta,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(doc as TwitterAccountDoc);
    return this.toResponse({ ...doc, _id: result.insertedId } as TwitterAccountDoc);
  }

  // Update
  async update(id: string, dto: UpdateTwitterAccountDto): Promise<TwitterAccountResponseDto | null> {
    try {
      const updates: any = { updatedAt: Date.now() };
      if (dto.label !== undefined) updates.label = dto.label;
      if (dto.status !== undefined) updates.status = dto.status;
      if (dto.notes !== undefined) updates.notes = dto.notes;
      if (dto.meta !== undefined) updates.meta = dto.meta;

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
  async enable(id: string): Promise<TwitterAccountResponseDto | null> {
    return this.update(id, { status: 'ACTIVE' });
  }

  // Disable
  async disable(id: string): Promise<TwitterAccountResponseDto | null> {
    return this.update(id, { status: 'DISABLED' });
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

  // Count by status
  async countByStatus(): Promise<{ total: number; active: number; disabled: number; locked: number; needsLogin: number }> {
    const pipeline = [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    const counts = {
      total: 0,
      active: 0,
      disabled: 0,
      locked: 0,
      needsLogin: 0,
    };

    for (const r of results) {
      counts.total += r.count;
      switch (r._id) {
        case 'ACTIVE':
          counts.active = r.count;
          break;
        case 'DISABLED':
          counts.disabled = r.count;
          break;
        case 'LOCKED':
          counts.locked = r.count;
          break;
        case 'NEEDS_LOGIN':
          counts.needsLogin = r.count;
          break;
      }
    }

    return counts;
  }

  // Set login timestamp
  async setLastLogin(id: string): Promise<void> {
    try {
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { lastLoginAt: Date.now(), updatedAt: Date.now() } }
      );
    } catch {
      // ignore
    }
  }

  // Set error
  async setError(id: string, code: string, message: string): Promise<void> {
    try {
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            lastError: { code, message, at: Date.now() },
            updatedAt: Date.now(),
          },
        }
      );
    } catch {
      // ignore
    }
  }
}
