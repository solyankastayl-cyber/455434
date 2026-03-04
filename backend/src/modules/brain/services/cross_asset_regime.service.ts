/**
 * P9.0 — Cross-Asset Regime Classifier Service
 * 
 * Deterministic rule-based classification of cross-asset correlation regime.
 * Uses 60d window as primary, 20d/120d for diagnostics.
 */

import {
  CrossAssetPack,
  CrossAssetRegime,
  CrossAssetCorrWindow,
  REGIME_THRESHOLDS,
  WindowSize,
} from '../contracts/cross_asset.contract.js';
import { getRollingCorrService } from './rolling_corr.service.js';

export class CrossAssetRegimeService {

  /**
   * Build full CrossAssetPack
   */
  async buildPack(asOf: string): Promise<CrossAssetPack> {
    const corrService = getRollingCorrService();
    const windows = await corrService.computeWindows(asOf);

    const w20 = windows.find(w => w.windowDays === 20)!;
    const w60 = windows.find(w => w.windowDays === 60)!;
    const w120 = windows.find(w => w.windowDays === 120)!;

    // Diagnostics
    const diagnostics = this.computeDiagnostics(w20, w60, w120);

    // Classify regime
    const regime = this.classifyRegime(w20, w60, w120, diagnostics);

    // Key correlations for evidence
    const keyCorrs: Record<string, number> = {
      '20d:btc_spx': w20.corr_btc_spx,
      '60d:btc_spx': w60.corr_btc_spx,
      '120d:btc_spx': w120.corr_btc_spx,
      '60d:btc_dxy': w60.corr_btc_dxy,
      '60d:spx_dxy': w60.corr_spx_dxy,
      '60d:btc_gold': w60.corr_btc_gold,
      '60d:spx_gold': w60.corr_spx_gold,
      '60d:dxy_gold': w60.corr_dxy_gold,
    };

    return {
      asOf,
      windows,
      regime,
      diagnostics,
      evidence: {
        keyCorrs,
        thresholds: {
          risk_on_btc_spx_min: REGIME_THRESHOLDS.RISK_ON_SYNC.corr_btc_spx_min,
          risk_on_dxy_spx_max: REGIME_THRESHOLDS.RISK_ON_SYNC.corr_dxy_spx_max,
          risk_off_btc_spx_min: REGIME_THRESHOLDS.RISK_OFF_SYNC.corr_btc_spx_min,
          risk_off_dxy_risk_min: REGIME_THRESHOLDS.RISK_OFF_SYNC.corr_dxy_risk_min,
          ftq_gold_risk_max: REGIME_THRESHOLDS.FLIGHT_TO_QUALITY.corr_gold_risk_max,
          decoupled_btc_spx_max: REGIME_THRESHOLDS.DECOUPLED.corr_btc_spx_max,
        },
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // DIAGNOSTICS
  // ─────────────────────────────────────────────────────────

  private computeDiagnostics(
    w20: CrossAssetCorrWindow,
    w60: CrossAssetCorrWindow,
    w120: CrossAssetCorrWindow
  ): {
    decoupleScore: number;
    signFlipCount: number;
    corrStability: number;
    contagionScore: number;
  } {
    // decoupleScore: how much 20d and 120d correlations diverge
    const diffs = [
      Math.abs(w20.corr_btc_spx - w120.corr_btc_spx),
      Math.abs(w20.corr_btc_dxy - w120.corr_btc_dxy),
      Math.abs(w20.corr_spx_dxy - w120.corr_spx_dxy),
    ];
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const decoupleScore = Math.min(1, avgDiff / 0.5); // normalize to 0..1

    // signFlipCount: how many correlations flip sign across windows
    let signFlipCount = 0;
    const pairs = [
      [w20.corr_btc_spx, w60.corr_btc_spx, w120.corr_btc_spx],
      [w20.corr_btc_dxy, w60.corr_btc_dxy, w120.corr_btc_dxy],
      [w20.corr_spx_dxy, w60.corr_spx_dxy, w120.corr_spx_dxy],
      [w20.corr_btc_gold, w60.corr_btc_gold, w120.corr_btc_gold],
      [w20.corr_spx_gold, w60.corr_spx_gold, w120.corr_spx_gold],
      [w20.corr_dxy_gold, w60.corr_dxy_gold, w120.corr_dxy_gold],
    ];
    for (const [a, b, c] of pairs) {
      if ((a > 0 && b < 0) || (a < 0 && b > 0)) signFlipCount++;
      if ((b > 0 && c < 0) || (b < 0 && c > 0)) signFlipCount++;
    }
    signFlipCount = Math.min(signFlipCount, 6);

    // corrStability: variance of correlations across windows (lower = more stable)
    const allCorrs = [
      [w20.corr_btc_spx, w60.corr_btc_spx, w120.corr_btc_spx],
      [w20.corr_btc_dxy, w60.corr_btc_dxy, w120.corr_btc_dxy],
      [w20.corr_spx_dxy, w60.corr_spx_dxy, w120.corr_spx_dxy],
    ];
    let totalVar = 0;
    for (const vals of allCorrs) {
      const mean = vals.reduce((a, b) => a + b, 0) / 3;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / 3;
      totalVar += variance;
    }
    const avgVar = totalVar / allCorrs.length;
    const corrStability = Math.max(0, Math.min(1, 1 - avgVar * 10)); // 1 = stable

    // contagionScore: all risk assets move together downward
    // High when BTC-SPX corr is high and both negative-corr with DXY (or DXY inverse)
    const btcSpxSync = Math.max(0, w60.corr_btc_spx);
    const dxyInverse = Math.max(0, -w60.corr_spx_dxy) + Math.max(0, -w60.corr_btc_dxy);
    const contagionScore = Math.min(1, btcSpxSync * 0.6 + (dxyInverse / 2) * 0.4);

    return {
      decoupleScore: round3(decoupleScore),
      signFlipCount,
      corrStability: round3(corrStability),
      contagionScore: round3(contagionScore),
    };
  }

  // ─────────────────────────────────────────────────────────
  // REGIME CLASSIFICATION (deterministic rules)
  // ─────────────────────────────────────────────────────────

  private classifyRegime(
    w20: CrossAssetCorrWindow,
    w60: CrossAssetCorrWindow,
    w120: CrossAssetCorrWindow,
    diagnostics: { decoupleScore: number; contagionScore: number }
  ): { label: CrossAssetRegime; confidence: number; rationale: string[] } {
    const t = REGIME_THRESHOLDS;
    const rationale: string[] = [];

    // Score each regime (0..1)
    let scores: Record<CrossAssetRegime, number> = {
      RISK_ON_SYNC: 0,
      RISK_OFF_SYNC: 0,
      FLIGHT_TO_QUALITY: 0,
      DECOUPLED: 0,
      MIXED: 0,
    };

    // A) RISK_ON_SYNC
    if (w60.corr_btc_spx >= t.RISK_ON_SYNC.corr_btc_spx_min) {
      scores.RISK_ON_SYNC += 0.4;
      rationale.push(`BTC-SPX corr(60d)=${w60.corr_btc_spx} >= ${t.RISK_ON_SYNC.corr_btc_spx_min} (risk assets synced)`);
    }
    if (w60.corr_spx_dxy <= t.RISK_ON_SYNC.corr_dxy_spx_max) {
      scores.RISK_ON_SYNC += 0.3;
      rationale.push(`SPX-DXY corr(60d)=${w60.corr_spx_dxy} <= ${t.RISK_ON_SYNC.corr_dxy_spx_max} (DXY as risk-off)`);
    }
    if (w60.corr_spx_gold <= t.RISK_ON_SYNC.corr_gold_spx_max) {
      scores.RISK_ON_SYNC += 0.2;
    }
    if (diagnostics.contagionScore < 0.3) {
      scores.RISK_ON_SYNC += 0.1;
    }

    // B) RISK_OFF_SYNC
    if (w60.corr_btc_spx >= t.RISK_OFF_SYNC.corr_btc_spx_min) {
      scores.RISK_OFF_SYNC += 0.3;
    }
    if (w60.corr_spx_dxy >= t.RISK_OFF_SYNC.corr_dxy_risk_min ||
        w60.corr_btc_dxy >= t.RISK_OFF_SYNC.corr_dxy_risk_min) {
      scores.RISK_OFF_SYNC += 0.4;
      rationale.push(`DXY correlating with risk assets → potential stress sync`);
    }
    if (diagnostics.contagionScore >= 0.5) {
      scores.RISK_OFF_SYNC += 0.3;
      rationale.push(`High contagion score: ${diagnostics.contagionScore}`);
    }

    // C) FLIGHT_TO_QUALITY
    if (w60.corr_spx_gold <= t.FLIGHT_TO_QUALITY.corr_gold_risk_max ||
        w60.corr_btc_gold <= t.FLIGHT_TO_QUALITY.corr_gold_risk_max) {
      scores.FLIGHT_TO_QUALITY += 0.5;
      rationale.push(`Gold negatively correlated with risk → flight-to-quality signal`);
    }
    if (w60.corr_dxy_gold <= t.FLIGHT_TO_QUALITY.corr_dxy_gold_max) {
      scores.FLIGHT_TO_QUALITY += 0.3;
      rationale.push(`DXY-Gold corr(60d)=${w60.corr_dxy_gold} → quality bid`);
    }

    // D) DECOUPLED
    if (Math.abs(w20.corr_btc_spx) < t.DECOUPLED.corr_btc_spx_max) {
      scores.DECOUPLED += 0.4;
      rationale.push(`BTC-SPX corr(20d)=${w20.corr_btc_spx} → low short-term correlation`);
    }
    if (diagnostics.decoupleScore >= t.DECOUPLED.decouple_score_min) {
      scores.DECOUPLED += 0.4;
      rationale.push(`High decouple score: ${diagnostics.decoupleScore} → correlations breaking down`);
    }

    // Find winning regime
    let bestLabel: CrossAssetRegime = 'MIXED';
    let bestScore = 0;

    for (const [label, score] of Object.entries(scores) as [CrossAssetRegime, number][]) {
      if (label === 'MIXED') continue;
      if (score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    }

    // Minimum threshold to declare a regime (not MIXED)
    if (bestScore < 0.4) {
      bestLabel = 'MIXED';
      rationale.push('No regime scored above threshold → MIXED');
    }

    // Confidence based on score margin and data quality
    const minSampleN = Math.min(w20.sampleN, w60.sampleN, w120.sampleN);
    const dataConfidence = Math.min(1, minSampleN / 60);
    const scoreConfidence = Math.min(1, bestScore);
    const confidence = round3(dataConfidence * 0.4 + scoreConfidence * 0.6);

    return { label: bestLabel, confidence, rationale };
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// Singleton
let instance: CrossAssetRegimeService | null = null;

export function getCrossAssetRegimeService(): CrossAssetRegimeService {
  if (!instance) {
    instance = new CrossAssetRegimeService();
  }
  return instance;
}
