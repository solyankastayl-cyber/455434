// P1: Risk Calculator
// Calculates risk score (0-100) based on session factors

import { RiskFactors } from './risk.types.js';
import { RISK_WEIGHTS, AGE_THRESHOLDS } from './risk.weights.js';

export class RiskCalculator {
  /**
   * Calculate risk score from factors
   * Returns 0-100 (0 = healthy, 100 = dead)
   */
  calculate(factors: RiskFactors): number {
    let score = 0;

    // 1. Cookie age score (0-40 points based on hours)
    const ageScore = this.calculateAgeScore(factors.cookieAgeHours);
    score += ageScore * RISK_WEIGHTS.cookieAge;

    // 2. Warmth failure score (0-100 * rate)
    const warmthScore = factors.warmthFailureRate * 100;
    score += warmthScore * RISK_WEIGHTS.warmth;

    // 3. Parser error score (0-100 * rate)
    const parserScore = factors.parserErrorRate * 100;
    score += parserScore * RISK_WEIGHTS.parserErrors;

    // 4. Rate limit pressure (0-100 * rate)
    const rateLimitScore = factors.rateLimitPressure * 100;
    score += rateLimitScore * RISK_WEIGHTS.rateLimit;

    // 5. Proxy drift score (binary: 0 or 30)
    const proxyScore = factors.proxyChangedRecently ? 30 : 0;
    score += proxyScore * RISK_WEIGHTS.proxyDrift;

    // 6. Idle time score (0-20 based on hours)
    const idleScore = Math.min(20, factors.idleHours * 0.5);
    score += idleScore * RISK_WEIGHTS.idle;

    // 7. Missing cookies score (binary: 0 or 100)
    const missingCookiesScore = factors.hasRequiredCookies ? 0 : 100;
    score += missingCookiesScore * RISK_WEIGHTS.missingCookies;

    // Normalize and clamp to 0-100
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Calculate age component score (0-100)
   */
  private calculateAgeScore(hours: number): number {
    if (hours < AGE_THRESHOLDS.fresh) {
      return 0;
    }
    if (hours < AGE_THRESHOLDS.normal) {
      return 10;
    }
    if (hours < AGE_THRESHOLDS.aging) {
      return 30;
    }
    if (hours < AGE_THRESHOLDS.old) {
      return 50;
    }
    if (hours < AGE_THRESHOLDS.critical) {
      return 70;
    }
    return 100; // Very old cookies
  }

  /**
   * Get breakdown of risk calculation
   * Useful for debugging and UI display
   */
  getBreakdown(factors: RiskFactors): Record<string, { score: number; weight: number; contribution: number }> {
    const ageScore = this.calculateAgeScore(factors.cookieAgeHours);
    const warmthScore = factors.warmthFailureRate * 100;
    const parserScore = factors.parserErrorRate * 100;
    const rateLimitScore = factors.rateLimitPressure * 100;
    const proxyScore = factors.proxyChangedRecently ? 30 : 0;
    const idleScore = Math.min(20, factors.idleHours * 0.5);
    const missingCookiesScore = factors.hasRequiredCookies ? 0 : 100;

    return {
      cookieAge: {
        score: ageScore,
        weight: RISK_WEIGHTS.cookieAge,
        contribution: ageScore * RISK_WEIGHTS.cookieAge,
      },
      warmth: {
        score: warmthScore,
        weight: RISK_WEIGHTS.warmth,
        contribution: warmthScore * RISK_WEIGHTS.warmth,
      },
      parserErrors: {
        score: parserScore,
        weight: RISK_WEIGHTS.parserErrors,
        contribution: parserScore * RISK_WEIGHTS.parserErrors,
      },
      rateLimit: {
        score: rateLimitScore,
        weight: RISK_WEIGHTS.rateLimit,
        contribution: rateLimitScore * RISK_WEIGHTS.rateLimit,
      },
      proxyDrift: {
        score: proxyScore,
        weight: RISK_WEIGHTS.proxyDrift,
        contribution: proxyScore * RISK_WEIGHTS.proxyDrift,
      },
      idle: {
        score: idleScore,
        weight: RISK_WEIGHTS.idle,
        contribution: idleScore * RISK_WEIGHTS.idle,
      },
      missingCookies: {
        score: missingCookiesScore,
        weight: RISK_WEIGHTS.missingCookies,
        contribution: missingCookiesScore * RISK_WEIGHTS.missingCookies,
      },
    };
  }
}

export const riskCalculator = new RiskCalculator();
