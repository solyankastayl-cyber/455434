/**
 * Watchlist Manager
 * 
 * Manages watchlist subscriptions for addresses
 */

import { Db, ObjectId } from 'mongodb';
import { Watchlist, TriggerType, NotificationChannel } from '../g4.types.js';

export interface CreateWatchlistParams {
  subject: string; // address
  network: string;
  triggers: TriggerType[];
  channels: NotificationChannel[];
  metadata?: Record<string, any>;
}

export class WatchlistManager {
  constructor(private db: Db) {}

  /**
   * Create new watchlist subscription
   */
  async create(params: CreateWatchlistParams): Promise<Watchlist> {
    const now = new Date();

    const watchlist: Watchlist = {
      id: new ObjectId().toString(),
      subject: params.subject.toLowerCase(),
      network: params.network,
      triggers: params.triggers,
      channels: params.channels,
      metadata: params.metadata || {},
      createdAt: now,
      updatedAt: now,
      active: true,
    };

    await this.db.collection('g4_watchlists').insertOne(watchlist);

    return watchlist;
  }

  /**
   * Get watchlist by ID
   */
  async get(id: string): Promise<Watchlist | null> {
    const doc = await this.db.collection('g4_watchlists').findOne({ id });
    return doc as Watchlist | null;
  }

  /**
   * Get all watchlists for a subject
   */
  async getBySubject(network: string, subject: string): Promise<Watchlist[]> {
    const docs = await this.db
      .collection('g4_watchlists')
      .find({
        network,
        subject: subject.toLowerCase(),
        active: true,
      })
      .toArray();

    return docs as Watchlist[];
  }

  /**
   * Get all active watchlists
   */
  async getActive(): Promise<Watchlist[]> {
    const docs = await this.db
      .collection('g4_watchlists')
      .find({ active: true })
      .toArray();

    return docs as Watchlist[];
  }

  /**
   * Update watchlist
   */
  async update(
    id: string,
    updates: Partial<Omit<Watchlist, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    const result = await this.db.collection('g4_watchlists').updateOne(
      { id },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Delete watchlist
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db.collection('g4_watchlists').deleteOne({ id });
    return result.deletedCount > 0;
  }

  /**
   * Deactivate watchlist
   */
  async deactivate(id: string): Promise<boolean> {
    return this.update(id, { active: false });
  }
}
