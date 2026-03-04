/**
 * BLOCK 29.24: Drift & Concept Shift Detector Service
 * Detects performance degradation from feedback events and recommends actions
 */

import { FractalFeedbackModel } from '../data/schemas/fractal-feedback.schema.js';
import { FractalOnlineCalibrationModel } from '../data/schemas/fractal-online-calibration.schema.js';
import { FractalDriftModel } from '../data/schemas/fractal-drift.schema.js';

function mean(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export interface DriftParams {
  recentN?: number;
  baselineN?: number;
  highConfLo?: number;
}

export type DriftLevel = 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';
export type DriftAction = 'NONE' | 'RETRAIN' | 'ROLLBACK' | 'FREEZE_PROMOTION';

export interface DriftReport {
  symbol: string;
  ts: Date;
  window: {
    recentN: number;
    baselineN: number;
    recentFrom?: Date;
    recentTo?: Date;
  };
  metrics: {
    recentAcc: number;
    baselineAcc: number;
    accDelta: number;
    recentMeanNet: number;
    baselineMeanNet: number;
    netDelta: number;
    recentHitRate: number;
    baselineHitRate: number;
    highConfAccRecent: number;
    highConfAccBaseline: number;
  };
  drift: {
    level: DriftLevel;
    reasons: string[];
  };
  action: {
    recommended: DriftAction;
    details: Record<string, any>;
  };
  calibration?: { updatedAt?: Date };
}

export class FractalDriftService {
  async compute(symbol = 'BTC', params?: DriftParams): Promise<DriftReport> {
    const recentN = params?.recentN ?? 120;     // ~4 months if daily
    const baselineN = params?.baselineN ?? 720; // ~2 years
    const highConfLo = params?.highConfLo ?? 0.65;

    const recent = await FractalFeedbackModel.find({ symbol })
      .sort({ settleTs: -1 })
      .limit(recentN)
      .lean();

    const baseline = await FractalFeedbackModel.find({ symbol })
      .sort({ settleTs: -1 })
      .skip(recentN)
      .limit(baselineN)
      .lean();

    const recentAcc = mean(recent.map(r => (r.correct ? 1 : 0)));
    const baselineAcc = mean(baseline.map(r => (r.correct ? 1 : 0)));
    const accDelta = recentAcc - baselineAcc;

    const recentNet = mean(recent.map(r => Number((r.label as any)?.y_return ?? 0)));
    const baselineNet = mean(baseline.map(r => Number((r.label as any)?.y_return ?? 0)));
    const netDelta = recentNet - baselineNet;

    // Hit rate as proportion net > 0
    const recentHit = mean(recent.map(r => (Number((r.label as any)?.y_return ?? 0) > 0 ? 1 : 0)));
    const baselineHit = mean(baseline.map(r => (Number((r.label as any)?.y_return ?? 0) > 0 ? 1 : 0)));

    // High-confidence bucket accuracy
    const recentHigh = recent.filter(r => Number(r.confidence ?? 0) >= highConfLo);
    const baseHigh = baseline.filter(r => Number(r.confidence ?? 0) >= highConfLo);

    const highConfAccRecent = mean(recentHigh.map(r => (r.correct ? 1 : 0)));
    const highConfAccBaseline = mean(baseHigh.map(r => (r.correct ? 1 : 0)));

    // Calibration doc
    const cal = await FractalOnlineCalibrationModel.findOne({ symbol }).lean();

    // Decision policy
    const reasons: string[] = [];
    let level: DriftLevel = 'OK';

    // Hard gates
    if (recent.length < Math.max(40, Math.floor(recentN * 0.5))) {
      reasons.push('INSUFFICIENT_RECENT_SAMPLES');
      level = 'WARN';
    }

    // Drift logic
    if (accDelta <= -0.06) reasons.push('ACC_DROP_6P');
    if (accDelta <= -0.10) reasons.push('ACC_DROP_10P');
    if (recentNet < 0) reasons.push('RECENT_MEAN_NET_NEGATIVE');
    if ((highConfAccBaseline - highConfAccRecent) >= 0.10) reasons.push('HIGHCONF_ACCURACY_DROP_10P');

    // Determine severity
    const critical =
      accDelta <= -0.10 ||
      (recentNet < 0 && accDelta <= -0.06) ||
      (highConfAccBaseline - highConfAccRecent) >= 0.15;

    const degraded =
      accDelta <= -0.06 ||
      recentNet < 0 ||
      (highConfAccBaseline - highConfAccRecent) >= 0.10;

    if (critical) level = 'CRITICAL';
    else if (degraded) level = 'DEGRADED';
    else if (reasons.length) level = 'WARN';
    else level = 'OK';

    // Action recommendation
    let recommended: DriftAction = 'NONE';
    const details: any = {};

    if (level === 'WARN') {
      recommended = 'FREEZE_PROMOTION';
      details.freezeDays = 7;
    }
    if (level === 'DEGRADED') {
      recommended = 'RETRAIN';
      details.retrainReason = 'RECENT_PERFORMANCE_DEGRADED';
      details.suggestTrainEnd = new Date().toISOString().slice(0, 10);
    }
    if (level === 'CRITICAL') {
      recommended = 'ROLLBACK';
      details.rollbackReason = 'CRITICAL_DRIFT';
      details.freezePromotionDays = 14;
    }

    const window = {
      recentN,
      baselineN,
      recentFrom: recent.at(-1)?.settleTs,
      recentTo: recent.at(0)?.settleTs
    };

    const report: DriftReport = {
      symbol,
      ts: new Date(),
      window,
      metrics: {
        recentAcc: clamp01(recentAcc),
        baselineAcc: clamp01(baselineAcc),
        accDelta,
        recentMeanNet: recentNet,
        baselineMeanNet: baselineNet,
        netDelta,
        recentHitRate: clamp01(recentHit),
        baselineHitRate: clamp01(baselineHit),
        highConfAccRecent: clamp01(highConfAccRecent),
        highConfAccBaseline: clamp01(highConfAccBaseline)
      },
      drift: { level, reasons },
      action: { recommended, details },
      calibration: cal ? { updatedAt: (cal as any).updatedAt } : undefined
    };

    await FractalDriftModel.create(report);
    return report;
  }

  async getHistory(symbol: string, limit = 20) {
    return FractalDriftModel.find({ symbol })
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
  }
}
