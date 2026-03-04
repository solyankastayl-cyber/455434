/**
 * QA Scenarios Service (P0)
 * 
 * Validation scenarios for:
 * - Simulation Layer robustness
 * - ML Ready v2 checks accuracy
 * - Signal effectiveness verification
 * 
 * Scenarios:
 * - QA-1: Low Variance (constant predictions → should flag FAIL)
 * - QA-2: High Conflict (conflicting signals → should increase NEUTRAL rate)
 * - QA-3: SIM vs LIVE Drift (detect distribution differences)
 * - QA-4: Bucket Imbalance (skewed bucket distribution → should warn)
 */

import { TrainingSampleModel } from '../ml/training_sample.model.js';
import { OutcomeAttributionModel } from '../outcome/outcome_attribution.model.js';
import { ShadowPredictionModel } from '../ml/shadow_ml.models.js';

// ============================================================
// QA SCENARIO TYPES
// ============================================================

export type QAScenarioId = 'QA-1' | 'QA-2' | 'QA-3' | 'QA-4';

export interface QAScenarioResult {
  id: QAScenarioId;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  score: number; // 0-100
  details: string;
  metrics: Record<string, number | string>;
  recommendations: string[];
  runAt: Date;
}

export interface QAReport {
  overall: 'PASS' | 'WARN' | 'FAIL';
  overallScore: number;
  scenarios: QAScenarioResult[];
  summary: string;
  runAt: Date;
  dataSnapshot: {
    totalSamples: number;
    simSamples: number;
    liveSamples: number;
    bucketDistribution: Record<string, number>;
  };
}

// ============================================================
// QA-1: LOW VARIANCE SCENARIO
// ============================================================

/**
 * QA-1: Detects if predictions have abnormally low variance
 * (indicates model collapse or constant output bug)
 * 
 * Checks:
 * - Feature variance across training samples
 * - Outcome label distribution
 * - Prediction output variance (if shadow ML active)
 */
