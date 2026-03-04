/**
 * L3.4 — State Integrity Guard
 * 
 * Validates and normalizes lifecycle state after any update.
 * Ensures invariants are never broken.
 */

import { ModelId, LifecycleStatus, DriftSeverity, ModelLifecycleState } from './lifecycle.types.js';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export interface IntegrityCheckResult {
  valid: boolean;
  fixes: string[];
  state: Partial<ModelLifecycleState>;
}

/**
 * Enforces all lifecycle invariants and returns normalized state
 */
export function enforceIntegrity(
  before: ModelLifecycleState | null,
  after: Partial<ModelLifecycleState>
): IntegrityCheckResult {
  const fixes: string[] = [];
  const s = { ...after };

  // 1) DEV mode cannot have APPLIED status
  if (s.systemMode === 'DEV' && s.status === 'APPLIED') {
    s.status = 'SIMULATION';
    fixes.push('DEV_APPLIED_FORBIDDEN→SIMULATION');
  }

  // 2) WARMUP requires warmup block
  if (s.status === 'WARMUP') {
    const w = s.warmup;
    if (!w || !w.startedAt) {
      s.warmup = {
        startedAt: new Date().toISOString(),
        targetDays: 30,
        resolvedDays: 0,
        progressPct: 0,
      };
      fixes.push('WARMUP_FIELDS_CREATED');
    } else {
      const targetDays = w.targetDays || 30;
      const resolvedDays = w.resolvedDays || 0;
      const pct = clamp(Math.round((resolvedDays / targetDays) * 100), 0, 100);

      s.warmup = {
        startedAt: w.startedAt,
        targetDays,
        resolvedDays,
        progressPct: pct,
      };
    }
  }

  // 3) APPLIED in PROD requires: liveSamples >= 30, drift != CRITICAL
  if (s.status === 'APPLIED' && s.systemMode === 'PROD') {
    const liveSamples = s.live?.liveSamples || 0;
    const driftSeverity = s.drift?.severity || 'OK';
    
    if (liveSamples < 30 || driftSeverity === 'CRITICAL') {
      // Downgrade to WARMUP
      s.status = 'WARMUP';
      s.warmup = {
        startedAt: new Date().toISOString(),
        targetDays: 30,
        resolvedDays: Math.min(liveSamples, 30),
        progressPct: clamp(Math.round((Math.min(liveSamples, 30) / 30) * 100), 0, 100),
      };
      fixes.push(`APPLIED_INVALID→WARMUP(samples=${liveSamples},drift=${driftSeverity})`);
    }
  }

  // 4) REVOKED should clear warmup
  if (s.status === 'REVOKED' && s.warmup) {
    // Keep warmup info for audit, but mark as inactive
  }

  return {
    valid: fixes.length === 0,
    fixes,
    state: s,
  };
}

/**
 * L3.4.2 - Action Guard
 * Validates if action is allowed given current state
 */
export function assertActionAllowed(
  state: ModelLifecycleState | null,
  action: 'START_WARMUP' | 'FORCE_APPLY' | 'REVOKE' | 'RESET' | 'CONSTITUTION_APPLY',
  actor: 'SYSTEM' | 'ADMIN'
): { allowed: boolean; error?: string } {
  if (!state) {
    return { allowed: true }; // New state, always allowed
  }

  // RESET is DEV-only
  if (action === 'RESET' && state.systemMode !== 'DEV') {
    return { allowed: false, error: 'RESET is DEV-only' };
  }

  // FORCE_APPLY checks
  if (action === 'FORCE_APPLY') {
    if (state.systemMode === 'PROD' && state.drift?.severity === 'CRITICAL') {
      return { allowed: false, error: 'FORCE_APPLY blocked: drift CRITICAL' };
    }
  }

  // START_WARMUP not needed if already APPLIED
  if (action === 'START_WARMUP') {
    if (state.status === 'APPLIED' || state.status === 'APPLIED_MANUAL') {
      return { allowed: false, error: 'Already APPLIED' };
    }
  }

  return { allowed: true };
}

console.log('[Lifecycle] Integrity Guard loaded (L3.4)');
