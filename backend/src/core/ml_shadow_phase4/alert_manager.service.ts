/**
 * PHASE 4 - БЛОК 4.5: Alert Manager
 * 
 * Passive monitoring + auto-resolve
 * NO external notifications, NO Engine influence
 */
import { MLShadowAlertModel, ShadowAlertType, ShadowAlertSeverity } from './ml_shadow_alert.model.js';
import { v4 as uuidv4 } from 'uuid';

export interface AlertRule {
  type: ShadowAlertType;
  metric: string;
  threshold: number;
  severity: ShadowAlertSeverity;
  message: string;
}

export class AlertManager {
  // Alert thresholds
  private static readonly THRESHOLDS = {
    // DRIFT
    ECE_HIGH: 0.12,
    AGREEMENT_LOW: 0.35,
    
    // DEGRADATION
    ACCURACY_DROP: 0.20, // 20% drop vs baseline
    
    // ANOMALY
    FLIP_RATE_HIGH: 0.05, // 5%
    
    // DATA_GAP
    LABELS_STALE_HOURS: 24,
  };

  /**
   * Check and create alerts based on evaluation metrics
   */
  static async checkMetrics(evaluation: any): Promise<void> {
    const { runId, window, ece, agreementRate, flipRate, accuracy } = evaluation;

    // Check DRIFT (ECE)
    if (ece > this.THRESHOLDS.ECE_HIGH) {
      await this.createOrUpdateAlert({
        type: 'DRIFT',
        metric: 'ece',
        currentValue: ece,
        threshold: this.THRESHOLDS.ECE_HIGH,
        severity: this.getSeverityByExcess(ece, this.THRESHOLDS.ECE_HIGH, 'high'),
        message: `High calibration error: ECE=${ece.toFixed(3)} (threshold=${this.THRESHOLDS.ECE_HIGH})`,
        window,
        runId,
      });
    } else {
      // Auto-resolve if ECE recovered
      await this.autoResolveAlert('DRIFT', 'ece', 'ECE returned to normal range');
    }

    // Check DRIFT (Agreement Rate)
    if (agreementRate < this.THRESHOLDS.AGREEMENT_LOW) {
      await this.createOrUpdateAlert({
        type: 'DRIFT',
        metric: 'agreementRate',
        currentValue: agreementRate,
        threshold: this.THRESHOLDS.AGREEMENT_LOW,
        severity: this.getSeverityByExcess(this.THRESHOLDS.AGREEMENT_LOW - agreementRate, 0.1, 'high'),
        message: `Low ML-Engine agreement: ${(agreementRate * 100).toFixed(1)}% (threshold=${(this.THRESHOLDS.AGREEMENT_LOW * 100).toFixed(0)}%)`,
        window,
        runId,
      });
    } else {
      await this.autoResolveAlert('DRIFT', 'agreementRate', 'Agreement rate recovered');
    }

    // Check ANOMALY (Flip Rate)
    if (flipRate > this.THRESHOLDS.FLIP_RATE_HIGH) {
      await this.createOrUpdateAlert({
        type: 'ANOMALY',
        metric: 'flipRate',
        currentValue: flipRate,
        threshold: this.THRESHOLDS.FLIP_RATE_HIGH,
        severity: 'HIGH',
        message: `High flip rate: ${(flipRate * 100).toFixed(1)}% (threshold=${(this.THRESHOLDS.FLIP_RATE_HIGH * 100).toFixed(0)}%)`,
        window,
        runId,
      });
    } else {
      await this.autoResolveAlert('ANOMALY', 'flipRate', 'Flip rate normalized');
    }

    // Check DEGRADATION (Accuracy drop)
    const baseline = await this.getBaselineAccuracy(window);
    if (baseline && accuracy < baseline * (1 - this.THRESHOLDS.ACCURACY_DROP)) {
      await this.createOrUpdateAlert({
        type: 'DEGRADATION',
        metric: 'accuracy',
        currentValue: accuracy,
        baselineValue: baseline,
        threshold: baseline * (1 - this.THRESHOLDS.ACCURACY_DROP),
        severity: 'HIGH',
        message: `Accuracy degradation: ${(accuracy * 100).toFixed(1)}% vs baseline ${(baseline * 100).toFixed(1)}%`,
        window,
        runId,
      });
    } else if (baseline) {
      await this.autoResolveAlert('DEGRADATION', 'accuracy', 'Accuracy recovered');
    }
  }

