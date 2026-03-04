/**
 * PHASE 2.1 — Feature Snapshot Builder
 * ======================================
 * 
 * Collects system state at time t0 from all sources:
 * - Exchange verdict
 * - Sentiment verdict
 * - Onchain validation
 * - Meta-Brain decision
 * 
 * RULE: NO future price data allowed!
 */

import {
  FeatureSnapshot,
  ExchangeContext,
  SentimentContext,
  OnchainContext,
  MetaBrainContext,
  VerdictDirection,
  WhaleRisk,
  Readiness,
  Alignment,
  Validation,
} from './featureSnapshot.types.js';

// ═══════════════════════════════════════════════════════════════
// EXCHANGE CONTEXT FETCHER
// ═══════════════════════════════════════════════════════════════

async function fetchExchangeContext(symbol: string): Promise<ExchangeContext> {
  try {
    const response = await fetch(`http://localhost:8003/api/v10/exchange/verdict/${symbol}`);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.verdict) {
        const v = data.verdict;
        // Extract readiness status from object
        const readinessStatus = typeof v.readiness === 'object' 
          ? v.readiness.status 
          : v.readiness;
        
        // Extract whale risk from evidence
        const whaleRisk = v.evidence?.whales?.riskBucket || 'UNKNOWN';
        
        return {
          verdict: v.verdict as VerdictDirection,
          confidence: v.confidence || 0.5,
          regime: v.evidence?.regime?.type?.type || 'UNKNOWN',
          stress: v.evidence?.stress || 0,
          patterns: v.evidence?.patterns || [],
          whaleRisk: whaleRisk as WhaleRisk,
          readiness: readinessStatus as Readiness || 'DEGRADED',
        };
      }
    }
  } catch (error) {
    console.error('[FeatureBuilder] Failed to fetch Exchange context:', error);
  }

  // Fallback: generate deterministic mock based on symbol
  return generateMockExchangeContext(symbol);
}

function generateMockExchangeContext(symbol: string): ExchangeContext {
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = hash % 100;

  let verdict: VerdictDirection = 'NEUTRAL';
  let confidence = 0.5;

  if (seed < 35) {
    verdict = 'BULLISH';
    confidence = 0.5 + (seed % 35) / 70;
  } else if (seed < 70) {
    verdict = 'BEARISH';
    confidence = 0.5 + ((seed - 35) % 35) / 70;
  } else {
    verdict = 'NEUTRAL';
    confidence = 0.4 + ((seed - 70) % 30) / 100;
  }

  const regimes = ['ACCUMULATION', 'DISTRIBUTION', 'EXPANSION', 'EXHAUSTION', 'NEUTRAL'];
  const regime = regimes[hash % regimes.length];

  const stress = (hash % 60) / 100;
  const whaleRisks: WhaleRisk[] = ['LOW', 'MID', 'HIGH'];
  const whaleRisk = whaleRisks[hash % 3];

  return {
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    regime,
    stress: Math.round(stress * 100) / 100,
    patterns: [],
    whaleRisk,
    readiness: confidence > 0.6 ? 'READY' : 'RISKY',
  };
}

// ═══════════════════════════════════════════════════════════════
// SENTIMENT CONTEXT FETCHER
// ═══════════════════════════════════════════════════════════════

async function fetchSentimentContext(
  symbol: string,
  exchangeVerdict: VerdictDirection
): Promise<SentimentContext> {
  try {
    const response = await fetch(`http://localhost:8003/api/v10/fusion/sentiment/${symbol}`);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.sentiment) {
        return {
          verdict: data.sentiment.verdict as VerdictDirection,
          confidence: data.sentiment.confidence || 0,
          alignment: computeAlignment(exchangeVerdict, data.sentiment.verdict),
        };
      }
    }
  } catch (error) {
    console.error('[FeatureBuilder] Failed to fetch Sentiment context:', error);
  }

  // Fallback: mock sentiment
  return generateMockSentimentContext(symbol, exchangeVerdict);
}

function generateMockSentimentContext(
  symbol: string,
  exchangeVerdict: VerdictDirection
): SentimentContext {
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = (hash * 7) % 100;

  // 60% chance sentiment aligns with exchange
  let verdict: VerdictDirection;
  if (seed < 60) {
    verdict = exchangeVerdict;
  } else if (seed < 80) {
    verdict = 'NEUTRAL';
  } else {
    verdict = exchangeVerdict === 'BULLISH' ? 'BEARISH' : 'BULLISH';
  }

  const confidence = 0.3 + (seed % 50) / 100;

  return {
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    alignment: computeAlignment(exchangeVerdict, verdict),
  };
}

function computeAlignment(exchange: VerdictDirection, sentiment: VerdictDirection): Alignment {
  if (exchange === 'NO_DATA' || sentiment === 'NO_DATA') return 'NO_DATA';
  if (exchange === sentiment) return 'ALIGNED';
  if (exchange === 'NEUTRAL' || sentiment === 'NEUTRAL') return 'PARTIAL';
  return 'CONFLICT';
}

