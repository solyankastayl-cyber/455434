/**
 * BLOCK 34.2: Simulation Overrides
 * Direct parameter overrides for sweep experiments
 */

export interface SimOverrides {
  dd?: {
    soft?: number;
    hard?: number;
  };
  risk?: {
    taper?: number;           // Exposure taper intensity (0.5-1.0)
    taperPower?: number;      // Taper curve power (1.0 = linear, 1.5 = aggressive)
    minMult?: number;         // Minimum multiplier at hard DD
  };
  position?: {
    enterThreshold?: number;
    exitThreshold?: number;
    minHoldDays?: number;
    maxHoldDays?: number;
    coolDownDays?: number;
  };
  // BLOCK 35.4: Cost/Slippage stress testing
  costMultiplier?: number;    // 1.0 default, use 1.5/2/3 for stress tests
}

/**
 * Apply overrides to base settings
 * Non-destructive: creates new object
 */
export function applyOverrides(baseSettings: any, overrides?: SimOverrides): any {
  if (!overrides) return baseSettings;

  // Deep clone base settings
  const settings = JSON.parse(JSON.stringify(baseSettings || {}));

  // Apply DD overrides
  if (overrides.dd) {
    if (!settings.ddModel) settings.ddModel = {};
    if (overrides.dd.soft != null) settings.ddModel.softDD = overrides.dd.soft;
    if (overrides.dd.hard != null) settings.ddModel.hardDD = overrides.dd.hard;
  }

  // Apply risk overrides
  if (overrides.risk) {
    if (!settings.ddModel) settings.ddModel = {};
    if (overrides.risk.taper != null) settings.ddModel.exposureTaper = overrides.risk.taper;
    if (overrides.risk.taperPower != null) settings.ddModel.taperPower = overrides.risk.taperPower;
    if (overrides.risk.minMult != null) settings.ddModel.minMult = overrides.risk.minMult;
  }

  // Apply position overrides
  if (overrides.position) {
    if (!settings.positionModel) settings.positionModel = {};
    if (overrides.position.enterThreshold != null) settings.positionModel.enterThreshold = overrides.position.enterThreshold;
    if (overrides.position.exitThreshold != null) settings.positionModel.exitThreshold = overrides.position.exitThreshold;
    if (overrides.position.minHoldDays != null) settings.positionModel.minHoldDays = overrides.position.minHoldDays;
    if (overrides.position.maxHoldDays != null) settings.positionModel.maxHoldDays = overrides.position.maxHoldDays;
    if (overrides.position.coolDownDays != null) settings.positionModel.coolDownDays = overrides.position.coolDownDays;
  }

  return settings;
}

/**
 * Merge two override objects
 */
export function mergeOverrides(base: SimOverrides, extra: SimOverrides): SimOverrides {
  return {
    dd: { ...base.dd, ...extra.dd },
    risk: { ...base.risk, ...extra.risk },
    position: { ...base.position, ...extra.position }
  };
}

/**
 * Format overrides for logging/display
 */
export function formatOverrides(o: SimOverrides): string {
  const parts: string[] = [];
  if (o.dd?.soft != null) parts.push(`soft=${(o.dd.soft * 100).toFixed(0)}%`);
  if (o.dd?.hard != null) parts.push(`hard=${(o.dd.hard * 100).toFixed(0)}%`);
  if (o.risk?.taper != null) parts.push(`taper=${o.risk.taper}`);
  if (o.costMultiplier != null && o.costMultiplier !== 1.0) parts.push(`cost×${o.costMultiplier}`);
  return parts.join(', ') || 'default';
}

/**
 * BLOCK 35.4: Cost model for slippage stress testing
 * Base costs (in bps):
 * - feeBps: 4 (exchange fee)
 * - slippageBps: 6 (market impact)
 * - spreadBps: 2 (bid-ask spread)
 * Total round-trip: 24 bps = 0.24%
 */
export interface CostModel {
  feeBps: number;
  slippageBps: number;
  spreadBps: number;
}

export const BASE_COSTS: CostModel = {
  feeBps: 4,
  slippageBps: 6,
  spreadBps: 2,
};

/**
 * Apply cost multiplier for stress testing
 */
export function applyCostMultiplier(costs: CostModel, mult: number): CostModel {
  return {
    feeBps: costs.feeBps * mult,
    slippageBps: costs.slippageBps * mult,
    spreadBps: costs.spreadBps * mult,
  };
}

/**
 * Get total round-trip cost in decimal form
 */
export function getRoundTripCost(costs: CostModel): number {
  return 2 * (costs.feeBps + costs.slippageBps + costs.spreadBps) / 10000;
}
