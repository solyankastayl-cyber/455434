/**
 * C3.3 — Context Builder
 * =======================
 * 
 * Collects inputs from Sentiment, Exchange, and Validation layers.
 * Does NOT compute anything - only orchestration.
 */

import {
  MetaBrainV2Context,
  SentimentInput,
  ExchangeInput,
  ValidationInput,
  VerdictDirection,
} from '../contracts/metaBrainV2.types.js';

// Import from other modules (these would be real imports in production)
// For now, we'll provide mock/default implementations

/**
 * Get Sentiment verdict for symbol at t0
 * TODO: Connect to real Sentiment Engine when available
 */
async function getSentimentVerdict(symbol: string, t0: number): Promise<SentimentInput> {
  // For now, return mock sentiment (MOCK)
  // This will be connected to real Twitter/Sentiment analysis later
  return {
    direction: 'NEUTRAL',
    confidence: 0.4,
    drivers: ['mock_sentiment'],
    source: 'sentiment_mock_v1',
  };
}

/**
 * Get Exchange verdict for symbol at t0
 */
async function getExchangeVerdict(symbol: string, t0: number): Promise<ExchangeInput> {
  try {
    // Try to get from Exchange Verdict Engine
    const response = await fetch(`http://localhost:8003/api/v10/exchange/verdict/${symbol}`);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.verdict) {
        return {
          direction: data.verdict.verdict as VerdictDirection,
          confidence: data.verdict.confidence || 0.5,
          readiness: data.verdict.readiness || 'DEGRADED',
          whaleRisk: data.verdict.whaleRisk || 'MID',
          whaleGuardTriggered: data.verdict.whaleGuardTriggered || false,
          drivers: data.verdict.drivers || [],
        };
      }
    }
  } catch (error) {
    console.error('[MetaBrain] Failed to get Exchange verdict:', error);
  }
  
  // Fallback to mock
  return {
    direction: 'NEUTRAL',
    confidence: 0.3,
    readiness: 'DEGRADED',
    whaleRisk: 'MID',
    drivers: ['exchange_unavailable'],
  };
}

/**
 * Get Validation result for symbol at t0
 */
async function getValidationResult(
  symbol: string, 
  t0: number,
  exchangeVerdict: VerdictDirection,
  exchangeConfidence: number
): Promise<ValidationInput> {
  try {
    // Try to compute validation using C2.2
    const response = await fetch('http://localhost:8003/api/v10/validation/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        exchangeVerdict,
        exchangeConfidence,
        t0,
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.validation) {
        return {
          status: data.validation.validation.result,
          strength: data.validation.validation.strength,
          missing: data.validation.validation.reason?.filter((r: string) => r.includes('missing')) || [],
        };
      }
    }
  } catch (error) {
    console.error('[MetaBrain] Failed to get Validation:', error);
  }
  
  // Fallback to NO_DATA
  return {
    status: 'NO_DATA',
    missing: ['validation_unavailable'],
  };
}

/**
 * Build complete context for Meta-Brain decision
 */
export async function buildContext(symbol: string, t0?: number): Promise<MetaBrainV2Context> {
  const effectiveT0 = t0 || Date.now();
  const normalizedSymbol = symbol.toUpperCase().replace('-', '');
  
  // Fetch inputs in parallel where possible
  const [sentiment, exchange] = await Promise.all([
    getSentimentVerdict(normalizedSymbol, effectiveT0),
    getExchangeVerdict(normalizedSymbol, effectiveT0),
  ]);
  
  // Validation depends on Exchange verdict
  const validation = await getValidationResult(
    normalizedSymbol,
    effectiveT0,
    exchange.direction,
    exchange.confidence
  );
  
  return {
    symbol: normalizedSymbol,
    t0: effectiveT0,
    sentiment,
    exchange,
    validation,
  };
}

/**
 * Build context from provided inputs (for simulation)
 */
export function buildContextFromInputs(
  symbol: string,
  t0: number,
  sentiment: SentimentInput,
  exchange: ExchangeInput,
  validation: ValidationInput
): MetaBrainV2Context {
  return {
    symbol: symbol.toUpperCase().replace('-', ''),
    t0,
    sentiment,
    exchange,
    validation,
  };
}

console.log('[C3] Context Builder loaded');
