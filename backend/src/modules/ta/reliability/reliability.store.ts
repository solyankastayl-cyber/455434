/**
 * Phase R9: Reliability Store
 * MongoDB persistence for pattern reliability stats
 */

import { Db } from 'mongodb';
import { ReliabilityKey, ReliabilityStats } from './reliability.types.js';

export class ReliabilityStore {
  private collection = 'ta_pattern_reliability';
  
  constructor(private db: Db) {}
  
  /**
   * Get stats for a specific pattern/timeframe/regime combination
   */
  async getStats(key: ReliabilityKey): Promise<ReliabilityStats | null> {
    const result = await this.db.collection(this.collection).findOne(key);
    if (!result) return null;
    
    const { _id, ...stats } = result;
    return stats as ReliabilityStats;
  }
  
  /**
   * Get stats for multiple keys
   */
  async getBulkStats(keys: ReliabilityKey[]): Promise<Map<string, ReliabilityStats>> {
    const results = new Map<string, ReliabilityStats>();
    
    for (const key of keys) {
      const stats = await this.getStats(key);
      if (stats) {
        results.set(JSON.stringify(key), stats);
      }
    }
    
    return results;
  }
  
  /**
   * Upsert stats for a key
   */
  async upsertStats(key: ReliabilityKey, update: Partial<ReliabilityStats>): Promise<void> {
    await this.db.collection(this.collection).updateOne(
      key,
      { 
        $set: { 
          ...update, 
          updatedAt: Date.now() 
        } 
      },
      { upsert: true }
    );
  }
  
  /**
   * Get all stats
   */
  async getAllStats(): Promise<ReliabilityStats[]> {
    const results = await this.db.collection(this.collection)
      .find({})
      .toArray();
    
    return results.map(r => {
      const { _id, ...stats } = r;
      return stats as ReliabilityStats;
    });
  }
  
  /**
   * Get stats by pattern type
   */
  async getStatsByType(patternType: string): Promise<ReliabilityStats[]> {
    const results = await this.db.collection(this.collection)
      .find({ patternType })
      .toArray();
    
    return results.map(r => {
      const { _id, ...stats } = r;
      return stats as ReliabilityStats;
    });
  }
  
  /**
   * Get top performing patterns
   */
  async getTopPatterns(limit = 20): Promise<ReliabilityStats[]> {
    const results = await this.db.collection(this.collection)
      .find({ n: { $gte: 5 } })
      .sort({ pWinSmoothed: -1 })
      .limit(limit)
      .toArray();
    
    return results.map(r => {
      const { _id, ...stats } = r;
      return stats as ReliabilityStats;
    });
  }
  
  /**
   * Clear all stats (for rebuild)
   */
  async clearAll(): Promise<void> {
    await this.db.collection(this.collection).deleteMany({});
  }
  
  /**
   * Get count of stats entries
   */
  async count(): Promise<number> {
    return this.db.collection(this.collection).countDocuments();
  }
}
