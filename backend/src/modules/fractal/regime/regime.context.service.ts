/**
 * BLOCK 60 — Regime Context Service
 * 
 * Single source of truth for all policy decisions.
 * Aggregates: volatility + phase + bias + tail + reliability → flags
 */

import type {
  RegimeContext,
  RegimeContextInput,
  VolatilityRegime,
  MarketPhase,
  GlobalBias,
  ReliabilityBadge,
  RegimeFlags,
  TailRisk,
  ReliabilityHealth,
} from './regime.types.js';

// ═══════════════════════════════════════════════════════════════
// SEVERITY WEIGHTS (institutional)
// ═══════════════════════════════════════════════════════════════

const VOL_REGIME_SEVERITY: Record<VolatilityRegime, number> = {
  LOW: 0.0,
  NORMAL: 0.2,
  HIGH: 0.5,
  EXPANSION: 0.7,
  CRISIS: 1.0,
};

const PHASE_SEVERITY: Record<MarketPhase, number> = {
  ACCUMULATION: 0.1,
  MARKUP: 0.0,
  DISTRIBUTION: 0.4,
  MARKDOWN: 0.6,
  UNKNOWN: 0.3,
};

const RELIABILITY_SEVERITY: Record<ReliabilityBadge, number> = {
  OK: 0.0,
  WARN: 0.3,
  CRITICAL: 0.7,
  HALT: 1.0,
};

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class RegimeContextService {
  /**
   * Build regime context from various inputs.
   * This is the SINGLE SOURCE OF TRUTH for all downstream policy.
   */
  build(input: RegimeContextInput): RegimeContext {
    const asof = new Date().toISOString();

    // Extract volatility
    const volRegime = input.volatility.regime;
    const volatility = {
      rv30: input.volatility.rv30,
      rv90: input.volatility.rv90,
      atr14Pct: input.volatility.atr14Pct,
      zScore: input.volatility.zScore,
    };

    // Extract phase (default UNKNOWN)
    const phase: MarketPhase = input.phase ?? 'UNKNOWN';

    // Extract bias (default NEUTRAL)
    const bias: GlobalBias = input.structureBias ?? 'NEUTRAL';

    // Build reliability health
    const reliability = this.buildReliability(input.reliability);

    // Build tail risk
    const tailRisk = this.buildTailRisk(input.tailRisk);

    // Calculate severity score
    const severityScore = this.calculateSeverity(volRegime, phase, reliability, tailRisk);

    // Derive flags
    const flags = this.deriveFlags(volRegime, phase, reliability, tailRisk, severityScore, input.governanceOverrides);

    // Build explanation
    const explain = this.buildExplain(volRegime, phase, bias, reliability, tailRisk, flags);

    return {
      symbol: input.symbol,
      asof,
      volRegime,
      phase,
      bias,
      tailRisk,
      reliability,
      volatility,
      flags,
      severityScore,
      explain,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private buildReliability(input?: RegimeContextInput['reliability']): ReliabilityHealth {
    if (!input) {
      return {
        score: 0.7,
        badge: 'OK',
        drift: 0,
        calibration: 0.8,
      };
    }
    return {
      score: input.score,
      badge: input.badge,
      drift: input.drift ?? 0,
      calibration: input.calibration ?? 0.8,
    };
  }

  private buildTailRisk(input?: RegimeContextInput['tailRisk']): TailRisk {
    return {
      mcP95: input?.mcP95 ?? 0.25,
      wfMaxDD: input?.wfMaxDD ?? 0.20,
      currentDD: input?.currentDD ?? 0,
    };
  }

  private calculateSeverity(
    volRegime: VolatilityRegime,
    phase: MarketPhase,
    reliability: ReliabilityHealth,
    tailRisk: TailRisk
  ): number {
    // Weighted severity
    const volSev = VOL_REGIME_SEVERITY[volRegime] * 0.4;
    const phaseSev = PHASE_SEVERITY[phase] * 0.2;
    const relSev = RELIABILITY_SEVERITY[reliability.badge] * 0.2;
    const tailSev = Math.min(1, tailRisk.mcP95 / 0.5) * 0.2;

    return Math.min(1, volSev + phaseSev + relSev + tailSev);
  }

  private deriveFlags(
    volRegime: VolatilityRegime,
    phase: MarketPhase,
    reliability: ReliabilityHealth,
    tailRisk: TailRisk,
    severityScore: number,
    overrides?: { frozen?: boolean; halt?: boolean }
  ): RegimeFlags {
    // Protection mode: severity > 0.5 or crisis/halt
    const protectionMode = 
      severityScore > 0.5 ||
      volRegime === 'CRISIS' ||
      reliability.badge === 'HALT';

    // Frozen only: governance override or halt
    const frozenOnly = 
      overrides?.frozen === true ||
      reliability.badge === 'HALT';

    // No new trades: halt or crisis + markdown
    const noNewTrades =
      overrides?.halt === true ||
      reliability.badge === 'HALT' ||
      (volRegime === 'CRISIS' && phase === 'MARKDOWN');

    // Reduce exposure: high severity or critical reliability
    const reduceExposure =
      severityScore > 0.6 ||
      reliability.badge === 'CRITICAL' ||
      tailRisk.mcP95 > 0.4;

    // Structure dominates: crisis or high severity
    const structureDominates =
      volRegime === 'CRISIS' ||
      volRegime === 'EXPANSION' ||
      severityScore > 0.7;

    return {
      protectionMode,
      frozenOnly,
      noNewTrades,
      reduceExposure,
      structureDominates,
    };
  }

  private buildExplain(
    volRegime: VolatilityRegime,
    phase: MarketPhase,
    bias: GlobalBias,
    reliability: ReliabilityHealth,
    tailRisk: TailRisk,
    flags: RegimeFlags
  ): string[] {
    const explain: string[] = [];

    explain.push(`Volatility regime: ${volRegime}`);
    explain.push(`Market phase: ${phase}`);
    explain.push(`Global bias: ${bias}`);
    explain.push(`Reliability: ${reliability.badge} (${(reliability.score * 100).toFixed(0)}%)`);
    explain.push(`Tail risk P95: ${(tailRisk.mcP95 * 100).toFixed(1)}%`);

    if (flags.protectionMode) {
      explain.push('Protection mode ACTIVE — reduced exposure');
    }
    if (flags.structureDominates) {
      explain.push('Structure dominates — long-term bias overrides timing');
    }
    if (flags.noNewTrades) {
      explain.push('No new trades — system in defensive mode');
    }

    return explain;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: RegimeContextService | null = null;

export function getRegimeContextService(): RegimeContextService {
  if (!_instance) {
    _instance = new RegimeContextService();
  }
  return _instance;
}
