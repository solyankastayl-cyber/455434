/**
 * BLOCK 41.3 — Drift Injection Tests
 * Verifies reliability system responds correctly to degraded conditions
 */

export interface DriftInjectRequest {
  asOf: string;
  presetKey: string;
  inject: {
    effectiveN?: number;
    entropy?: number;
    calibrationBadge?: 'OK' | 'DEGRADED' | 'CRITICAL';
    mcP95dd?: number;
  };
}

export interface DriftInjectResult {
  pass: boolean;
  baseline: {
    confidence: number;
    exposure: number;
    reliabilityBadge: string;
  };
  injected: {
    confidence: number;
    exposure: number;
    reliabilityBadge: string;
  };
  checks: {
    confidenceReduced: boolean;
    exposureReduced: boolean;
    reliabilityDegraded: boolean;
  };
  duration_ms: number;
}

/**
 * Test reliability system by injecting degraded conditions
 */
export async function runDriftInjection(
  fractalSvc: any,
  req: DriftInjectRequest
): Promise<DriftInjectResult> {
  const start = Date.now();

  // 1. Get baseline signal (normal conditions)
  const baseline = await fractalSvc.getSignal({
    symbol: 'BTCUSD',
    timeframe: '1d',
    asOf: req.asOf,
    presetKey: req.presetKey,
  });

  // 2. Get signal with injected drift conditions
  const injected = await fractalSvc.getSignal({
    symbol: 'BTCUSD',
    timeframe: '1d',
    asOf: req.asOf,
    presetKey: req.presetKey,
    _driftInject: req.inject, // Internal flag for testing
  });

  // 3. Validate responses
  const baselineConf = baseline.confidence ?? baseline.ensemble?.score ?? 0.5;
  const injectedConf = injected.confidence ?? injected.ensemble?.score ?? 0.5;

  const baselineExp = baseline.exposure ?? baseline.risk?.finalExposure ?? 1;
  const injectedExp = injected.exposure ?? injected.risk?.finalExposure ?? 1;

  const baselineBadge = baseline.reliabilityBadge ?? 'OK';
  const injectedBadge = injected.reliabilityBadge ?? 'OK';

  const checks = {
    confidenceReduced: injectedConf < baselineConf,
    exposureReduced: injectedExp <= baselineExp,
    reliabilityDegraded:
      injectedBadge === 'DEGRADED' ||
      injectedBadge === 'CRITICAL' ||
      injectedBadge === 'WARN',
  };

  // Pass if at least 2 of 3 checks pass (system is responsive)
  const passCount = Object.values(checks).filter(Boolean).length;
  const pass = passCount >= 2;

  return {
    pass,
    baseline: {
      confidence: baselineConf,
      exposure: baselineExp,
      reliabilityBadge: baselineBadge,
    },
    injected: {
      confidence: injectedConf,
      exposure: injectedExp,
      reliabilityBadge: injectedBadge,
    },
    checks,
    duration_ms: Date.now() - start,
  };
}