async function runQA1_LowVariance(): Promise<QAScenarioResult> {
  const result: QAScenarioResult = {
    id: 'QA-1',
    name: 'Low Variance Detection',
    status: 'PASS',
    score: 100,
    details: '',
    metrics: {},
    recommendations: [],
    runAt: new Date(),
  };

  try {
    // 1. Get training samples
    const samples = await TrainingSampleModel.find()
      .sort({ timestamp: -1 })
      .limit(500)
      .lean();

    if (samples.length < 50) {
      result.status = 'WARN';
      result.score = 50;
      result.details = 'Insufficient samples for variance analysis';
      result.metrics = { sampleCount: samples.length };
      result.recommendations.push('Generate more training samples via simulation');
      return result;
    }

    // 2. Check confidence variance
    const confidences = samples.map(s => s.features?.confidence || 50);
    const confMean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const confVariance = confidences.reduce((sum, c) => sum + Math.pow(c - confMean, 2), 0) / confidences.length;
    const confStd = Math.sqrt(confVariance);

    // 3. Check risk variance
    const risks = samples.map(s => s.features?.risk || 50);
    const riskMean = risks.reduce((a, b) => a + b, 0) / risks.length;
    const riskVariance = risks.reduce((sum, r) => sum + Math.pow(r - riskMean, 2), 0) / risks.length;
    const riskStd = Math.sqrt(riskVariance);

    // 4. Check outcome label distribution (from training samples)
    const labels = await TrainingSampleModel.aggregate([
      { $group: { _id: '$outcomeLabel', count: { $sum: 1 } } }
    ]);
    const labelMap: Record<string, number> = {};
    labels.forEach(l => { labelMap[l._id] = l.count; });
    const totalLabels = Object.values(labelMap).reduce((a, b) => a + b, 0);

    // 5. Calculate label entropy (higher = better distribution)
    let labelEntropy = 0;
    if (totalLabels > 0) {
      for (const count of Object.values(labelMap)) {
        const p = count / totalLabels;
        if (p > 0) labelEntropy -= p * Math.log2(p);
      }
    }
    const maxEntropy = Math.log2(3); // 3 labels: SUCCESS, FLAT, FAIL
    const normalizedEntropy = labelEntropy / maxEntropy;

    // 6. Check shadow predictions variance (if any)
    let predVariance = 0;
    const predictions = await ShadowPredictionModel.find()
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    if (predictions.length >= 20) {
      const pSuccesses = predictions.map(p => p.pSuccess);
      const pMean = pSuccesses.reduce((a, b) => a + b, 0) / pSuccesses.length;
      predVariance = pSuccesses.reduce((sum, p) => sum + Math.pow(p - pMean, 2), 0) / pSuccesses.length;
    }

    // 7. Evaluate thresholds
    result.metrics = {
      sampleCount: samples.length,
      confidenceStd: Math.round(confStd * 100) / 100,
      riskStd: Math.round(riskStd * 100) / 100,
      labelEntropy: Math.round(normalizedEntropy * 100) / 100,
      predictionVariance: Math.round(predVariance * 1000) / 1000,
      labelDistribution: JSON.stringify(labelMap),
    };

    const issues: string[] = [];

    // Confidence variance too low (< 5 std)
    if (confStd < 5) {
      issues.push(`Confidence variance too low (std=${confStd.toFixed(1)})`);
      result.score -= 25;
    }

    // Risk variance too low (< 5 std)
    if (riskStd < 5) {
      issues.push(`Risk variance too low (std=${riskStd.toFixed(1)})`);
      result.score -= 20;
    }

    // Label entropy too low (< 0.7 of max)
    if (normalizedEntropy < 0.7) {
      issues.push(`Label distribution imbalanced (entropy=${normalizedEntropy.toFixed(2)})`);
      result.score -= 20;
    }

    // Prediction variance too low (< 0.001)
    if (predictions.length >= 20 && predVariance < 0.001) {
      issues.push(`Shadow predictions nearly constant (var=${predVariance.toFixed(4)})`);
      result.score -= 35;
    }

    // Determine final status
    if (result.score >= 80) {
      result.status = 'PASS';
      result.details = 'Feature and outcome variance within acceptable range';
    } else if (result.score >= 50) {
      result.status = 'WARN';
      result.details = issues.join('; ');
      result.recommendations.push('Check simulation parameters for more diversity');
      result.recommendations.push('Verify outcome labeling thresholds');
    } else {
      result.status = 'FAIL';
      result.details = issues.join('; ');
      result.recommendations.push('CRITICAL: Possible model collapse or simulation bug');
      result.recommendations.push('Review simulateOutcome() logic for constant outputs');
    }

  } catch (err: any) {
    result.status = 'FAIL';
    result.score = 0;
    result.details = `Error running QA-1: ${err.message}`;
  }

  return result;
}

// ============================================================
// QA-2: HIGH CONFLICT SCENARIO
// ============================================================

/**
 * QA-2: Validates conflict detection is working properly
 * 
 * Checks:
 * - Conflict rate across attributions
 * - NEUTRAL rate correlation with conflicts
 * - Conflict signal effectiveness
 */
