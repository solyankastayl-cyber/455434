/**
 * G3 Behavioral AML Service
 * 
 * Orchestrates behavioral money laundering pattern detection
 */

import { Db } from 'mongodb';
import { BehavioralSignal } from './behavioral.types.js';
import { detectPeelChain } from './peel_chain.detector.js';
import { detectRoundTripping } from './round_tripping.detector.js';
import { detectStructuring } from './structuring.detector.js';

export interface BehavioralAnalysisParams {
  network: string;
  address: string;
  nowTs?: number;
}

export interface BehavioralAnalysisResult {
  signals: BehavioralSignal[];
  summary: {
    totalSignals: number;
    maxSeverity: string | null;
    maxConfidence: number;
    patternTypes: string[];
  };
  meta: {
    network: string;
    address: string;
    computeTimeMs: number;
    detectors: string[];
  };
}

export class G3BehavioralService {
  constructor(private db: Db) {}

  /**
   * Run behavioral AML analysis
   */
  async analyze(params: BehavioralAnalysisParams): Promise<BehavioralAnalysisResult> {
    const startTime = Date.now();
    const { network, address, nowTs } = params;

    // Run all detectors in parallel
    const [peelChain, roundTripping, structuring] = await Promise.all([
      detectPeelChain(this.db, { network, address, nowTs }),
      detectRoundTripping(this.db, { network, address, nowTs }),
      detectStructuring(this.db, { network, address, nowTs }),
    ]);

    const signals = [...peelChain, ...roundTripping, ...structuring];

    // Sort by severity then confidence
    signals.sort((a, b) => {
      const sevRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      const aDiff = sevRank[a.severity] - sevRank[b.severity];
      if (aDiff !== 0) return -aDiff;
      return b.confidence - a.confidence;
    });

    // Build summary
    const patternTypes = Array.from(new Set(signals.map((s) => s.type)));
    const maxSeverity = signals.length > 0 ? signals[0].severity : null;
    const maxConfidence = signals.length > 0 ? signals[0].confidence : 0;

    return {
      signals,
      summary: {
        totalSignals: signals.length,
        maxSeverity,
        maxConfidence,
        patternTypes,
      },
      meta: {
        network,
        address,
        computeTimeMs: Date.now() - startTime,
        detectors: ['PEEL_CHAIN', 'ROUND_TRIPPING', 'STRUCTURING'],
      },
    };
  }
}
