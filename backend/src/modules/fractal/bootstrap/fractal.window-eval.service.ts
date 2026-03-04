/**
 * BLOCK 29.25 + 29.27: Window Evaluation Service
 * Scores train window candidates based on combined metrics
 */

import { FractalModelRegistryModel } from '../data/schemas/fractal-model-registry.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export interface WindowScoreResult {
  score: number;
  components: {
    cvAcc: number;
    cvLL: number;
    wfStab: number;
    wfMedS: number;
    maxDD: number;
    metaStab?: number;
  };
}

export class FractalWindowEvalService {
  async scoreWindow(symbol: string, version: string): Promise<WindowScoreResult> {
    const reg = await FractalModelRegistryModel.findOne({ symbol, version }).lean() as any;
    const settings = await FractalSettingsModel.findOne({ symbol }).lean() as any;
    const w = settings?.autoTrainWindow?.weights ?? {};

    const cvAcc = Number(reg?.metrics?.cv_acc ?? 0.5);
    const cvLL = Number(reg?.metrics?.cv_logloss ?? 0.69);

    const wfStab = Number(reg?.walkForwardTrading?.stability_score ?? -999);
    const wfMedS = Number(reg?.walkForwardTrading?.median_sharpe ?? 0);
    const maxDD = Number(reg?.walkForwardTrading?.median_maxDD ?? 0);

    // BLOCK 29.27: Meta-stability (variance across folds)
    const metaStab = Number(reg?.walkForwardTrading?.metaStability ?? 0.5);

    // Normalize/transform into 0..1-ish
    const cvAccN = clamp((cvAcc - 0.50) / 0.10, 0, 1);       // 0.50..0.60
    const cvLLN = clamp((0.75 - cvLL) / 0.10, 0, 1);         // lower is better
    const wfStabN = clamp((wfStab - 0.0) / 0.6, 0, 1);       // 0..0.6+
    const wfMedSN = clamp((wfMedS - 0.0) / 2.0, 0, 1);       // 0..2
    const ddPen = clamp((Math.abs(maxDD) - 0.15) / 0.25, 0, 1); // penalty

    // Meta-stability penalty (29.27)
    const metaWeight = 0.15;
    const metaPenalty = clamp(metaStab / 1.0, 0, 1);

    const score =
      (Number(w.wfTradingStability ?? 0.45) * wfStabN) +
      (Number(w.wfTradingMedianSharpe ?? 0.25) * wfMedSN) +
      (Number(w.cvLogLoss ?? 0.15) * cvLLN) +
      (Number(w.cvAcc ?? 0.10) * cvAccN) -
      (Number(w.maxDD ?? 0.05) * ddPen) -
      (metaWeight * metaPenalty);

    return {
      score,
      components: { cvAcc, cvLL, wfStab, wfMedS, maxDD, metaStab }
    };
  }

  async scoreActive(symbol: string): Promise<WindowScoreResult> {
    const active = await FractalModelRegistryModel.findOne({ symbol, status: 'ACTIVE' }).lean() as any;
    if (!active) {
      return { score: 0, components: { cvAcc: 0.5, cvLL: 0.69, wfStab: 0, wfMedS: 0, maxDD: 0 } };
    }
    return this.scoreWindow(symbol, active.version);
  }
}