async function runQA2_HighConflict(): Promise<QAScenarioResult> {
  const result: QAScenarioResult = {
    id: 'QA-2',
    name: 'High Conflict Detection',
    status: 'PASS',
    score: 100,
    details: '',
    metrics: {},
    recommendations: [],
    runAt: new Date(),
  };

  try {
    // 1. Get attributions with conflict data
    const attributions = await OutcomeAttributionModel.find({
      'signals.conflict': { $exists: true }
    }).limit(500).lean();

    // 2. Get all training samples for bucket analysis
    const samples = await TrainingSampleModel.find()
      .sort({ timestamp: -1 })
      .limit(500)
      .lean();

    if (samples.length < 50) {
      result.status = 'WARN';
      result.score = 50;
      result.details = 'Insufficient samples for conflict analysis';
      result.metrics = { sampleCount: samples.length };
      return result;
    }

    // 3. Calculate bucket distribution
    const bucketCounts: Record<string, number> = { BUY: 0, WATCH: 0, SELL: 0 };
    samples.forEach(s => {
      bucketCounts[s.bucket] = (bucketCounts[s.bucket] || 0) + 1;
    });
    const totalSamples = samples.length;

    // 4. Calculate conflict metrics from features
    const conflictScores = samples
      .map(s => Math.abs(s.features?.conflict || 0))
      .filter(c => c > 0);
    
    const avgConflict = conflictScores.length > 0
      ? conflictScores.reduce((a, b) => a + b, 0) / conflictScores.length
      : 0;

    const highConflictSamples = samples.filter(s => 
      Math.abs(s.features?.conflict || 0) > 0.4
    );

    // 5. Check WATCH rate for high-conflict samples
    const highConflictWatchRate = highConflictSamples.length > 0
      ? highConflictSamples.filter(s => s.bucket === 'WATCH').length / highConflictSamples.length
      : 0;

    // 6. Overall WATCH rate
    const overallWatchRate = bucketCounts.WATCH / totalSamples;

    // 7. Expected: high conflict → higher WATCH rate
    const conflictEffectiveness = highConflictSamples.length > 10
      ? highConflictWatchRate / (overallWatchRate || 0.33)
      : 1;

    result.metrics = {
      sampleCount: samples.length,
      avgConflictScore: Math.round(avgConflict * 100) / 100,
      highConflictCount: highConflictSamples.length,
      highConflictWatchRate: Math.round(highConflictWatchRate * 100),
      overallWatchRate: Math.round(overallWatchRate * 100),
      conflictEffectiveness: Math.round(conflictEffectiveness * 100) / 100,
      bucketDistribution: JSON.stringify(bucketCounts),
    };

    const issues: string[] = [];

    // Too few conflicts detected
    if (highConflictSamples.length < 10 && samples.length > 100) {
      issues.push('Very few high-conflict samples detected');
      result.score -= 15;
    }

    // Conflict not affecting WATCH rate
    if (highConflictSamples.length > 20 && conflictEffectiveness < 1.2) {
      issues.push(`Conflict not increasing WATCH rate (effectiveness=${conflictEffectiveness.toFixed(2)})`);
      result.score -= 25;
    }

    // WATCH rate too low overall
    if (overallWatchRate < 0.15) {
      issues.push(`WATCH bucket underrepresented (${(overallWatchRate * 100).toFixed(0)}%)`);
      result.score -= 15;
    }

    // WATCH rate too high (system too cautious)
    if (overallWatchRate > 0.7) {
      issues.push(`WATCH bucket overrepresented (${(overallWatchRate * 100).toFixed(0)}%)`);
      result.score -= 20;
    }

    // Determine final status
    if (result.score >= 80) {
      result.status = 'PASS';
      result.details = 'Conflict detection working as expected';
    } else if (result.score >= 50) {
      result.status = 'WARN';
      result.details = issues.join('; ');
      result.recommendations.push('Review conflict thresholds in actorConflict.service.ts');
    } else {
      result.status = 'FAIL';
      result.details = issues.join('; ');
      result.recommendations.push('CRITICAL: Conflict detection may be broken');
      result.recommendations.push('Check calculateConflictImpact() logic');
    }

  } catch (err: any) {
    result.status = 'FAIL';
    result.score = 0;
    result.details = `Error running QA-2: ${err.message}`;
  }

  return result;
}

// ============================================================
// QA-3: SIM VS LIVE DRIFT
// ============================================================

/**
 * QA-3: Detects distribution drift between simulated and live data
 * 
 * Checks:
 * - Feature distribution differences
 * - Outcome distribution differences
 * - Label distribution differences
 */
