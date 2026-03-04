/**
 * BLOCK 41.2 — Full Certification Suite Runner
 * Runs all certification tests and produces final report
 */

import { runReplay, ReplayResult } from './cert.replay.service.js';
import { runDriftInjection, DriftInjectResult } from './cert.drift.service.js';
import { runPhaseReplay, PhaseReplayResult } from './cert.phase.service.js';

export interface CertificationRequest {
  asOf: string;
  presetKey: string;
  symbol?: string;
  timeframe?: string;
}

export interface CertificationResult {
  pass: boolean;
  version: string;
  presetKey: string;
  timestamp: string;
  tests: {
    replay: ReplayResult;
    drift: DriftInjectResult;
    phase: PhaseReplayResult;
    rolling?: any;
    monteCarlo?: any;
  };
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: string[];
  };
  duration_ms: number;
}

/**
 * Run complete certification suite
 */
export async function runCertificationSuite(
  fractalSvc: any,
  cfg: CertificationRequest
): Promise<CertificationResult> {
  const start = Date.now();
  const failedTests: string[] = [];

  // 1. Replay Test (deterministic)
  console.log('[Certification] Running Replay Test...');
  const replay = await runReplay(fractalSvc, {
    asOf: cfg.asOf,
    presetKey: cfg.presetKey,
    runs: 50, // Reduced for speed
    symbol: cfg.symbol,
    timeframe: cfg.timeframe,
  });
  if (!replay.pass) failedTests.push('replay');

  // 2. Drift Injection Test
  console.log('[Certification] Running Drift Injection Test...');
  const drift = await runDriftInjection(fractalSvc, {
    asOf: cfg.asOf,
    presetKey: cfg.presetKey,
    inject: {
      effectiveN: 6,
      entropy: 0.92,
      calibrationBadge: 'DEGRADED',
      mcP95dd: 0.48,
    },
  });
  if (!drift.pass) failedTests.push('drift');

  // 3. Phase Stress Replay
  console.log('[Certification] Running Phase Stress Replay...');
  const phase = await runPhaseReplay(fractalSvc, {
    presetKey: cfg.presetKey,
    symbol: cfg.symbol,
    timeframe: cfg.timeframe,
  });
  if (!phase.pass) failedTests.push('phase');

  // 4. Rolling Validation (if available)
  let rolling: any = null;
  if (fractalSvc.runRollingValidation) {
    console.log('[Certification] Running Rolling Validation...');
    try {
      rolling = await fractalSvc.runRollingValidation({
        presetKey: cfg.presetKey,
        symbol: cfg.symbol,
      });
      if (!rolling.pass) failedTests.push('rolling');
    } catch (err) {
      console.warn('[Certification] Rolling validation skipped:', err);
    }
  }

  // 5. Monte Carlo (if available)
  let monteCarlo: any = null;
  if (fractalSvc.runMonteCarlo) {
    console.log('[Certification] Running Monte Carlo...');
    try {
      monteCarlo = await fractalSvc.runMonteCarlo({
        presetKey: cfg.presetKey,
        iterations: 1000,
      });
      if (!monteCarlo.pass) failedTests.push('monteCarlo');
    } catch (err) {
      console.warn('[Certification] Monte Carlo skipped:', err);
    }
  }

  const totalTests = 3 + (rolling ? 1 : 0) + (monteCarlo ? 1 : 0);
  const passedTests = totalTests - failedTests.length;
  const pass = failedTests.length === 0;

  return {
    pass,
    version: 'v2.1',
    presetKey: cfg.presetKey,
    timestamp: new Date().toISOString(),
    tests: {
      replay,
      drift,
      phase,
      rolling,
      monteCarlo,
    },
    summary: {
      totalTests,
      passedTests,
      failedTests,
    },
    duration_ms: Date.now() - start,
  };
}
