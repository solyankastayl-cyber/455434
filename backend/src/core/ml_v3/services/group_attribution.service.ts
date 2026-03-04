/**
 * P1.2 - Group Attribution Service
 * 
 * Calculates the contribution of each feature group to model performance
 * by analyzing ablation matrix results.
 * 
 * Formula: groupImpact = metric(base) - metric(minus_group)
 */
import { MlGroupAttribution } from '../models/ml_group_attribution.model.js';
import { MlAblationReport } from '../models/ml_ablation_report.model.js';
import { MlTrainingStabilityModel } from '../models/ml_training_stability.model.js';
import type {
  GroupAttribution,
  AttributionResult,
  AttributionRunRequest,
  FeatureGroup,
  GroupVerdict,
} from '../types/group_attribution.types.js';
import {
  VARIANT_TO_GROUP,
  ATTRIBUTION_THRESHOLDS,
} from '../types/group_attribution.types.js';

export class GroupAttributionService {
  /**
   * Calculate group attribution from ablation matrix results
   */
  static async calculate(req: AttributionRunRequest): Promise<AttributionResult> {
    console.log(`[Attribution] Calculating for ${req.network}/${req.task}`);

    // 1. Get ablation reports for the base pack variants
    const reports = await MlAblationReport.find({
      network: req.network,
      task: req.task,
      'modelA.featurePack': 'PACK_A',
      'modelB.featurePack': { $in: Object.keys(VARIANT_TO_GROUP) },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (reports.length === 0) {
      throw new Error('No ablation reports found. Run ablation matrix first.');
    }

    console.log(`[Attribution] Found ${reports.length} ablation reports`);

    // 2. Get stability data for confidence calculation
    const stabilityData = await MlTrainingStabilityModel.find({
      network: req.network,
      task: req.task,
      featurePack: 'PACK_A',
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();

    const baseStability = stabilityData[0];

    // 3. Calculate attribution for each group
    const groups: GroupAttribution[] = [];
    const processedGroups = new Set<string>();

    for (const report of reports) {
      const variantPack = report.modelB.featurePack;
      const group = VARIANT_TO_GROUP[variantPack];

      if (!group || processedGroups.has(group)) continue;
      processedGroups.add(group);

      // Impact = base - variant (positive = group helps)
      const deltaF1 = report.deltas.deltaF1 * -1;  // Flip sign: positive means removing hurts
      const deltaAccuracy = report.deltas.deltaAccuracy * -1;
      const deltaPrecision = (report.metricsA.precision - report.metricsB.precision);
      const deltaRecall = (report.metricsA.recall - report.metricsB.recall);

      // Determine stability
      let stability: 'STABLE' | 'UNSTABLE' | 'UNKNOWN' = 'UNKNOWN';
      if (baseStability) {
        stability = baseStability.verdict === 'STABLE' ? 'STABLE' : 'UNSTABLE';
      }

      // Calculate confidence
      const confidence = this.calculateConfidence(
        report.metricsA.samples,
        baseStability?.stats?.cv?.f1
      );

      // Determine verdict
      const verdict = this.determineVerdict(deltaF1, stability, confidence);

      // Generate reasons
      const reasons = this.generateReasons(group, deltaF1, stability, verdict);

      groups.push({
        group,
        deltaF1,
        deltaAccuracy,
        deltaPrecision,
        deltaRecall,
        stability,
        verdict,
        confidence,
        sampleSize: report.metricsA.samples,
        reasons,
      });

      console.log(`[Attribution] ${group}: ΔF1=${(deltaF1 * 100).toFixed(2)}% → ${verdict}`);
    }

    // Sort by impact (descending)
    groups.sort((a, b) => b.deltaF1 - a.deltaF1);

    // 4. Generate summary
    const summary = this.generateSummary(groups);

    // 5. Save to MongoDB
    const attributionId = `attr_${req.network}_${Date.now()}`;
    const result: AttributionResult = {
      attributionId,
      task: req.task,
      network: req.network,
      matrixId: req.matrixId || reports[0]?.matrixId || 'unknown',
      baseModelId: reports[0]?.modelA?.modelId || 'unknown',
      basePack: 'PACK_A',
      datasetId: reports[0]?.datasetId || 'unknown',
      groups,
      summary,
      createdAt: new Date(),
    };

    await MlGroupAttribution.create(result);
    console.log(`[Attribution] Saved: ${attributionId}`);

    return result;
  }

  /**
   * Calculate confidence score based on sample size and variance
   */
  private static calculateConfidence(sampleSize: number, cvF1?: number): number {
    let confidence = 0.5;

    // Sample size factor (more samples = higher confidence)
    if (sampleSize >= 1000) confidence += 0.25;
    else if (sampleSize >= 500) confidence += 0.15;
    else if (sampleSize >= 100) confidence += 0.05;

    // Variance factor (lower CV = higher confidence)
    if (cvF1 !== undefined) {
      if (cvF1 < 0.05) confidence += 0.25;
      else if (cvF1 < 0.1) confidence += 0.15;
      else if (cvF1 < 0.2) confidence += 0.05;
      else confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determine group verdict based on delta and stability
   */
  private static determineVerdict(
    deltaF1: number,
    stability: string,
    confidence: number
  ): GroupVerdict {
    const T = ATTRIBUTION_THRESHOLDS;

    // If unstable, mark as such regardless of delta
    if (stability === 'UNSTABLE' && confidence < T.LOW_CONFIDENCE) {
      return 'UNSTABLE';
    }

    // Determine based on delta
    if (deltaF1 > T.CORE_POSITIVE) return 'CORE_POSITIVE';
    if (deltaF1 > T.WEAK_POSITIVE) return 'WEAK_POSITIVE';
    if (deltaF1 > T.NEUTRAL_LOWER && deltaF1 < T.NEUTRAL_UPPER) return 'NEUTRAL';
    if (deltaF1 < T.NEGATIVE) return 'NEGATIVE';

    return 'NEUTRAL';
  }

  /**
   * Generate human-readable reasons
   */
  private static generateReasons(
    group: FeatureGroup,
    deltaF1: number,
    stability: string,
    verdict: GroupVerdict
  ): string[] {
    const reasons: string[] = [];
    const pct = (deltaF1 * 100).toFixed(1);

    switch (verdict) {
      case 'CORE_POSITIVE':
        reasons.push(`${group} adds +${pct}% F1 - core contributor`);
        reasons.push('Removing this group significantly hurts performance');
        break;
      case 'WEAK_POSITIVE':
        reasons.push(`${group} adds +${pct}% F1 - weak positive`);
        reasons.push('Minor but measurable contribution');
        break;
      case 'NEUTRAL':
        reasons.push(`${group} has minimal impact (${pct}% F1)`);
        reasons.push('Can be removed without significant loss');
        break;
      case 'NEGATIVE':
        reasons.push(`${group} hurts performance (${pct}% F1)`);
        reasons.push('Consider removing from feature pack');
        break;
      case 'UNSTABLE':
        reasons.push(`${group} impact is unstable across seeds`);
        reasons.push('High variance - results not reliable');
        break;
    }

    if (stability === 'STABLE') {
      reasons.push('Results are stable across multiple training runs');
    }

    return reasons;
  }

  /**
   * Generate summary statistics
   */
  private static generateSummary(groups: GroupAttribution[]) {
    const counts = {
      totalGroups: groups.length,
      corePositive: groups.filter(g => g.verdict === 'CORE_POSITIVE').length,
      weakPositive: groups.filter(g => g.verdict === 'WEAK_POSITIVE').length,
      neutral: groups.filter(g => g.verdict === 'NEUTRAL').length,
      negative: groups.filter(g => g.verdict === 'NEGATIVE').length,
      unstable: groups.filter(g => g.verdict === 'UNSTABLE').length,
    };

    // Find top contributor
    const sorted = [...groups].sort((a, b) => b.deltaF1 - a.deltaF1);
    const topContributor = sorted[0]?.group || null;
    const topContribution = sorted[0]?.deltaF1 || 0;

    return {
      ...counts,
      topContributor,
      topContribution,
    };
  }

  /**
   * Get latest attribution result
   */
  static async getLatest(network: string, task: string = 'market'): Promise<AttributionResult | null> {
    const result = await MlGroupAttribution.findOne({ network, task })
      .sort({ createdAt: -1 })
      .lean();

    if (!result) return null;

    return {
      attributionId: result.attributionId,
      task: result.task,
      network: result.network,
      matrixId: result.matrixId,
      baseModelId: result.baseModelId,
      basePack: result.basePack,
      datasetId: result.datasetId,
      groups: result.groups as GroupAttribution[],
      summary: result.summary as AttributionResult['summary'],
      createdAt: result.createdAt,
    };
  }

  /**
   * Get attribution history
   */
  static async getHistory(
    network: string,
    limit: number = 10
  ): Promise<{ results: AttributionResult[]; count: number }> {
    const results = await MlGroupAttribution.find({ network })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const count = await MlGroupAttribution.countDocuments({ network });

    return {
      results: results.map(r => ({
        attributionId: r.attributionId,
        task: r.task,
        network: r.network,
        matrixId: r.matrixId,
        baseModelId: r.baseModelId,
        basePack: r.basePack,
        datasetId: r.datasetId,
        groups: r.groups as GroupAttribution[],
        summary: r.summary as AttributionResult['summary'],
        createdAt: r.createdAt,
      })),
      count,
    };
  }
}

export default GroupAttributionService;