async function runQA3_SimVsLiveDrift(): Promise<QAScenarioResult> {
  const result: QAScenarioResult = {
    id: 'QA-3',
    name: 'SIM vs LIVE Drift',
    status: 'PASS',
    score: 100,
    details: '',
    metrics: {},
    recommendations: [],
    runAt: new Date(),
  };

  try {
    // 1. Get SIM and LIVE samples
    const simSamples = await TrainingSampleModel.find({ source: 'simulated' })
      .limit(500).lean();
    const liveSamples = await TrainingSampleModel.find({ source: 'live' })
      .limit(500).lean();

    result.metrics = {
      simCount: simSamples.length,
      liveCount: liveSamples.length,
    };

    // 2. If no LIVE data, this is expected but should be noted
    if (liveSamples.length === 0) {
      result.status = 'WARN';
      result.score = 70;
      result.details = 'No LIVE data available for comparison (expected in early stage)';
      result.recommendations.push('Enable LIVE data ingestion to validate simulation');
      return result;
    }

    // 3. If very few LIVE samples, not enough for statistical comparison
    if (liveSamples.length < 30) {
      result.status = 'WARN';
      result.score = 75;
      result.details = `Only ${liveSamples.length} LIVE samples (need 30+ for reliable comparison)`;
      result.recommendations.push('Continue collecting LIVE data');
      return result;
    }

    // 4. Compare feature distributions
    const compareFeature = (sim: number[], live: number[], name: string) => {
      if (sim.length === 0 || live.length === 0) return { drift: 0, simMean: 0, liveMean: 0 };
      const simMean = sim.reduce((a, b) => a + b, 0) / sim.length;
      const liveMean = live.reduce((a, b) => a + b, 0) / live.length;
      const simStd = Math.sqrt(sim.reduce((s, v) => s + Math.pow(v - simMean, 2), 0) / sim.length);
      const drift = simStd > 0 ? Math.abs(simMean - liveMean) / simStd : 0;
      return { drift, simMean, liveMean };
    };

    const confDrift = compareFeature(
      simSamples.map(s => s.features?.confidence || 50),
      liveSamples.map(s => s.features?.confidence || 50),
      'confidence'
    );

    const riskDrift = compareFeature(
      simSamples.map(s => s.features?.risk || 50),
      liveSamples.map(s => s.features?.risk || 50),
      'risk'
    );

    // 5. Compare label distributions
    const simLabels: Record<string, number> = { SUCCESS: 0, FLAT: 0, FAIL: 0 };
    const liveLabels: Record<string, number> = { SUCCESS: 0, FLAT: 0, FAIL: 0 };

    simSamples.forEach(s => { simLabels[s.outcomeLabel] = (simLabels[s.outcomeLabel] || 0) + 1; });
    liveSamples.forEach(s => { liveLabels[s.outcomeLabel] = (liveLabels[s.outcomeLabel] || 0) + 1; });

    // Calculate label drift (KL-divergence approximation)
    let labelDrift = 0;
    for (const label of ['SUCCESS', 'FLAT', 'FAIL']) {
      const simP = simLabels[label] / simSamples.length || 0.001;
      const liveP = liveLabels[label] / liveSamples.length || 0.001;
      labelDrift += Math.abs(simP - liveP);
    }

    result.metrics = {
      ...result.metrics,
      confidenceDrift: Math.round(confDrift.drift * 100) / 100,
      riskDrift: Math.round(riskDrift.drift * 100) / 100,
      labelDrift: Math.round(labelDrift * 100) / 100,
      simConfMean: Math.round(confDrift.simMean),
      liveConfMean: Math.round(confDrift.liveMean),
      simLabelDist: JSON.stringify(simLabels),
      liveLabelDist: JSON.stringify(liveLabels),
    };

    const issues: string[] = [];

    // Confidence drift > 1.5 std
    if (confDrift.drift > 1.5) {
      issues.push(`High confidence drift (${confDrift.drift.toFixed(2)} std)`);
      result.score -= 25;
    }

    // Risk drift > 1.5 std
    if (riskDrift.drift > 1.5) {
      issues.push(`High risk drift (${riskDrift.drift.toFixed(2)} std)`);
      result.score -= 20;
    }

    // Label drift > 30%
    if (labelDrift > 0.3) {
      issues.push(`Label distribution drift (${(labelDrift * 100).toFixed(0)}%)`);
      result.score -= 30;
    }

    // Determine final status
    if (result.score >= 80) {
      result.status = 'PASS';
      result.details = 'SIM and LIVE distributions are aligned';
    } else if (result.score >= 50) {
      result.status = 'WARN';
      result.details = issues.join('; ');
      result.recommendations.push('Review simulation parameters to match LIVE patterns');
      result.recommendations.push('Consider recalibrating outcome thresholds');
    } else {
      result.status = 'FAIL';
      result.details = issues.join('; ');
      result.recommendations.push('CRITICAL: Simulation data may not represent reality');
      result.recommendations.push('Do NOT trust ML training on current SIM data');
    }

  } catch (err: any) {
    result.status = 'FAIL';
    result.score = 0;
    result.details = `Error running QA-3: ${err.message}`;
  }

  return result;
}

