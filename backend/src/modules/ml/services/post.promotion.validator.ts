/**
 * STEP 3.3 — Post-Promotion Validation Service
 * =============================================
 * Background validation of ML model after promotion.
 * Checks invariants every 15 minutes for 24h window.
 */

import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface ValidationCheck {
  name: string;
  passed: boolean;
  state: HealthState;
  message: string;
  value?: number;
  threshold?: number;
}

export interface ValidationResult {
  promotionId: string;
  checkNumber: number;
  timestamp: Date;
  overallHealth: HealthState;
  checks: ValidationCheck[];
  shouldRollback: boolean;
  rollbackReason?: string;
}

export interface PostPromotionStats {
  prePromotion: {
    meanConfidence: number;
    maxConfidence: number;
    buyRate: number;
    sellRate: number;
    avoidRate: number;
  };
  postPromotion: {
    meanConfidence: number;
    maxConfidence: number;
    buyRate: number;
    sellRate: number;
    avoidRate: number;
  };
  deltas: {
    confidenceDelta: number;
    buySellRateDelta: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_VALIDATION_RESULTS = 'mlops_validation_results';
const COLLECTION_DECISIONS = 'fomo_decisions';
const COLLECTION_HEALTH_EVENTS = 'mlops_health_events';

// Thresholds
const CONFIDENCE_INFLATION_THRESHOLD = 0.05; // 5%
const BUY_SELL_RATE_DELTA_THRESHOLD = 0.05; // 5%
const DISAGREEMENT_THRESHOLD = 0.15; // 15%
const CRITICAL_STREAK_FOR_ROLLBACK = 1;
const DEGRADED_STREAK_FOR_ROLLBACK = 3;

// Macro caps by regime
const MACRO_CAPS: Record<string, number> = {
  'PANIC_SELL_OFF': 0.50,
  'FULL_RISK_OFF': 0.50,
  'CAPITAL_EXIT': 0.45,
  'BTC_MAX_PRESSURE': 0.55,
  'BTC_FLIGHT_TO_SAFETY': 0.65,
  'ALT_ROTATION': 0.65,
  'BTC_LEADS_ALT_FOLLOW': 0.70,
  'ALT_SEASON': 0.70,
};

// ═══════════════════════════════════════════════════════════════
// VALIDATION CHECKS
// ═══════════════════════════════════════════════════════════════

/**
 * A. Decision Direction Integrity
 * ML CANNOT change BUY/SELL/AVOID direction
 */
async function checkDecisionDirectionIntegrity(
  promotionId: string,
  promotionTime: Date
): Promise<ValidationCheck> {
  const db = await getDb();
  
  // Find any decision where ML changed direction
  const directionChanges = await db.collection(COLLECTION_DECISIONS).countDocuments({
    timestamp: { $gte: promotionTime },
    'mlAdjustment.directionChanged': true,
  });
  
  if (directionChanges > 0) {
    return {
      name: 'DECISION_DIRECTION_INTEGRITY',
      passed: false,
      state: 'CRITICAL',
      message: `${directionChanges} decisions had direction changed by ML`,
      value: directionChanges,
      threshold: 0,
    };
  }
  
  return {
    name: 'DECISION_DIRECTION_INTEGRITY',
    passed: true,
    state: 'HEALTHY',
    message: 'No direction changes by ML',
    value: 0,
    threshold: 0,
  };
}

/**
 * B. Confidence Envelope Check
 * Confidence cannot exceed pre-promotion baseline or macro cap
 */
async function checkConfidenceEnvelope(
  promotionId: string,
  promotionTime: Date,
  stats: PostPromotionStats
): Promise<ValidationCheck> {
  const db = await getDb();
  
  // Check if confidence increased
  const confidenceInflation = stats.postPromotion.meanConfidence - stats.prePromotion.meanConfidence;
  
  if (confidenceInflation > CONFIDENCE_INFLATION_THRESHOLD) {
    return {
      name: 'CONFIDENCE_ENVELOPE',
      passed: false,
      state: 'CRITICAL',
      message: `Confidence inflated by ${(confidenceInflation * 100).toFixed(1)}%`,
      value: confidenceInflation,
      threshold: CONFIDENCE_INFLATION_THRESHOLD,
    };
  }
  
  // Check max confidence vs macro caps
  const capViolations = await db.collection(COLLECTION_DECISIONS).countDocuments({
    timestamp: { $gte: promotionTime },
    'mlAdjustment.exceededMacroCap': true,
  });
  
  if (capViolations > 0) {
    return {
      name: 'CONFIDENCE_ENVELOPE',
      passed: false,
      state: 'CRITICAL',
      message: `${capViolations} decisions exceeded macro cap`,
      value: capViolations,
      threshold: 0,
    };
  }
  
  return {
    name: 'CONFIDENCE_ENVELOPE',
    passed: true,
    state: 'HEALTHY',
    message: 'Confidence within envelope',
    value: confidenceInflation,
    threshold: CONFIDENCE_INFLATION_THRESHOLD,
  };
}

/**
 * C. BUY/SELL Frequency Stability
 * Delta BUY+SELL rate must be <= +5%
 */
async function checkBuySellStability(
  stats: PostPromotionStats
): Promise<ValidationCheck> {
  const preBuySellRate = stats.prePromotion.buyRate + stats.prePromotion.sellRate;
  const postBuySellRate = stats.postPromotion.buyRate + stats.postPromotion.sellRate;
  const delta = postBuySellRate - preBuySellRate;
  
  if (delta > BUY_SELL_RATE_DELTA_THRESHOLD) {
    return {
      name: 'BUY_SELL_STABILITY',
      passed: false,
      state: 'DEGRADED',
      message: `BUY+SELL rate increased by ${(delta * 100).toFixed(1)}% (possible ML leakage)`,
      value: delta,
      threshold: BUY_SELL_RATE_DELTA_THRESHOLD,
    };
  }
  
  return {
    name: 'BUY_SELL_STABILITY',
    passed: true,
    state: 'HEALTHY',
    message: `BUY+SELL rate delta: ${(delta * 100).toFixed(1)}%`,
    value: delta,
    threshold: BUY_SELL_RATE_DELTA_THRESHOLD,
  };
}

/**
 * D. Macro Priority Enforcement
 * No strong actions or high confidence in extreme regimes
 */
async function checkMacroPriorityEnforcement(
  promotionTime: Date
): Promise<ValidationCheck> {
  const db = await getDb();
  
  const extremeRegimes = ['PANIC_SELL_OFF', 'FULL_RISK_OFF', 'CAPITAL_EXIT'];
  
  // Check for strong actions in extreme regimes
  const strongActionsInExtreme = await db.collection(COLLECTION_DECISIONS).countDocuments({
    timestamp: { $gte: promotionTime },
    regime: { $in: extremeRegimes },
    strength: 'STRONG',
  });
  
  if (strongActionsInExtreme > 0) {
    return {
      name: 'MACRO_PRIORITY_ENFORCEMENT',
      passed: false,
      state: 'CRITICAL',
      message: `${strongActionsInExtreme} STRONG actions in extreme regimes`,
      value: strongActionsInExtreme,
      threshold: 0,
    };
  }
  
  // Check for confidence exceeding macro cap in extreme regimes
  for (const regime of extremeRegimes) {
    const cap = MACRO_CAPS[regime];
    const violations = await db.collection(COLLECTION_DECISIONS).countDocuments({
      timestamp: { $gte: promotionTime },
      regime,
      confidence: { $gt: cap },
    });
    
    if (violations > 0) {
      return {
        name: 'MACRO_PRIORITY_ENFORCEMENT',
        passed: false,
        state: 'CRITICAL',
        message: `${violations} decisions in ${regime} exceeded cap ${cap}`,
        value: violations,
        threshold: 0,
      };
    }
  }
  
  return {
    name: 'MACRO_PRIORITY_ENFORCEMENT',
    passed: true,
    state: 'HEALTHY',
    message: 'Macro priority enforced',
    value: 0,
    threshold: 0,
  };
}

/**
 * E. Disagreement Rate Check
 * Shadow vs Active disagreement must be <= threshold
 */
async function checkDisagreementRate(
  promotionTime: Date
): Promise<ValidationCheck> {
  const db = await getDb();
  
  const totalDecisions = await db.collection(COLLECTION_DECISIONS).countDocuments({
    timestamp: { $gte: promotionTime },
  });
  
  const disagreements = await db.collection(COLLECTION_DECISIONS).countDocuments({
    timestamp: { $gte: promotionTime },
    'shadowComparison.disagreement': true,
  });
  
  const disagreementRate = totalDecisions > 0 ? disagreements / totalDecisions : 0;
  
  if (disagreementRate > DISAGREEMENT_THRESHOLD) {
    return {
      name: 'DISAGREEMENT_RATE',
      passed: false,
      state: 'DEGRADED',
      message: `Disagreement rate ${(disagreementRate * 100).toFixed(1)}% exceeds ${DISAGREEMENT_THRESHOLD * 100}%`,
      value: disagreementRate,
      threshold: DISAGREEMENT_THRESHOLD,
    };
  }
  
  return {
    name: 'DISAGREEMENT_RATE',
    passed: true,
    state: 'HEALTHY',
    message: `Disagreement rate: ${(disagreementRate * 100).toFixed(1)}%`,
    value: disagreementRate,
    threshold: DISAGREEMENT_THRESHOLD,
  };
}

// ═══════════════════════════════════════════════════════════════
// STATS CALCULATION
// ═══════════════════════════════════════════════════════════════

async function calculateStats(
  promotionTime: Date,
  windowHours: number = 24
): Promise<PostPromotionStats> {
  const db = await getDb();
  
  const preStart = new Date(promotionTime.getTime() - windowHours * 60 * 60 * 1000);
  const postEnd = new Date();
  
  // Pre-promotion stats
  const preDecisions = await db.collection(COLLECTION_DECISIONS)
    .find({ timestamp: { $gte: preStart, $lt: promotionTime } })
    .toArray();
  
  // Post-promotion stats
  const postDecisions = await db.collection(COLLECTION_DECISIONS)
    .find({ timestamp: { $gte: promotionTime, $lte: postEnd } })
    .toArray();
  
  const calcStats = (decisions: any[]) => {
    if (decisions.length === 0) {
      return { meanConfidence: 0, maxConfidence: 0, buyRate: 0, sellRate: 0, avoidRate: 0 };
    }
    
    const confidences = decisions.map(d => d.confidence || 0);
    const buys = decisions.filter(d => d.action === 'BUY').length;
    const sells = decisions.filter(d => d.action === 'SELL').length;
    const avoids = decisions.filter(d => d.action === 'AVOID').length;
    const total = decisions.length;
    
    return {
      meanConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
      maxConfidence: Math.max(...confidences),
      buyRate: buys / total,
      sellRate: sells / total,
      avoidRate: avoids / total,
    };
  };
  
  const pre = calcStats(preDecisions);
  const post = calcStats(postDecisions);
  
  return {
    prePromotion: pre,
    postPromotion: post,
    deltas: {
      confidenceDelta: post.meanConfidence - pre.meanConfidence,
      buySellRateDelta: (post.buyRate + post.sellRate) - (pre.buyRate + pre.sellRate),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN VALIDATION RUNNER
// ═══════════════════════════════════════════════════════════════

export async function runValidationCheck(promotionId: string): Promise<ValidationResult> {
  const db = await getDb();
  
  // Get promotion info
  const promotionState = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
  const promotionTime = promotionState?.promotedAt || new Date();
  
  // Get previous check number
  const lastCheck = await db.collection(COLLECTION_VALIDATION_RESULTS).findOne(
    { promotionId },
    { sort: { checkNumber: -1 } }
  );
  const checkNumber = (lastCheck?.checkNumber || 0) + 1;
  
  // Calculate stats
  const stats = await calculateStats(promotionTime);
  
  // Run all checks
  const checks: ValidationCheck[] = [];
  
  checks.push(await checkDecisionDirectionIntegrity(promotionId, promotionTime));
  checks.push(await checkConfidenceEnvelope(promotionId, promotionTime, stats));
  checks.push(await checkBuySellStability(stats));
  checks.push(await checkMacroPriorityEnforcement(promotionTime));
  checks.push(await checkDisagreementRate(promotionTime));
  
  // Determine overall health
  let overallHealth: HealthState = 'HEALTHY';
  let shouldRollback = false;
  let rollbackReason: string | undefined;
  
  const criticalChecks = checks.filter(c => c.state === 'CRITICAL');
  const degradedChecks = checks.filter(c => c.state === 'DEGRADED');
  
  if (criticalChecks.length > 0) {
    overallHealth = 'CRITICAL';
    shouldRollback = true;
    rollbackReason = `CRITICAL: ${criticalChecks.map(c => c.name).join(', ')}`;
  } else if (degradedChecks.length > 0) {
    overallHealth = 'DEGRADED';
    
    // Check degraded streak
    const recentDegraded = await db.collection(COLLECTION_VALIDATION_RESULTS).countDocuments({
      promotionId,
      overallHealth: 'DEGRADED',
      timestamp: { $gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
    });
    
    if (recentDegraded >= DEGRADED_STREAK_FOR_ROLLBACK - 1) {
      shouldRollback = true;
      rollbackReason = `${DEGRADED_STREAK_FOR_ROLLBACK}x DEGRADED streak`;
    }
  }
  
  // Save result
  const result: ValidationResult = {
    promotionId,
    checkNumber,
    timestamp: new Date(),
    overallHealth,
    checks,
    shouldRollback,
    rollbackReason,
  };
  
  await db.collection(COLLECTION_VALIDATION_RESULTS).insertOne(result);
  
  // Record health event
  await db.collection(COLLECTION_HEALTH_EVENTS).insertOne({
    promotionId,
    state: overallHealth,
    timestamp: new Date(),
    checks: checks.map(c => ({ name: c.name, state: c.state })),
  });
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION STATUS
// ═══════════════════════════════════════════════════════════════

export async function getValidationStatus(promotionId: string): Promise<{
  isRunning: boolean;
  checksCompleted: number;
  windowRemaining: number;
  currentHealth: HealthState;
  shouldRollback: boolean;
  lastCheck: ValidationResult | null;
}> {
  const db = await getDb();
  
  const job = await db.collection('mlops_validation_jobs').findOne({ promotionId });
  const lastCheck = await db.collection(COLLECTION_VALIDATION_RESULTS).findOne(
    { promotionId },
    { sort: { checkNumber: -1 } }
  ) as ValidationResult | null;
  
  const promotionState = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
  const windowEnds = promotionState?.validationWindowEndsAt || new Date();
  const windowRemaining = Math.max(0, windowEnds.getTime() - Date.now()) / (60 * 60 * 1000);
  
  return {
    isRunning: job?.status === 'RUNNING',
    checksCompleted: lastCheck?.checkNumber || 0,
    windowRemaining: Math.round(windowRemaining * 10) / 10,
    currentHealth: lastCheck?.overallHealth || 'HEALTHY',
    shouldRollback: lastCheck?.shouldRollback || false,
    lastCheck,
  };
}
