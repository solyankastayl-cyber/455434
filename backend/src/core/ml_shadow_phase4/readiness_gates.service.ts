/**
 * PHASE 4 - БЛОК 4.5: Readiness Gates Service
 * 
 * Hard blockers for Phase 5+ transitions
 * Gates must ALL PASS before ML can influence Engine
 */
import { MLReadinessGateModel, GateType } from './ml_readiness_gate.model.js';
import { MLShadowAlertModel } from './ml_shadow_alert.model.js';
import { MLShadowEvaluationModel } from './ml_shadow_evaluation.model.js';
import { PriceOutcomeModel } from './price_outcome.model.js';
import { shadowMLCronService } from './shadow_ml_cron.service.js';

export class ReadinessGatesService {
  // Gate thresholds
  private static readonly THRESHOLDS = {
    // G1 - DATASET
    MIN_SAMPLES: 300,
    MIN_REAL_LABELS_RATIO: 0.60, // 60%
    
    // G2 - CALIBRATION
    MAX_ECE: 0.10,
    MIN_ROLLING_RUNS: 3,
    
    // G3 - STABILITY
    MIN_AGREEMENT_RATE: 0.40,
    MAX_FLIP_RATE: 0.05,
    
    // G4 - ALERTS
    MAX_CRITICAL_ALERTS: 0,
    MAX_HIGH_ALERTS_HOURS: 24,
    
    // G5 - TEMPORAL
    MIN_OBSERVATION_HOURS: 72, // 3 days
  };

  /**
   * Evaluate all gates
   */
  static async evaluateAllGates(): Promise<void> {
    const now = new Date();

    await this.evaluateDatasetGate(now);
    await this.evaluateCalibrationGate(now);
    await this.evaluateStabilityGate(now);
    await this.evaluateAlertsGate(now);
    await this.evaluateTemporalGate(now);

    console.log('[ReadinessGates] All gates evaluated');
  }

  /**
   * G1 - DATASET: Sufficient samples + real labels
   */
  private static async evaluateDatasetGate(now: Date): Promise<void> {
    // Get recent evaluation
    const evaluation = await MLShadowEvaluationModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec();

    if (!evaluation) {
      await this.updateGate('DATASET', 'FAIL', 'No evaluations yet', {}, now);
      return;
    }

    const sampleCount = evaluation.sampleCount;

    // Get real labels ratio
    const totalOutcomes = await PriceOutcomeModel.countDocuments();
    const withBothLabels = await PriceOutcomeModel.countDocuments({
      'outcome24h.label': { $exists: true },
      'outcome7d.label': { $exists: true },
    });

    const realLabelsRatio = totalOutcomes > 0 ? withBothLabels / totalOutcomes : 0;

    const pass = sampleCount >= this.THRESHOLDS.MIN_SAMPLES &&
                 realLabelsRatio >= this.THRESHOLDS.MIN_REAL_LABELS_RATIO;

    const reason = !pass
      ? `samples=${sampleCount} < ${this.THRESHOLDS.MIN_SAMPLES} OR realLabels=${(realLabelsRatio * 100).toFixed(0)}% < ${(this.THRESHOLDS.MIN_REAL_LABELS_RATIO * 100).toFixed(0)}%`
      : undefined;

    await this.updateGate(
      'DATASET',
      pass ? 'PASS' : 'FAIL',
      reason,
      { sampleCount, realLabelsRatio },
      now
    );
  }

  /**
   * G2 - CALIBRATION: ECE within threshold (rolling 3 runs)
   */
  private static async evaluateCalibrationGate(now: Date): Promise<void> {
    const recentEvals = await MLShadowEvaluationModel
      .find()
      .sort({ createdAt: -1 })
      .limit(this.THRESHOLDS.MIN_ROLLING_RUNS)
      .exec();

    if (recentEvals.length < this.THRESHOLDS.MIN_ROLLING_RUNS) {
      await this.updateGate(
        'CALIBRATION',
        'FAIL',
        `Need ${this.THRESHOLDS.MIN_ROLLING_RUNS} runs, have ${recentEvals.length}`,
        {},
        now
      );
      return;
    }

    const avgECE = recentEvals.reduce((sum, e) => sum + e.ece, 0) / recentEvals.length;
    const pass = avgECE <= this.THRESHOLDS.MAX_ECE;

    const reason = !pass
      ? `avgECE=${avgECE.toFixed(3)} > ${this.THRESHOLDS.MAX_ECE} (rolling ${this.THRESHOLDS.MIN_ROLLING_RUNS} runs)`
      : undefined;

    await this.updateGate(
      'CALIBRATION',
      pass ? 'PASS' : 'FAIL',
      reason,
      { ece: avgECE },
      now
    );
  }