// ============================================================
// QA-4: BUCKET IMBALANCE
// ============================================================

/**
 * QA-4: Detects bucket distribution imbalance
 * 
 * Checks:
 * - BUY/WATCH/SELL ratio
 * - Missing buckets
 * - Extreme skew
 */
async function runQA4_BucketImbalance(): Promise<QAScenarioResult> {
  const result: QAScenarioResult = {
    id: 'QA-4',
    name: 'Bucket Imbalance',
    status: 'PASS',
    score: 100,
    details: '',
    metrics: {},
    recommendations: [],
    runAt: new Date(),
  };

  try {
    // 1. Get bucket distribution from training samples
    const bucketAgg = await TrainingSampleModel.aggregate([
      { $group: { _id: '$bucket', count: { $sum: 1 } } }
    ]);

    const buckets: Record<string, number> = { BUY: 0, WATCH: 0, SELL: 0 };
    bucketAgg.forEach(b => { buckets[b._id] = b.count; });

    const total = buckets.BUY + buckets.WATCH + buckets.SELL;

    if (total < 50) {
      result.status = 'WARN';
      result.score = 50;
      result.details = 'Insufficient samples for bucket analysis';
      result.metrics = { totalSamples: total };
      return result;
    }

    // 2. Calculate ratios
    const buyRatio = buckets.BUY / total;
    const watchRatio = buckets.WATCH / total;
    const sellRatio = buckets.SELL / total;

    // 3. Calculate imbalance score (ideal is ~equal, but slight skew is OK)
    // Using Gini coefficient approximation
    const ratios = [buyRatio, watchRatio, sellRatio].sort((a, b) => a - b);
    const n = ratios.length;
    let gini = 0;
    for (let i = 0; i < n; i++) {
      gini += (2 * (i + 1) - n - 1) * ratios[i];
    }
    gini = gini / (n * ratios.reduce((a, b) => a + b, 0));

    result.metrics = {
      totalSamples: total,
      buyCount: buckets.BUY,
      watchCount: buckets.WATCH,
      sellCount: buckets.SELL,
      buyRatio: Math.round(buyRatio * 100),
      watchRatio: Math.round(watchRatio * 100),
      sellRatio: Math.round(sellRatio * 100),
      imbalanceScore: Math.round(gini * 100) / 100,
    };

    const issues: string[] = [];

    // Missing BUY bucket (critical for ML training)
    if (buyRatio < 0.05) {
      issues.push(`BUY bucket severely underrepresented (${(buyRatio * 100).toFixed(1)}%)`);
      result.score -= 40;
    } else if (buyRatio < 0.15) {
      issues.push(`BUY bucket underrepresented (${(buyRatio * 100).toFixed(1)}%)`);
      result.score -= 20;
    }

    // Missing SELL bucket
    if (sellRatio < 0.05) {
      issues.push(`SELL bucket severely underrepresented (${(sellRatio * 100).toFixed(1)}%)`);
      result.score -= 30;
    } else if (sellRatio < 0.15) {
      issues.push(`SELL bucket underrepresented (${(sellRatio * 100).toFixed(1)}%)`);
      result.score -= 15;
    }

    // WATCH dominating (> 70%)
    if (watchRatio > 0.7) {
      issues.push(`WATCH bucket dominates (${(watchRatio * 100).toFixed(1)}%) - system too cautious`);
      result.score -= 25;
    }

    // High imbalance (Gini > 0.3)
    if (gini > 0.3) {
      issues.push(`High bucket imbalance (Gini=${gini.toFixed(2)})`);
      result.score -= 15;
    }

    // Determine final status
    if (result.score >= 80) {
      result.status = 'PASS';
      result.details = 'Bucket distribution is balanced';
    } else if (result.score >= 50) {
      result.status = 'WARN';
      result.details = issues.join('; ');
      result.recommendations.push('Adjust simulation to generate more diverse buckets');
      result.recommendations.push('Check ranking thresholds if WATCH is too dominant');
    } else {
      result.status = 'FAIL';
      result.details = issues.join('; ');
      result.recommendations.push('CRITICAL: ML model will be biased without balanced buckets');
      result.recommendations.push('Must fix BUY bucket representation before ML training');
    }

  } catch (err: any) {
    result.status = 'FAIL';
    result.score = 0;
    result.details = `Error running QA-4: ${err.message}`;
  }

  return result;
}

