/**
 * G2 Cybercrime Hunter Service
 * 
 * Main orchestrator for cybercrime detection
 * Runs all detectors (transfers + relations based) and merges results
 */

import { Db } from 'mongodb';
import { IntelligenceSignal } from '../types.js';
import { detectRapidDrain } from './detectors/rapid_drain.detector.js';
import { detectBridgeEscape } from './detectors/bridge_escape.detector.js';
import { detectFunnel } from './detectors/funnel.detector.js';
import { detectDispersal } from './detectors/dispersal.detector.js';
import { mergeSignals, createSummary } from './signal_merge.js';

export interface G2AnalysisParams {
  network: string;
  address: string;
  nowTs?: number;
  source?: 'auto' | 'transfers' | 'relations';
}

export interface G2AnalysisResult {
  signals: IntelligenceSignal[];
  summary: {
    maxSeverity: IntelligenceSignal['severity'] | null;
    maxConfidence: number;
    countsByType: Record<string, number>;
    countsBySeverity: Record<IntelligenceSignal['severity'], number>;
    lastComputedTs: number;
  };
  meta: {
    network: string;
    address: string;
    source: string;
    detectors: string[];
    computeTimeMs: number;
  };
}

export class G2CybercrimeService {
  constructor(private db: Db) {}

  /**
   * Run full cybercrime analysis for an address
   */
  async analyze(params: G2AnalysisParams): Promise<G2AnalysisResult> {
    const startTime = Date.now();
    const { network, address, nowTs, source = 'auto' } = params;

    const detectors: string[] = [];
    const allSignals: IntelligenceSignal[] = [];

    // Transfers-based detectors
    if (source === 'auto' || source === 'transfers') {
      detectors.push('RAPID_DRAIN', 'BRIDGE_ESCAPE');

      const [rapidDrain, bridgeEscape] = await Promise.all([
        detectRapidDrain(this.db, { network, address, nowTs }),
        detectBridgeEscape(this.db, { network, address, nowTs }),
      ]);

      allSignals.push(...rapidDrain, ...bridgeEscape);
    }

    // Relations-based detectors
    if (source === 'auto' || source === 'relations') {
      detectors.push('FUNNEL', 'DISPERSAL');

      const [funnel, dispersal] = await Promise.all([
        detectFunnel(this.db, { network, address, nowTs }),
        detectDispersal(this.db, { network, address, nowTs }),
      ]);

      allSignals.push(...funnel, ...dispersal);
    }

    // Merge and sort signals
    const signals = mergeSignals(allSignals);
    const summary = createSummary(signals);

    const computeTimeMs = Date.now() - startTime;

    return {
      signals,
      summary,
      meta: {
        network,
        address,
        source,
        detectors,
        computeTimeMs,
      },
    };
  }

  /**
   * Run analysis for multiple addresses (batch)
   */
  async analyzeBatch(
    addresses: Array<{ network: string; address: string }>,
    nowTs?: number
  ): Promise<Map<string, G2AnalysisResult>> {
    const results = new Map<string, G2AnalysisResult>();

    // Run in parallel (with reasonable concurrency limit)
    const BATCH_SIZE = 5;
    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const promises = batch.map((addr) =>
        this.analyze({ ...addr, nowTs })
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
