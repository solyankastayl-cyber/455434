/**
 * C1 — Alignment Service
 * 
 * Core computation for Exchange × Sentiment Alignment.
 * 
 * RULES (LOCKED v1):
 * - Pure computation, no side effects
 * - No DB writes
 * - No network calls
 * - Deterministic output
 */

import {
  AlignmentConfig,
  AlignmentResult,
  AlignmentType,
  ExchangeLayerInput,
  SentimentLayerInput,
  DirectionVerdict,
  DEFAULT_ALIGNMENT_CONFIG,
} from './alignment.contracts.js';
import { buildExplanation } from './alignment.explain.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function dir(v: DirectionVerdict): -1 | 0 | 1 {
  if (v === 'BULLISH') return 1;
  if (v === 'BEARISH') return -1;
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT SERVICE
// ═══════════════════════════════════════════════════════════════

export class AlignmentService {
  private cfg: AlignmentConfig;
  
  constructor(cfg?: Partial<AlignmentConfig>) {
    this.cfg = { ...DEFAULT_ALIGNMENT_CONFIG, ...cfg };
  }
  
  /**
   * Compute alignment between Exchange and Sentiment layers.
   * 
   * @param symbol - Trading pair (e.g., "BTCUSDT")
   * @param t0ISO - Timestamp in ISO format
   * @param exchange - Exchange layer verdict
   * @param sentiment - Sentiment layer verdict
   * @returns AlignmentResult
   */
  compute(
    symbol: string,
    t0ISO: string,
    exchange: ExchangeLayerInput,
    sentiment: SentimentLayerInput
  ): AlignmentResult {
    // ─────────────────────────────────────────────────────────────
    // 1) Gating: Are layers usable?
    // ─────────────────────────────────────────────────────────────
    
    const exchangeReady =
      exchange.readiness === 'READY' &&
      exchange.confidence >= this.cfg.minExchangeConfidence;
    
    const sentimentUsable =
      Boolean(sentiment.usable) &&
      sentiment.confidence >= this.cfg.minSentimentConfidence;
    
    // ─────────────────────────────────────────────────────────────
    // 2) Determine alignment type
    // ─────────────────────────────────────────────────────────────
    
    let type: AlignmentType;
    
    if (!exchangeReady && !sentimentUsable) {
      type = 'NO_DATA';
    } else if (exchangeReady && !sentimentUsable) {
      type = 'EXCHANGE_ONLY';
    } else if (!exchangeReady && sentimentUsable) {
      type = 'SENTIMENT_ONLY';
    } else {
      // Both usable - compare directions
      const de = dir(exchange.verdict);
      const ds = dir(sentiment.verdict);
      
      if (de === 0 && ds === 0) {
        type = 'IGNORED';
      } else if (de === ds) {
        type = 'CONFIRMED';
      } else {
        type = 'CONTRADICTED';
      }
    }
    
    // ─────────────────────────────────────────────────────────────
    // 3) Compute strength (0..1)
    // ─────────────────────────────────────────────────────────────
    
    const base = clamp(
      Math.min(exchange.confidence ?? 0, sentiment.confidence ?? 0),
      0,
      1
    );
    
    const directionBonus =
      type === 'CONFIRMED' ? 0.25 :
      type === 'CONTRADICTED' ? -0.25 :
      0;
    
    const readinessPenalty =
      exchange.readiness === 'READY' ? 0 : -0.2;
    
    const strength = clamp(base + directionBonus + readinessPenalty, 0, 1);
    
    // ─────────────────────────────────────────────────────────────
    // 4) Compute trustShift (-1..+1)
    // NOTE: This is a HINT for C3/Meta-Brain, not applied here
    // ─────────────────────────────────────────────────────────────
    
    let trustShift = 0;
    
    if (type === 'CONFIRMED') {
      trustShift = +clamp(0.2 + 0.6 * strength, 0, 0.8);
    } else if (type === 'CONTRADICTED') {
      trustShift = -clamp(0.4 + 0.6 * strength, 0, 1.0);
    } else if (type === 'IGNORED') {
      trustShift = -clamp(0.1 + 0.2 * strength, 0, 0.4);
    }
    // EXCHANGE_ONLY, SENTIMENT_ONLY, NO_DATA → trustShift = 0
    
    // ─────────────────────────────────────────────────────────────
    // 5) Build explanation and drivers
    // ─────────────────────────────────────────────────────────────
    
    const explain = buildExplanation({ type, exchange, sentiment });
    
    // ─────────────────────────────────────────────────────────────
    // 6) Return result
    // ─────────────────────────────────────────────────────────────
    
    return {
      symbol,
      t0: t0ISO,
      exchange,
      sentiment,
      alignment: {
        type,
        strength,
        trustShift,
        explanation: explain.explanation,
        drivers: {
          exchangeDrivers: explain.exchangeDrivers,
          sentimentDrivers: explain.sentimentDrivers,
          conflictDrivers: explain.conflictDrivers,
        },
      },
      updatedAt: new Date().toISOString(),
    };
  }
  
  /**
   * Get current config
   */
  getConfig(): AlignmentConfig {
    return { ...this.cfg };
  }
}

// Singleton instance with default config
export const alignmentService = new AlignmentService();

console.log('[C1] Alignment Service loaded');
