/**
 * C1 — Alignment Explain
 * 
 * Generates human-readable explanations for alignment results.
 */

import {
  AlignmentType,
  ExchangeLayerInput,
  SentimentLayerInput,
  AlignmentDrivers,
} from './alignment.contracts.js';

export interface ExplanationResult {
  explanation: string[];
  exchangeDrivers: string[];
  sentimentDrivers: string[];
  conflictDrivers: string[];
}

export function buildExplanation(args: {
  type: AlignmentType;
  exchange: ExchangeLayerInput;
  sentiment: SentimentLayerInput;
}): ExplanationResult {
  const { type, exchange, sentiment } = args;
  
  // Collect exchange drivers
  const exchangeDrivers: string[] = [
    ...(exchange.drivers ?? []),
    ...(exchange.reasons ?? []),
  ].filter(Boolean);
  
  // Collect sentiment drivers
  const sentimentDrivers: string[] = [
    ...(sentiment.drivers ?? []),
    ...(sentiment.reasons ?? []),
  ];
  
  // Add keywords if present
  if (sentiment.keywords && sentiment.keywords.length > 0) {
    sentimentDrivers.push(`keywords: ${sentiment.keywords.slice(0, 5).join(', ')}`);
  }
  
  // Add source if present
  if (sentiment.source) {
    sentimentDrivers.push(`source: ${sentiment.source}`);
  }
  
  // Conflict drivers
  const conflictDrivers: string[] = [];
  if (type === 'CONTRADICTED') {
    conflictDrivers.push(`exchange(${exchange.verdict}) vs sentiment(${sentiment.verdict})`);
    
    // Add specific conflict reasons
    if (exchange.verdict === 'BEARISH' && sentiment.verdict === 'BULLISH') {
      conflictDrivers.push('market_mechanics_contradict_optimism');
    } else if (exchange.verdict === 'BULLISH' && sentiment.verdict === 'BEARISH') {
      conflictDrivers.push('market_mechanics_contradict_pessimism');
    }
  }
  
  // Build explanation based on type
  const explanation: string[] = [];
  
  switch (type) {
    case 'CONFIRMED':
      explanation.push('Sentiment is confirmed by market mechanics.');
      if (exchange.verdict === 'BULLISH') {
        explanation.push('Both social discourse and exchange structure support upward bias.');
      } else if (exchange.verdict === 'BEARISH') {
        explanation.push('Both social discourse and exchange structure support downward bias.');
      }
      break;
      
    case 'CONTRADICTED':
      explanation.push('Sentiment contradicts market mechanics.');
      if (exchange.verdict === 'BEARISH' && sentiment.verdict === 'BULLISH') {
        explanation.push('Market structure shows weakness while social discourse remains optimistic.');
        explanation.push('This typically indicates narrative-driven noise.');
      } else if (exchange.verdict === 'BULLISH' && sentiment.verdict === 'BEARISH') {
        explanation.push('Market structure shows strength while social discourse is pessimistic.');
        explanation.push('This may indicate accumulation or smart money divergence.');
      }
      break;
      
    case 'EXCHANGE_ONLY':
      explanation.push('Exchange provides confident context, but sentiment is not usable.');
      explanation.push('Decision should rely primarily on market mechanics.');
      break;
      
    case 'SENTIMENT_ONLY':
      explanation.push('Sentiment is usable, but exchange context is not ready.');
      explanation.push('Market mechanics are unclear; sentiment alone is unreliable.');
      break;
      
    case 'IGNORED':
      explanation.push('Both layers are neutral: no directional signal.');
      explanation.push('Market is in consolidation or waiting mode.');
      break;
      
    case 'NO_DATA':
    default:
      explanation.push('Insufficient data from both layers for comparison.');
      explanation.push('Wait for data quality to improve.');
      break;
  }
  
  return {
    explanation,
    exchangeDrivers: exchangeDrivers.filter(Boolean),
    sentimentDrivers: sentimentDrivers.filter(Boolean),
    conflictDrivers,
  };
}

console.log('[C1] Alignment Explain loaded');