// ============================================================
// MAIN QA RUNNER
// ============================================================

/**
 * Run all QA scenarios
 */
export async function runAllQAScenarios(): Promise<QAReport> {
  console.log('[QA] Running all QA scenarios...');
  const startTime = Date.now();

  // Run all scenarios
  const [qa1, qa2, qa3, qa4] = await Promise.all([
    runQA1_LowVariance(),
    runQA2_HighConflict(),
    runQA3_SimVsLiveDrift(),
    runQA4_BucketImbalance(),
  ]);

  const scenarios = [qa1, qa2, qa3, qa4];

  // Calculate overall score
  const overallScore = Math.round(
    scenarios.reduce((sum, s) => sum + s.score, 0) / scenarios.length
  );

  // Determine overall status
  let overall: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  const failCount = scenarios.filter(s => s.status === 'FAIL').length;
  const warnCount = scenarios.filter(s => s.status === 'WARN').length;

  if (failCount > 0) {
    overall = 'FAIL';
  } else if (warnCount >= 2 || overallScore < 70) {
    overall = 'WARN';
  }

  // Get data snapshot
  const [totalSamples, simCount, liveCount] = await Promise.all([
    TrainingSampleModel.countDocuments(),
    TrainingSampleModel.countDocuments({ source: 'simulated' }),
    TrainingSampleModel.countDocuments({ source: 'live' }),
  ]);

  const bucketAgg = await TrainingSampleModel.aggregate([
    { $group: { _id: '$bucket', count: { $sum: 1 } } }
  ]);
  const bucketDistribution: Record<string, number> = {};
  bucketAgg.forEach(b => { bucketDistribution[b._id] = b.count; });

  // Generate summary
  const summaryParts: string[] = [];
  if (overall === 'PASS') {
    summaryParts.push('All QA checks passed.');
  } else if (overall === 'WARN') {
    summaryParts.push(`${warnCount} warning(s) detected.`);
    scenarios.filter(s => s.status === 'WARN').forEach(s => {
      summaryParts.push(`• ${s.name}: ${s.details}`);
    });
  } else {
    summaryParts.push(`${failCount} critical issue(s) detected.`);
    scenarios.filter(s => s.status === 'FAIL').forEach(s => {
      summaryParts.push(`• ${s.name}: ${s.details}`);
    });
  }

  const duration = Date.now() - startTime;
  console.log(`[QA] Completed in ${duration}ms. Overall: ${overall} (${overallScore}%)`);

  return {
    overall,
    overallScore,
    scenarios,
    summary: summaryParts.join('\n'),
    runAt: new Date(),
    dataSnapshot: {
      totalSamples,
      simSamples: simCount,
      liveSamples: liveCount,
      bucketDistribution,
    },
  };
}

/**
 * Run a single QA scenario by ID
 */
export async function runQAScenario(id: QAScenarioId): Promise<QAScenarioResult> {
  switch (id) {
    case 'QA-1': return runQA1_LowVariance();
    case 'QA-2': return runQA2_HighConflict();
    case 'QA-3': return runQA3_SimVsLiveDrift();
    case 'QA-4': return runQA4_BucketImbalance();
    default:
      throw new Error(`Unknown QA scenario: ${id}`);
  }
}
