/**
 * ScrollRiskAssessor - оценка риска в реальном времени
 * 
 * Анализирует telemetry и возвращает risk score
 * НЕ блокирует, только оценивает
 */

/** Telemetry data from scroll */
export interface ScrollTelemetry {
  fetchedPosts: number;
  latencyMs: number;
  xhrErrors: number;
  captchaSeen: boolean;
  rateLimitSeen: boolean;
  scrollDepthPx: number;
  scrollsPerMinute: number;
  emptyResponses: number;
  timestamp: Date;
}

/** Risk levels */
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** Risk assessment result */
export interface RuntimeRisk {
  score: number; // 0-100
  level: RiskLevel;
  factors: string[];
}

/** Thresholds */
const THRESHOLDS = {
  latency: {
    warning: 3000,
    danger: 5000,
  },
  xhrErrors: {
    warning: 1,
    danger: 3,
  },
  emptyResponses: {
    warning: 2,
    danger: 5,
  },
  scrollsPerMinute: {
    warning: 20,
    danger: 30,
  },
};

export class ScrollRiskAssessor {
  /**
   * Assess risk based on telemetry
   */
  assess(telemetry: ScrollTelemetry): RuntimeRisk {
    let score = 0;
    const factors: string[] = [];

    // Factor 1: Latency
    if (telemetry.latencyMs > THRESHOLDS.latency.danger) {
      score += 30;
      factors.push('Very high latency');
    } else if (telemetry.latencyMs > THRESHOLDS.latency.warning) {
      score += 15;
      factors.push('High latency');
    }

    // Factor 2: XHR Errors
    if (telemetry.xhrErrors >= THRESHOLDS.xhrErrors.danger) {
      score += 35;
      factors.push('Multiple XHR errors');
    } else if (telemetry.xhrErrors >= THRESHOLDS.xhrErrors.warning) {
      score += 20;
      factors.push('XHR errors detected');
    }

    // Factor 3: Captcha
    if (telemetry.captchaSeen) {
      score += 50;
      factors.push('Captcha detected');
    }

    // Factor 4: Rate limit
    if (telemetry.rateLimitSeen) {
      score += 60;
      factors.push('Rate limit hit');
    }

    // Factor 5: Empty responses
    if (telemetry.emptyResponses >= THRESHOLDS.emptyResponses.danger) {
      score += 25;
      factors.push('Many empty responses');
    } else if (telemetry.emptyResponses >= THRESHOLDS.emptyResponses.warning) {
      score += 10;
      factors.push('Some empty responses');
    }

    // Factor 6: Scroll speed
    if (telemetry.scrollsPerMinute > THRESHOLDS.scrollsPerMinute.danger) {
      score += 20;
      factors.push('Scrolling too fast');
    } else if (telemetry.scrollsPerMinute > THRESHOLDS.scrollsPerMinute.warning) {
      score += 10;
      factors.push('Scroll speed elevated');
    }

    // Cap at 100
    score = Math.min(100, score);

    // Determine level
    const level = this.scoreToLevel(score);

    return { score, level, factors };
  }

  /**
   * Convert score to risk level
   */
  private scoreToLevel(score: number): RiskLevel {
    if (score >= 70) return RiskLevel.CRITICAL;
    if (score >= 50) return RiskLevel.HIGH;
    if (score >= 25) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  /**
   * Should downgrade profile?
   */
  shouldDowngrade(risk: RuntimeRisk): boolean {
    return risk.level === RiskLevel.HIGH || risk.level === RiskLevel.CRITICAL;
  }

  /**
   * Should abort task?
   */
  shouldAbort(risk: RuntimeRisk): boolean {
    return risk.level === RiskLevel.CRITICAL;
  }
}