  /**
   * G3 - STABILITY: Agreement + flip rate healthy
   */
  private static async evaluateStabilityGate(now: Date): Promise<void> {
    const evaluation = await MLShadowEvaluationModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec();

    if (!evaluation) {
      await this.updateGate('STABILITY', 'FAIL', 'No evaluations yet', {}, now);
      return;
    }

    const { agreementRate, flipRate } = evaluation;

    const pass = agreementRate >= this.THRESHOLDS.MIN_AGREEMENT_RATE &&
                 flipRate <= this.THRESHOLDS.MAX_FLIP_RATE;

    const reason = !pass
      ? `agreement=${(agreementRate * 100).toFixed(0)}% < ${(this.THRESHOLDS.MIN_AGREEMENT_RATE * 100).toFixed(0)}% OR flipRate=${(flipRate * 100).toFixed(1)}% > ${(this.THRESHOLDS.MAX_FLIP_RATE * 100).toFixed(1)}%`
      : undefined;

    await this.updateGate(
      'STABILITY',
      pass ? 'PASS' : 'FAIL',
      reason,
      { agreementRate, flipRate },
      now
    );
  }

  /**
   * G4 - ALERTS: No critical alerts, no high alerts for >24h
   */
  private static async evaluateAlertsGate(now: Date): Promise<void> {
    const criticalAlerts = await MLShadowAlertModel.countDocuments({
      severity: 'CRITICAL',
      status: { $in: ['OPEN', 'ACKED'] },
    });

    const highAlerts = await MLShadowAlertModel.find({
      severity: 'HIGH',
      status: { $in: ['OPEN', 'ACKED'] },
    }).exec();

    // Check if any HIGH alert is older than 24h
    const staleHighAlerts = highAlerts.filter(alert => {
      const hoursSinceFirst = (now.getTime() - alert.firstSeenAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceFirst > this.THRESHOLDS.MAX_HIGH_ALERTS_HOURS;
    });

    const pass = criticalAlerts === 0 && staleHighAlerts.length === 0;

    const reason = !pass
      ? `criticalAlerts=${criticalAlerts} OR highAlerts>${this.THRESHOLDS.MAX_HIGH_ALERTS_HOURS}h: ${staleHighAlerts.length}`
      : undefined;

    await this.updateGate(
      'ALERTS',
      pass ? 'PASS' : 'FAIL',
      reason,
      { criticalAlerts, highAlerts: highAlerts.length },
      now
    );
  }

  /**
   * G5 - TEMPORAL: Minimum observation period
   */
  private static async evaluateTemporalGate(now: Date): Promise<void> {
    const firstEvaluation = await MLShadowEvaluationModel
      .findOne()
      .sort({ createdAt: 1 })
      .exec();

    if (!firstEvaluation) {
      await this.updateGate('TEMPORAL', 'FAIL', 'No evaluations yet', {}, now);
      return;
    }

    const hoursSinceFirst = (now.getTime() - firstEvaluation.createdAt.getTime()) / (1000 * 60 * 60);
    const pass = hoursSinceFirst >= this.THRESHOLDS.MIN_OBSERVATION_HOURS;

    const reason = !pass
      ? `observationHours=${hoursSinceFirst.toFixed(0)}h < ${this.THRESHOLDS.MIN_OBSERVATION_HOURS}h`
      : undefined;

    await this.updateGate(
      'TEMPORAL',
      pass ? 'PASS' : 'FAIL',
      reason,
      { observationHours: hoursSinceFirst },
      now
    );
  }

  /**
   * Update gate (upsert)
   */
  private static async updateGate(
    gate: GateType,
    status: 'PASS' | 'FAIL',
    blockingReason: string | undefined,
    metrics: any,
    now: Date
  ): Promise<void> {
    await MLReadinessGateModel.findOneAndUpdate(
      { gate },
      {
        gate,
        status,
        blockingReason,
        metrics,
        lastEvaluatedAt: now,
      },
      { upsert: true, new: true }
    ).exec();

    console.log(`[ReadinessGates] ${gate}: ${status}${blockingReason ? ` (${blockingReason})` : ''}`);
  }

  /**
   * Get readiness status (for Phase 5)
   */
  static async getReadinessStatus(): Promise<{
    readyForPhase5: boolean;
    gates: Array<{
      gate: string;
      status: string;
      blockingReason?: string;
      metrics?: any;
    }>;
  }> {
    const gates = await MLReadinessGateModel.find().exec();

    const allPass = gates.length === 5 && gates.every(g => g.status === 'PASS');

    return {
      readyForPhase5: allPass,
      gates: gates.map(g => ({
        gate: g.gate,
        status: g.status,
        blockingReason: g.blockingReason,
        metrics: g.metrics,
      })),
    };
  }

  /**
   * Check if specific gate passes
   */
  static async checkGate(gate: GateType): Promise<boolean> {
    const gateDoc = await MLReadinessGateModel.findOne({ gate }).exec();
    return gateDoc?.status === 'PASS';
  }
}
