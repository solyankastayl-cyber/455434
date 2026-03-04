/**
 * BLOCK 41.5 — Certification Stamp + Freeze
 * Locks a preset after successful certification
 */

import crypto from 'crypto';

export interface FreezeRequest {
  presetKey: string;
  certificationReport: any;
}

export interface FreezeResult {
  status: 'FROZEN' | 'FAILED';
  stamp?: {
    presetKey: string;
    presetHash: string;
    certifiedAt: string;
    version: string;
    reportHash: string;
  };
  error?: string;
}

/**
 * Freeze a certified preset (make immutable)
 */
export async function freezeCertification(
  fractalSvc: any,
  req: FreezeRequest
): Promise<FreezeResult> {
  try {
    // 1. Get current preset config
    const preset = await fractalSvc.getPreset?.(req.presetKey);
    if (!preset) {
      return {
        status: 'FAILED',
        error: `Preset '${req.presetKey}' not found`,
      };
    }

    // 2. Verify certification passed
    if (!req.certificationReport?.pass) {
      return {
        status: 'FAILED',
        error: 'Cannot freeze: certification did not pass',
      };
    }

    // 3. Generate hashes
    const presetHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(preset))
      .digest('hex');

    const reportHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(req.certificationReport))
      .digest('hex');

    // 4. Create certification stamp
    const stamp = {
      presetKey: req.presetKey,
      presetHash,
      certifiedAt: new Date().toISOString(),
      version: 'v2.1',
      reportHash,
    };

    // 5. Lock preset in storage
    if (fractalSvc.lockPreset) {
      await fractalSvc.lockPreset(req.presetKey, stamp);
    }

    console.log(`[Certification] Preset '${req.presetKey}' FROZEN with hash ${presetHash.slice(0, 8)}`);

    return {
      status: 'FROZEN',
      stamp,
    };
  } catch (err) {
    console.error('[Certification] Freeze failed:', err);
    return {
      status: 'FAILED',
      error: String(err),
    };
  }
}
