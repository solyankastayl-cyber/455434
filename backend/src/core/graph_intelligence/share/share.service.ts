/**
 * P2.4.3: Share Service
 * 
 * Manages shareable graph snapshots.
 * Only calibrated snapshots can be shared.
 */

import { GraphSnapshotModel, getCachedSnapshot } from '../storage/graph_snapshot.model.js';
import { snapshotCache, CALIBRATION_VERSION } from '../cache/snapshot_cache.service.js';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

interface ShareRecord {
  shareId: string;
  snapshotId: string;
  address?: string;
  routeId?: string;
  mode: 'calibrated';
  calibrationVersion: string;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
}

// ============================================
// In-Memory Share Registry
// ============================================

const shareRegistry = new Map<string, ShareRecord>();

// TTL for shared links: 7 days
const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================
// Share Service
// ============================================

class ShareService {
  
  /**
   * Create shareable link for a snapshot
   * 
   * @param snapshotId - ID of the snapshot to share
   * @returns Share record with shareId
   */
  async createShare(snapshotId: string): Promise<ShareRecord | null> {
    // Get snapshot from database
    const snapshot = await GraphSnapshotModel.findOne({ snapshotId });
    
    if (!snapshot) {
      console.log(`[Share] Snapshot not found: ${snapshotId}`);
      return null;
    }
    
    // Verify it's calibrated
    const calibrationMeta = (snapshot as any).calibrationMeta;
    if (!calibrationMeta) {
      console.log(`[Share] Cannot share non-calibrated snapshot: ${snapshotId}`);
      return null;
    }
    
    // Generate share ID (short hash)
    const shareId = this.generateShareId(snapshotId);
    
    // Check if already shared
    const existing = shareRegistry.get(shareId);
    if (existing && existing.expiresAt > Date.now()) {
      existing.accessCount++;
      return existing;
    }
    
    // Create share record
    const shareRecord: ShareRecord = {
      shareId,
      snapshotId,
      address: snapshot.address,
      routeId: snapshot.routeId,
      mode: 'calibrated',
      calibrationVersion: calibrationMeta.version || CALIBRATION_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + SHARE_TTL_MS,
      accessCount: 1,
    };
    
    shareRegistry.set(shareId, shareRecord);
    console.log(`[Share] Created share: ${shareId} for snapshot: ${snapshotId}`);
    
    return shareRecord;
  }
  
  /**
   * Get share record by shareId
   */
  getShare(shareId: string): ShareRecord | null {
    const record = shareRegistry.get(shareId);
    
    if (!record) {
      return null;
    }
    
    // Check expiry
    if (record.expiresAt < Date.now()) {
      shareRegistry.delete(shareId);
      return null;
    }
    
    // Increment access count
    record.accessCount++;
    
    return record;
  }
  
  /**
   * Get snapshot for a shared link
   */
  async getSharedSnapshot(shareId: string): Promise<any | null> {
    const record = this.getShare(shareId);
    
    if (!record) {
      return null;
    }
    
    // Get snapshot from database
    const snapshot = await GraphSnapshotModel.findOne({ 
      snapshotId: record.snapshotId 
    });
    
    return snapshot;
  }
  
  /**
   * Generate short share ID from snapshot ID
   */
  private generateShareId(snapshotId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(snapshotId + CALIBRATION_VERSION)
      .digest('hex');
    
    return `share_${hash.slice(0, 12)}`;
  }
  
  /**
   * Clean expired shares
   */
  cleanExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, record] of shareRegistry.entries()) {
      if (record.expiresAt < now) {
        shareRegistry.delete(id);
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * Get share stats
   */
  getStats(): { total: number; active: number } {
    const now = Date.now();
    let active = 0;
    
    for (const record of shareRegistry.values()) {
      if (record.expiresAt > now) {
        active++;
      }
    }
    
    return {
      total: shareRegistry.size,
      active,
    };
  }
}

// ============================================
// Singleton Export
// ============================================

export const shareService = new ShareService();