// ═══════════════════════════════════════════════════════════════
// ONCHAIN CONTEXT FETCHER
// ═══════════════════════════════════════════════════════════════

async function fetchOnchainContext(
  symbol: string,
  exchangeVerdict: VerdictDirection
): Promise<OnchainContext> {
  try {
    const response = await fetch(`http://localhost:8003/api/v10/validation/onchain/${symbol}`);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.validation) {
        return {
          validation: data.validation.result as Validation,
          confidence: data.validation.confidence || 0,
        };
      }
    }
  } catch (error) {
    console.error('[FeatureBuilder] Failed to fetch Onchain context:', error);
  }

  // Fallback: mock onchain
  return generateMockOnchainContext(symbol, exchangeVerdict);
}

function generateMockOnchainContext(
  symbol: string,
  exchangeVerdict: VerdictDirection
): OnchainContext {
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = (hash * 13) % 100;

  let validation: Validation;
  if (seed < 50) {
    validation = 'CONFIRMS';
  } else if (seed < 70) {
    validation = 'NO_DATA';
  } else {
    validation = 'CONTRADICTS';
  }

  const confidence = seed < 70 ? (0.4 + (seed % 40) / 100) : 0;

  return {
    validation,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// META-BRAIN CONTEXT FETCHER
// ═══════════════════════════════════════════════════════════════

async function fetchMetaBrainContext(symbol: string): Promise<MetaBrainContext> {
  try {
    const response = await fetch(`http://localhost:8003/api/v10/meta-brain-v2/decision/${symbol}`);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.decision) {
        return {
          finalVerdict: data.decision.verdict || 'INCONCLUSIVE',
          finalConfidence: data.decision.confidence || 0,
          downgraded: data.decision.downgraded || false,
          downgradedBy: data.decision.downgradedBy || null,
        };
      }
    }
  } catch (error) {
    console.error('[FeatureBuilder] Failed to fetch MetaBrain context:', error);
  }

  // Fallback: mock meta-brain
  return generateMockMetaBrainContext(symbol);
}

function generateMockMetaBrainContext(symbol: string): MetaBrainContext {
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = hash % 100;

  const verdicts = ['STRONG_BULLISH', 'WEAK_BULLISH', 'NEUTRAL', 'WEAK_BEARISH', 'STRONG_BEARISH', 'INCONCLUSIVE'];
  const finalVerdict = verdicts[seed % verdicts.length];
  const finalConfidence = 0.3 + (seed % 60) / 100;
  const downgraded = seed > 70;

  return {
    finalVerdict,
    finalConfidence: Math.round(finalConfidence * 100) / 100,
    downgraded,
    downgradedBy: downgraded ? 'whale_risk' : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// COMPLETENESS CALCULATOR
// ═══════════════════════════════════════════════════════════════

function calculateCompleteness(
  exchange: ExchangeContext,
  sentiment: SentimentContext,
  onchain: OnchainContext
): number {
  let score = 0;
  let total = 0;

  // Exchange (weight: 40%)
  if (exchange.verdict !== 'NO_DATA') {
    score += 0.4;
  }
  total += 0.4;

  // Sentiment (weight: 30%)
  if (sentiment.verdict !== 'NO_DATA') {
    score += 0.3;
  }
  total += 0.3;

  // Onchain (weight: 30%)
  if (onchain.validation !== 'NO_DATA') {
    score += 0.3;
  }
  total += 0.3;

  return Math.round((score / total) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

function generateSnapshotId(): string {
  return `snap_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Build a complete feature snapshot for a symbol at current time (t0)
 */
export async function buildFeatureSnapshot(symbol: string): Promise<FeatureSnapshot> {
  const timestamp = Date.now();
  const normalizedSymbol = symbol.toUpperCase();

  // Fetch all contexts in parallel
  const exchange = await fetchExchangeContext(normalizedSymbol);
  const [sentiment, onchain, metaBrain] = await Promise.all([
    fetchSentimentContext(normalizedSymbol, exchange.verdict),
    fetchOnchainContext(normalizedSymbol, exchange.verdict),
    fetchMetaBrainContext(normalizedSymbol),
  ]);

  // Calculate completeness
  const completeness = calculateCompleteness(exchange, sentiment, onchain);

  // Determine data mode
  let dataMode: 'LIVE' | 'MOCK' | 'MIXED' = 'MOCK';
  // In future, check actual provider sources

  return {
    snapshotId: generateSnapshotId(),
    symbol: normalizedSymbol,
    timestamp,
    exchange,
    sentiment,
    onchain,
    metaBrain,
    meta: {
      dataCompleteness: completeness,
      providers: ['MOCK'], // Will be updated when real providers used
      dataMode,
      version: 'v1',
    },
  };
}

console.log('[Phase 2.1] FeatureSnapshot Builder loaded');
