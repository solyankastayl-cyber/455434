/**
 * SNAPSHOT SERVICE
 * ================
 * 
 * Creates and retrieves immutable decision snapshots
 */

import { nanoid } from 'nanoid';
import {
  DecisionSnapshot,
  CreateSnapshotRequest,
  SnapshotResponse,
  SYSTEM_VERSION,
  SNAPSHOT_TTL_DAYS,
} from '../contracts/snapshot.types.js';
import { SnapshotModel } from '../storage/snapshot.model.js';
import { finalDecisionService } from '../../finalDecision/services/finalDecision.service.js';
import { buildDecisionContext } from '../../finalDecision/services/context.builder.js';

class SnapshotService {
  
  /**
   * Create a new snapshot from current system state
   */
  async createSnapshot(req: CreateSnapshotRequest): Promise<SnapshotResponse> {
    try {
      // Get current decision
      const context = await buildDecisionContext(req.symbol);
      const decision = finalDecisionService.decide(context);
      
      // Generate short ID (URL-safe)
      const snapshotId = nanoid(10);
      
      // Calculate expiration
      const expiresAt = Date.now() + (SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000);
      
      // Build snapshot (only safe data)
      const snapshot: DecisionSnapshot = {
        snapshotId,
        symbol: req.symbol,
        timestamp: decision.timestamp,
        
        action: decision.action,
        confidence: decision.confidence,
        
        explainability: {
          verdict: decision.explainability.verdict,
          appliedRules: decision.explainability.appliedRules,
          blockedBy: decision.explainability.blockedBy,
          riskFlags: {
            whaleRisk: decision.explainability.riskFlags?.whaleRisk || 'LOW',
            marketStress: decision.explainability.riskFlags?.marketStress || 'NORMAL',
            contradiction: decision.explainability.riskFlags?.contradiction || false,
            liquidationRisk: decision.explainability.riskFlags?.liquidationRisk || false,
          },
          drivers: this.extractDrivers(decision),
        },
        
        sourceMeta: {
          dataMode: decision.explainability.dataMode,
          providersCount: context.providersUsed?.length || 0,
          mlReady: decision.explainability.mlReady,
          systemVersion: SYSTEM_VERSION,
        },
        
        createdAt: Date.now(),
        expiresAt,
      };
      
      // Save to DB
      await SnapshotModel.create(snapshot);
      
      // Build share URL
      const baseUrl = process.env.REACT_APP_BACKEND_URL || 'https://backtest-replay-lab.preview.emergentagent.com';
      const shareUrl = `${baseUrl}/snapshot/${snapshotId}`;
      
      console.log(`[Snapshot] Created: ${snapshotId} for ${req.symbol}`);
      
      return {
        ok: true,
        snapshot,
        shareUrl,
      };
    } catch (err: any) {
      console.error('[Snapshot] Create failed:', err.message);
      return {
        ok: false,
        error: err.message,
      };
    }
  }
  
  /**
   * Get snapshot by ID (public, no auth)
   */
  async getSnapshot(snapshotId: string): Promise<SnapshotResponse> {
    const snapshot = await SnapshotModel.findOne({ snapshotId }).lean();
    
    if (!snapshot) {
      return { ok: false, error: 'Snapshot not found' };
    }
    
    // Check expiration
    if (snapshot.expiresAt && snapshot.expiresAt < Date.now()) {
      return { ok: false, error: 'Snapshot expired' };
    }
    
    return {
      ok: true,
      snapshot: snapshot as DecisionSnapshot,
    };
  }
  
  /**
   * Get recent snapshots for a symbol
   */
  async getRecentSnapshots(symbol: string, limit = 10): Promise<DecisionSnapshot[]> {
    const snapshots = await SnapshotModel
      .find({ symbol })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return snapshots as DecisionSnapshot[];
  }
  
  /**
   * Get snapshot stats
   */
  async getStats(): Promise<{
    total: number;
    byAction: Record<string, number>;
    recentCount: number;
  }> {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    const [total, recentCount, byAction] = await Promise.all([
      SnapshotModel.countDocuments(),
      SnapshotModel.countDocuments({ createdAt: { $gte: dayAgo } }),
      SnapshotModel.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
      ]),
    ]);
    
    return {
      total,
      recentCount,
      byAction: Object.fromEntries(byAction.map(r => [r._id, r.count])),
    };
  }
  
  /**
   * Extract drivers from decision for snapshot
   */
  private extractDrivers(decision: any): string[] {
    const drivers: string[] = [];
    
    // Add verdict info
    drivers.push(`Verdict: ${decision.explainability.verdict}`);
    
    // Add confidence info
    const confPct = (decision.confidence * 100).toFixed(0);
    drivers.push(`Confidence: ${confPct}%`);
    
    // Add ML info
    if (decision.explainability.mlReady) {
      drivers.push('ML calibration: ACTIVE');
    }
    
    // Add data mode
    drivers.push(`Data source: ${decision.explainability.dataMode}`);
    
    // Add key risk flags
    const rf = decision.explainability.riskFlags || {};
    if (rf.whaleRisk && rf.whaleRisk !== 'LOW') {
      drivers.push(`Whale risk: ${rf.whaleRisk}`);
    }
    if (rf.marketStress && rf.marketStress !== 'NORMAL') {
      drivers.push(`Market stress: ${rf.marketStress}`);
    }
    if (rf.contradiction) {
      drivers.push('Signal contradiction detected');
    }
    
    return drivers;
  }
}

export const snapshotService = new SnapshotService();