  /**
   * Create or update alert (idempotent)
   */
  private static async createOrUpdateAlert(params: {
    type: ShadowAlertType;
    metric: string;
    currentValue: number;
    threshold: number;
    severity: ShadowAlertSeverity;
    message: string;
    baselineValue?: number;
    window?: string;
    runId?: string;
  }): Promise<void> {
    const alertId = `${params.type.toLowerCase()}-${params.metric}`;
    
    const existing = await MLShadowAlertModel.findOne({
      alertId,
      status: { $in: ['OPEN', 'ACKED'] },
    }).exec();

    const now = new Date();

    if (existing) {
      // Update existing alert
      existing.currentValue = params.currentValue;
      existing.lastSeenAt = now;
      existing.severity = params.severity; // Update severity based on current value
      existing.runId = params.runId;
      await existing.save();
      
      console.log(`[AlertManager] Updated alert ${alertId}: ${params.severity}`);
    } else {
      // Create new alert
      await MLShadowAlertModel.create({
        alertId,
        type: params.type,
        severity: params.severity,
        status: 'OPEN',
        metric: params.metric,
        currentValue: params.currentValue,
        baselineValue: params.baselineValue,
        threshold: params.threshold,
        window: params.window,
        runId: params.runId,
        firstSeenAt: now,
        lastSeenAt: now,
        message: params.message,
      });
      
      console.log(`[AlertManager] Created alert ${alertId}: ${params.severity}`);
    }
  }

  /**
   * Auto-resolve alert when metric recovers
   */
  private static async autoResolveAlert(
    type: ShadowAlertType,
    metric: string,
    reason: string
  ): Promise<void> {
    const alertId = `${type.toLowerCase()}-${metric}`;
    
    const existing = await MLShadowAlertModel.findOne({
      alertId,
      status: { $in: ['OPEN', 'ACKED'] },
    }).exec();

    if (existing) {
      existing.status = 'RESOLVED';
      existing.resolutionReason = reason;
      existing.resolvedAt = new Date();
      await existing.save();
      
      console.log(`[AlertManager] Auto-resolved alert ${alertId}: ${reason}`);
    }
  }

  /**
   * Get baseline accuracy (rolling average of last 3 runs)
   */
  private static async getBaselineAccuracy(window: string): Promise<number | null> {
    // TODO: Calculate rolling baseline from ml_shadow_evaluations
    // For now, return null (no baseline yet)
    return null;
  }

  /**
   * Get severity based on how much threshold is exceeded
   */
  private static getSeverityByExcess(
    excess: number,
    criticalThreshold: number,
    direction: 'high' | 'low'
  ): ShadowAlertSeverity {
    const ratio = excess / criticalThreshold;
    
    if (ratio > 2) return 'CRITICAL';
    if (ratio > 1) return 'HIGH';
    if (ratio > 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Get alerts summary
   */
  static async getSummary(): Promise<{
    total: number;
    byType: Record<ShadowAlertType, number>;
    bySeverity: Record<ShadowAlertSeverity, number>;
    byStatus: { open: number; acked: number; resolved: number };
  }> {
    const alerts = await MLShadowAlertModel.find().exec();

    const summary = {
      total: alerts.length,
      byType: {
        DRIFT: 0,
        DEGRADATION: 0,
        ANOMALY: 0,
        DATA_GAP: 0,
      },
      bySeverity: {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        CRITICAL: 0,
      },
      byStatus: {
        open: 0,
        acked: 0,
        resolved: 0,
      },
    };

    for (const alert of alerts) {
      summary.byType[alert.type]++;
      summary.bySeverity[alert.severity]++;
      
      if (alert.status === 'OPEN') summary.byStatus.open++;
      else if (alert.status === 'ACKED') summary.byStatus.acked++;
      else if (alert.status === 'RESOLVED') summary.byStatus.resolved++;
    }

    return summary;
  }

  /**
   * Acknowledge alert
   */
  static async acknowledgeAlert(alertId: string): Promise<boolean> {
    const alert = await MLShadowAlertModel.findOne({ alertId }).exec();
    
    if (!alert || alert.status !== 'OPEN') {
      return false;
    }

    alert.status = 'ACKED';
    await alert.save();
    
    console.log(`[AlertManager] Acknowledged alert ${alertId}`);
    return true;
  }

  /**
   * Get active (OPEN/ACKED) alerts
   */
  static async getActiveAlerts(): Promise<any[]> {
    return MLShadowAlertModel
      .find({ status: { $in: ['OPEN', 'ACKED'] } })
      .sort({ severity: 1, firstSeenAt: -1 })
      .exec();
  }
}
