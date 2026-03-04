/**
 * BLOCK 34.4: Confidence Gating
 * Scale exposure and gate entries based on signal confidence
 */

export interface GateConfig {
  enabled: boolean;
  minEnterConfidence: number;   // Min confidence to enter (default 0.35)
  minFlipConfidence: number;    // Min confidence to flip (default 0.45)
  minFullSizeConfidence: number; // Confidence for full size (default 0.65)
  softGate: boolean;            // Scale vs hard block (default true)
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  enabled: true,
  minEnterConfidence: 0.35,
  minFlipConfidence: 0.45,
  minFullSizeConfidence: 0.65,
  softGate: true
};

/**
 * Calculate exposure scale based on confidence
 * @param conf Signal confidence (0-1)
 * @param cfg Gate configuration
 * @returns Scale factor (0-1)
 */
export function confidenceScale(conf: number, cfg: GateConfig): number {
  const c = Math.max(0, Math.min(1, conf ?? 0));

  if (!cfg.softGate) {
    // Hard gate: either 0 or 1
    return c >= cfg.minEnterConfidence ? 1 : 0;
  }

  // Soft gate: scale linearly between minEnter and minFull
  if (c < cfg.minEnterConfidence) return 0;
  if (c >= cfg.minFullSizeConfidence) return 1;

  const t = (c - cfg.minEnterConfidence) / (cfg.minFullSizeConfidence - cfg.minEnterConfidence);
  return Math.max(0, Math.min(1, t));
}

/**
 * Check if entry is allowed
 */
export function canEnter(conf: number, cfg: GateConfig): { allowed: boolean; reason: string; scale: number } {
  if (!cfg.enabled) {
    return { allowed: true, reason: 'GATE_DISABLED', scale: 1 };
  }

  const c = conf ?? 0;

  if (c < cfg.minEnterConfidence) {
    return { 
      allowed: false, 
      reason: `CONF_TOO_LOW (${(c * 100).toFixed(0)}% < ${(cfg.minEnterConfidence * 100).toFixed(0)}%)`,
      scale: 0 
    };
  }

  const scale = confidenceScale(c, cfg);
  return { allowed: true, reason: 'GATE_PASSED', scale };
}

/**
 * Check if flip is allowed
 */
export function canFlip(conf: number, cfg: GateConfig): { allowed: boolean; reason: string; scale: number } {
  if (!cfg.enabled) {
    return { allowed: true, reason: 'GATE_DISABLED', scale: 1 };
  }

  const c = conf ?? 0;

  if (c < cfg.minFlipConfidence) {
    return { 
      allowed: false, 
      reason: `FLIP_CONF_TOO_LOW (${(c * 100).toFixed(0)}% < ${(cfg.minFlipConfidence * 100).toFixed(0)}%)`,
      scale: 0 
    };
  }

  const scale = confidenceScale(c, cfg);
  return { allowed: true, reason: 'FLIP_GATE_PASSED', scale };
}

/**
 * Format gate config for logging
 */
export function formatGateConfig(cfg: GateConfig): string {
  return `enter=${(cfg.minEnterConfidence * 100).toFixed(0)}% full=${(cfg.minFullSizeConfidence * 100).toFixed(0)}% flip=${(cfg.minFlipConfidence * 100).toFixed(0)}% soft=${cfg.softGate}`;
}
