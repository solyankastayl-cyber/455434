/**
 * Ablation Verdict Service - B4.3
 * 
 * Determines whether Model B (with more features) IMPROVES/NEUTRAL/DEGRADES vs Model A
 * 
 * Rules (FROZEN):
 * - IMPROVES: deltaF1 >= +1.5% AND deltaAccuracy >= 0 AND no FP explosion
 * - DEGRADES: deltaF1 <= -1.0% OR deltaAccuracy <= -1.0% OR FP explosion
 * - NEUTRAL: Otherwise
 * - INCONCLUSIVE: Too few rows
 */
import { AblationVerdict } from '../models/ml_ablation_report.model.js';

export interface VerdictInput {
  deltaF1: number;
  deltaAccuracy: number;
  fpRateA: number;
  fpRateB: number;
  rows: number;
}

export interface VerdictOutput {
  verdict: AblationVerdict;
  reasons: string[];
}

export class AblationVerdictService {
  private readonly MIN_ROWS = 200;
  private readonly IMPROVE_F1_THRESHOLD = 0.015;    // +1.5%
  private readonly DEGRADE_F1_THRESHOLD = -0.01;    // -1.0%
  private readonly DEGRADE_ACC_THRESHOLD = -0.01;   // -1.0%
  private readonly FP_EXPLOSION_THRESHOLD = 0.02;   // +2.0% FP rate jump

  decide(input: VerdictInput): VerdictOutput {
    const reasons: string[] = [];

    // Inconclusive if too few rows
    if (input.rows < this.MIN_ROWS) {
      return {
        verdict: 'INCONCLUSIVE',
        reasons: [`TOO_FEW_ROWS (${input.rows} < ${this.MIN_ROWS})`],
      };
    }

    // Check for FP explosion
    const fpJump = input.fpRateB - input.fpRateA;
    const fpExplosion = fpJump > this.FP_EXPLOSION_THRESHOLD;
    
    if (fpExplosion) {
      reasons.push(`FP_RATE_EXPLOSION (+${(fpJump * 100).toFixed(2)}%)`);
    }

    // IMPROVES: F1 improved significantly, accuracy didn't degrade, no FP explosion
    if (
      input.deltaF1 >= this.IMPROVE_F1_THRESHOLD &&
      input.deltaAccuracy >= 0 &&
      !fpExplosion
    ) {
      reasons.push(`DELTA_F1_POSITIVE (+${(input.deltaF1 * 100).toFixed(2)}%)`);
      reasons.push('DELTA_ACC_NON_NEGATIVE');
      reasons.push('NO_FP_EXPLOSION');
      return { verdict: 'IMPROVES', reasons };
    }

    // DEGRADES: F1 or accuracy dropped significantly, or FP explosion
    if (
      input.deltaF1 <= this.DEGRADE_F1_THRESHOLD ||
      input.deltaAccuracy <= this.DEGRADE_ACC_THRESHOLD ||
      fpExplosion
    ) {
      if (input.deltaF1 <= this.DEGRADE_F1_THRESHOLD) {
        reasons.push(`DELTA_F1_NEGATIVE (${(input.deltaF1 * 100).toFixed(2)}%)`);
      }
      if (input.deltaAccuracy <= this.DEGRADE_ACC_THRESHOLD) {
        reasons.push(`DELTA_ACC_NEGATIVE (${(input.deltaAccuracy * 100).toFixed(2)}%)`);
      }
      return { verdict: 'DEGRADES', reasons };
    }

    // NEUTRAL: Minor changes within tolerance band
    reasons.push(
      `WITHIN_NEUTRAL_BAND (F1: ${(input.deltaF1 * 100).toFixed(2)}%, Acc: ${(input.deltaAccuracy * 100).toFixed(2)}%)`
    );
    return { verdict: 'NEUTRAL', reasons };
  }
}

export default AblationVerdictService;
