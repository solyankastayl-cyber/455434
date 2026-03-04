/**
 * G3 AML/KYT Service
 * 
 * Main orchestrator for AML compliance and KYT risk assessment
 */

import { Db } from 'mongodb';
import { performance } from 'perf_hooks';
import { G3_CONFIG } from './g3.config.js';
import { AmlCheckResult, Network } from './g3.types.js';
import { checkSanctionsExact } from './sources/sanctions.source.js';
import { computeExposure } from './analyzers/exposure.analyzer.js';
import { computeRiskScore } from './verdict/risk_score.js';
import { verdictFromScore } from './verdict/aml_verdict.js';

export interface AmlCheckParams {
  network: Network;
  address: string;
  window?: '7d' | '30d';
}

export class G3AmlService {
  constructor(private db: Db) {}

  /**
   * Perform complete AML/KYT check for an address
   */
  async check(params: AmlCheckParams): Promise<AmlCheckResult> {
    const t0 = performance.now();

    const network = params.network;
    const address = params.address.toLowerCase();
    const window = params.window || G3_CONFIG.windowDefault;

    // Step 1: Check sanctions (hard stop if sanctioned)
    const sanctions = await checkSanctionsExact(this.db, network, address);

    if (sanctions.isSanctioned) {
      // Immediate CRITICAL verdict for sanctioned addresses
      return {
        network,
        address,
        sanctions,
        exposure: {
          byBucketShare: {
            CEX: 0,
            BRIDGE: 0,
            MIXER: 0,
            DEFI: 0,
            HIGH_RISK: 0,
            SANCTIONED: 1,
            UNKNOWN: 0,
          },
          topCounterparties: [],
          totals: {
            totalVolumeUsd: 0,
            totalTxCount: 0,
            uniqueCounterparties: 0,
          },
        },
        riskScore: 100,
        verdict: 'CRITICAL',
        flags: ['SANCTIONED_ADDRESS'],
        evidence: [
          {
            kind: 'RULE',
            text: `Address is on sanctions list(s): ${sanctions.lists.join(', ')}`,
          },
        ],
        meta: {
          computeTimeMs: Math.round(performance.now() - t0),
          window,
          usedSources: ['sanctions'],
        },
      };
    }

    // Step 2: Analyze counterparty exposure
    const exposure = await computeExposure(this.db, network, address, window);

    // Step 3: Calculate risk score
    const riskScore = computeRiskScore(exposure);

    // Step 4: Determine verdict
    const verdict = verdictFromScore(riskScore);

    // Step 5: Generate flags
    const flags: string[] = [];
    const s = exposure.byBucketShare;

    if (s.SANCTIONED > G3_CONFIG.exposureThresholds.sanctionedAny) {
      flags.push('SANCTIONED_EXPOSURE');
    }

    if (s.MIXER >= G3_CONFIG.exposureThresholds.mixerHigh) {
      flags.push('MIXER_EXPOSURE');
    }

    if (s.MIXER >= G3_CONFIG.exposureThresholds.mixerCritical) {
      flags.push('MIXER_EXPOSURE_CRITICAL');
    }

    if (s.BRIDGE >= G3_CONFIG.exposureThresholds.bridgeHigh) {
      flags.push('BRIDGE_HEAVY');
    }

    if (s.HIGH_RISK >= G3_CONFIG.exposureThresholds.highRiskHigh) {
      flags.push('HIGH_RISK_COUNTERPARTIES');
    }

    // Step 6: Build evidence
    const evidence = [
      {
        kind: 'NOTE' as const,
        text: `Analysis window: ${window}. Total volume: $${Math.round(exposure.totals.totalVolumeUsd).toLocaleString()} across ${exposure.totals.uniqueCounterparties} unique counterparties.`,
      },
      {
        kind: 'NOTE' as const,
        text: `Exposure breakdown: Mixer ${(s.MIXER * 100).toFixed(1)}%, Bridge ${(s.BRIDGE * 100).toFixed(1)}%, CEX ${(s.CEX * 100).toFixed(1)}%, High-Risk ${(s.HIGH_RISK * 100).toFixed(1)}%, Unknown ${(s.UNKNOWN * 100).toFixed(1)}%.`,
      },
    ];

    if (flags.length > 0) {
      evidence.push({
        kind: 'RULE' as const,
        text: `Flags triggered: ${flags.join(', ')}`,
      });
    }

    return {
      network,
      address,
      sanctions,
      exposure,
      riskScore,
      verdict,
      flags,
      evidence,
      meta: {
        computeTimeMs: Math.round(performance.now() - t0),
        window,
        usedSources: ['relations', 'labels', 'watchlists', 'sanctions'],
      },
    };
  }

  /**
   * Batch check multiple addresses
   */
  async checkBatch(
    addresses: Array<{ network: Network; address: string }>,
    window?: '7d' | '30d'
  ): Promise<Map<string, AmlCheckResult>> {
    const results = new Map<string, AmlCheckResult>();

    // Process in parallel with concurrency limit
    const BATCH_SIZE = 5;
    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const promises = batch.map((addr) =>
        this.check({ ...addr, window })
      );

      const batchResults = await Promise.all(promises);
      batch.forEach((addr, idx) => {
        const key = `${addr.network}:${addr.address}`;
        results.set(key, batchResults[idx]);
      });
    }

    return results;
  }
}
