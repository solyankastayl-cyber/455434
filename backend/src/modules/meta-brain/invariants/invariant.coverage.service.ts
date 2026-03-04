/**
 * P1.5 — INVARIANT COVERAGE SERVICE
 * ==================================
 * 
 * Tracks which invariants have been triggered.
 * 
 * Coverage Report:
 * - Which invariants fired (hard/soft violations)
 * - Which invariants never triggered
 * - Recommendations for cleanup
 */

import { getDb } from '../../../db/mongodb.js';
import { InvariantLevel } from './invariants.types.js';
import { META_BRAIN_INVARIANTS, getInvariantCount } from './invariant.registry.js';

const COLLECTION_NAME = 'invariant_coverage';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface InvariantCoverageEntry {
  invariantId: string;
  level: InvariantLevel;
  triggerCount: number;
  lastTriggeredAt: number | null;
  passCount: number;
  lastPassedAt: number | null;
}

export interface CoverageReport {
  timestamp: number;
  totalInvariants: number;
  hardCount: number;
  softCount: number;
  triggered: {
    id: string;
    level: string;
    count: number;
    lastTriggered: string | null;
  }[];
  neverTriggered: {
    id: string;
    level: string;
    description: string;
    recommendation: 'KEEP' | 'REVIEW' | 'DOWNGRADE_TO_SOFT' | 'REMOVE';
  }[];
  coverage: {
    percent: number;
    triggered: number;
    total: number;
  };
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════
// COVERAGE TRACKING
// ═══════════════════════════════════════════════════════════════

/**
 * Record invariant trigger (violation)
 */
export async function recordInvariantTrigger(
  invariantId: string,
  level: InvariantLevel
): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    
    await db.collection(COLLECTION_NAME).updateOne(
      { invariantId },
      {
        $set: {
          level,
          lastTriggeredAt: now,
        },
        $inc: { triggerCount: 1 },
        $setOnInsert: {
          invariantId,
          passCount: 0,
          lastPassedAt: null,
          createdAt: now,
        },
      },
      { upsert: true }
    );
  } catch (error: any) {
    console.warn('[Coverage] Failed to record trigger:', error.message);
  }
}

/**
 * Record invariant pass (no violation)
 */
export async function recordInvariantPass(invariantId: string): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    
    await db.collection(COLLECTION_NAME).updateOne(
      { invariantId },
      {
        $set: { lastPassedAt: now },
        $inc: { passCount: 1 },
        $setOnInsert: {
          invariantId,
          triggerCount: 0,
          lastTriggeredAt: null,
          createdAt: now,
        },
      },
      { upsert: true }
    );
  } catch (error: any) {
    console.warn('[Coverage] Failed to record pass:', error.message);
  }
}

/**
 * Get coverage data from DB
 */
async function getCoverageData(): Promise<Map<string, InvariantCoverageEntry>> {
  const db = await getDb();
  const docs = await db.collection(COLLECTION_NAME).find({}).toArray();
  
  const map = new Map<string, InvariantCoverageEntry>();
  for (const doc of docs) {
    map.set(doc.invariantId, {
      invariantId: doc.invariantId,
      level: doc.level,
      triggerCount: doc.triggerCount || 0,
      lastTriggeredAt: doc.lastTriggeredAt,
      passCount: doc.passCount || 0,
      lastPassedAt: doc.lastPassedAt,
    });
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// COVERAGE REPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Generate full coverage report
 */
export async function generateCoverageReport(): Promise<CoverageReport> {
  const coverageData = await getCoverageData();
  const stats = getInvariantCount();
  
  const triggered: CoverageReport['triggered'] = [];
  const neverTriggered: CoverageReport['neverTriggered'] = [];
  const recommendations: string[] = [];
  
  for (const inv of META_BRAIN_INVARIANTS) {
    const entry = coverageData.get(inv.id);
    
    if (entry && entry.triggerCount > 0) {
      triggered.push({
        id: inv.id,
        level: inv.level,
        count: entry.triggerCount,
        lastTriggered: entry.lastTriggeredAt 
          ? new Date(entry.lastTriggeredAt).toISOString()
          : null,
      });
    } else {
      // Never triggered - generate recommendation
      let recommendation: 'KEEP' | 'REVIEW' | 'DOWNGRADE_TO_SOFT' | 'REMOVE' = 'KEEP';
      
      // Critical invariants should be kept even if never triggered
      const criticalInvariants = [
        'LABS_READ_ONLY',
        'FINAL_CONFIDENCE_NEVER_EXCEEDS_BASE',
        'MACRO_RISK_OFF_BLOCKS_ACTION',
        'ML_CANNOT_BYPASS_MACRO_BLOCKS',
      ];
      
      if (criticalInvariants.includes(inv.id)) {
        recommendation = 'KEEP';
      } else if (inv.level === InvariantLevel.HARD) {
        // Hard invariants that never trigger might need review
        recommendation = 'REVIEW';
        recommendations.push(
          `REVIEW: ${inv.id} is HARD but never triggered. Verify it's testable.`
        );
      } else {
        recommendation = 'REVIEW';
      }
      
      neverTriggered.push({
        id: inv.id,
        level: inv.level,
        description: inv.description,
        recommendation,
      });
    }
  }
  
  const totalInvariants = META_BRAIN_INVARIANTS.length;
  const triggeredCount = triggered.length;
  const coveragePercent = totalInvariants > 0 
    ? Math.round((triggeredCount / totalInvariants) * 100)
    : 0;
  
  // Add summary recommendations
  if (coveragePercent < 50) {
    recommendations.push(
      `WARNING: Only ${coveragePercent}% of invariants have been triggered. Consider stress testing.`
    );
  }
  
  if (neverTriggered.filter(n => n.recommendation === 'REVIEW').length > 3) {
    recommendations.push(
      `NOTE: ${neverTriggered.filter(n => n.recommendation === 'REVIEW').length} invariants need review.`
    );
  }
  
  return {
    timestamp: Date.now(),
    totalInvariants,
    hardCount: stats.hard,
    softCount: stats.soft,
    triggered,
    neverTriggered,
    coverage: {
      percent: coveragePercent,
      triggered: triggeredCount,
      total: totalInvariants,
    },
    recommendations,
  };
}

/**
 * Reset coverage data (for testing)
 */
export async function resetCoverageData(): Promise<void> {
  const db = await getDb();
  await db.collection(COLLECTION_NAME).deleteMany({});
}

console.log('[Coverage] P1.5: Invariant Coverage Service loaded');
