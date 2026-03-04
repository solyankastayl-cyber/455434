/**
 * P0.4 — DECISION SNAPSHOT SERVICE
 * =================================
 * 
 * Every decision is reproducible.
 * Immutable snapshot saved before final verdict.
 * 
 * Use cases:
 * - Audit trail
 * - Dispute resolution
 * - Replay & debugging
 * 
 * @sealed v1.0
 */

import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// DECISION SNAPSHOT TYPE
// ═══════════════════════════════════════════════════════════════

export interface DecisionSnapshot {
  /** Unique snapshot ID */
  snapshotId: string;
  
  /** Asset symbol */
  asset: string;
  
  /** Decision timestamp */
  timestamp: number;
  
  /** Input verdict */
  input: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    strength: 'STRONG' | 'MODERATE' | 'WEAK';
  };
  
  /** Macro context at decision time */
  macroContext: {
    regime: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    fearGreed: number;
    btcDominance: number;
    stableDominance: number;
    flags: string[];
    confidenceMultiplier: number;
    blockedStrong: boolean;
  };
  
  /** Asset truth (multi-venue) */
  assetTruth?: {
    venueAgreementScore: number;
    venueDispersion: number;
    dominantVenue: string;
    activeVenueCount: number;
  };
  
  /** ML calibration applied */
  mlCalibration?: {
    applied: boolean;
    modelId: string | null;
    mlModifier: number;
    mode: string;
  };
  
  /** Labs signals (READ-ONLY) */
  labsSignals?: {
    supporting: string[];
    opposing: string[];
    ignored: string[];
  };
  
  /** Invariant check result */
  invariantCheck: {
    passed: boolean;
    violations: string[];
    hardViolations: number;
    softViolations: number;
  };
  
  /** Final decision */
  finalDecision: {
    action: 'BUY' | 'SELL' | 'AVOID';
    confidence: number;
    strength: 'STRONG' | 'MODERATE' | 'WEAK';
    downgraded: boolean;
    downgradeReasons: string[];
  };
  
  /** Hash for reproducibility check */
  contextHash: string;
  
  /** Version of decision logic */
  version: string;
}

// ═══════════════════════════════════════════════════════════════
// HASH GENERATION
// ═══════════════════════════════════════════════════════════════

function generateContextHash(snapshot: Partial<DecisionSnapshot>): string {
  const hashInput = JSON.stringify({
    asset: snapshot.asset,
    input: snapshot.input,
    macroContext: snapshot.macroContext,
    assetTruth: snapshot.assetTruth,
    mlCalibration: snapshot.mlCalibration,
    timestamp: Math.floor((snapshot.timestamp || 0) / 60000), // Round to minute
  });
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT SERVICE
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'decision_snapshots';
const VERSION = '1.0.0';

/**
 * Create and store a decision snapshot
 */
export async function createSnapshot(data: {
  asset: string;
  input: DecisionSnapshot['input'];
  macroContext: DecisionSnapshot['macroContext'];
  assetTruth?: DecisionSnapshot['assetTruth'];
  mlCalibration?: DecisionSnapshot['mlCalibration'];
  labsSignals?: DecisionSnapshot['labsSignals'];
  invariantCheck: DecisionSnapshot['invariantCheck'];
  finalDecision: DecisionSnapshot['finalDecision'];
}): Promise<DecisionSnapshot> {
  const now = Date.now();
  
  const snapshot: DecisionSnapshot = {
    snapshotId: `snap_${now}_${Math.random().toString(36).slice(2, 8)}`,
    asset: data.asset,
    timestamp: now,
    input: data.input,
    macroContext: data.macroContext,
    assetTruth: data.assetTruth,
    mlCalibration: data.mlCalibration,
    labsSignals: data.labsSignals,
    invariantCheck: data.invariantCheck,
    finalDecision: data.finalDecision,
    contextHash: '',
    version: VERSION,
  };
  
  // Generate hash
  snapshot.contextHash = generateContextHash(snapshot);
  
  // Store in MongoDB
  try {
    const db = await getDb();
    await db.collection(COLLECTION_NAME).insertOne({
      ...snapshot,
      createdAt: new Date(),
    });
    console.log(`[Snapshot] P0.4: Created snapshot ${snapshot.snapshotId} for ${data.asset}`);
  } catch (error: any) {
    console.error('[Snapshot] Failed to store:', error.message);
  }
  
  return snapshot;
}

/**
 * Get snapshot by ID
 */
export async function getSnapshot(snapshotId: string): Promise<DecisionSnapshot | null> {
  const db = await getDb();
  const doc = await db.collection(COLLECTION_NAME).findOne({ snapshotId });
  
  if (!doc) return null;
  
  const { _id, createdAt, ...snapshot } = doc;
  return snapshot as DecisionSnapshot;
}

/**
 * Get recent snapshots for asset
 */
export async function getRecentSnapshots(
  asset: string,
  limit = 50
): Promise<DecisionSnapshot[]> {
  const db = await getDb();
  const docs = await db.collection(COLLECTION_NAME)
    .find({ asset })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  
  return docs.map(({ _id, createdAt, ...snapshot }) => snapshot as DecisionSnapshot);
}

/**
 * Verify snapshot reproducibility
 */
export async function verifySnapshot(snapshotId: string): Promise<{
  valid: boolean;
  snapshot: DecisionSnapshot | null;
  hashMatch: boolean;
  error?: string;
}> {
  const snapshot = await getSnapshot(snapshotId);
  
  if (!snapshot) {
    return {
      valid: false,
      snapshot: null,
      hashMatch: false,
      error: 'Snapshot not found',
    };
  }
  
  const recomputedHash = generateContextHash(snapshot);
  const hashMatch = recomputedHash === snapshot.contextHash;
  
  return {
    valid: hashMatch,
    snapshot,
    hashMatch,
    error: hashMatch ? undefined : 'Hash mismatch - snapshot may have been modified',
  };
}

/**
 * Get snapshot statistics
 */
export async function getSnapshotStats(hours = 24): Promise<{
  total: number;
  byAsset: Record<string, number>;
  byAction: Record<string, number>;
  downgradeRate: number;
  violationRate: number;
}> {
  const db = await getDb();
  const since = Date.now() - hours * 60 * 60 * 1000;
  
  const docs = await db.collection(COLLECTION_NAME)
    .find({ timestamp: { $gte: since } })
    .toArray();
  
  const byAsset: Record<string, number> = {};
  const byAction: Record<string, number> = { BUY: 0, SELL: 0, AVOID: 0 };
  let downgrades = 0;
  let violations = 0;
  
  for (const doc of docs) {
    const asset = doc.asset || 'UNKNOWN';
    byAsset[asset] = (byAsset[asset] || 0) + 1;
    
    const action = doc.finalDecision?.action || 'AVOID';
    byAction[action] = (byAction[action] || 0) + 1;
    
    if (doc.finalDecision?.downgraded) downgrades++;
    if (doc.invariantCheck?.violations?.length > 0) violations++;
  }
  
  const total = docs.length;
  
  return {
    total,
    byAsset,
    byAction,
    downgradeRate: total > 0 ? downgrades / total : 0,
    violationRate: total > 0 ? violations / total : 0,
  };
}

console.log('[Snapshot] P0.4: Decision Snapshot Service loaded');
