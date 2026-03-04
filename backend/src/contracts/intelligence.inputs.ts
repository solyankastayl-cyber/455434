/**
 * INTELLIGENCE INPUTS CONTRACT — P1.D
 * ====================================
 * 
 * Stub interfaces for P2 Connections integration.
 * These define what data CAN enter the intelligence layer.
 * 
 * @reserved v1.0 — DO NOT IMPLEMENT until P2
 */

// ═══════════════════════════════════════════════════════════════
// INPUT SOURCES (P2 will add more)
// ═══════════════════════════════════════════════════════════════

export type InputSource = 
  | 'EXCHANGE'      // CEX data (orderbooks, trades, liquidations)
  | 'MACRO'         // Market regime (dominance, fear/greed)
  | 'ONCHAIN'       // Blockchain data (flows, wallet activity)
  | 'SENTIMENT'     // Social signals (twitter, news)
  | 'CONNECTIONS';  // Reserved for P2

// ═══════════════════════════════════════════════════════════════
// BASE INPUT INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface IntelligenceInput<T = unknown> {
  /** Input source */
  source: InputSource;
  
  /** Timestamp of data */
  timestamp: number;
  
  /** Data freshness (ms since creation) */
  ageMs: number;
  
  /** Quality score (0..1) */
  quality: number;
  
  /** Actual data payload */
  data: T;
  
  /** Metadata */
  meta?: {
    provider?: string;
    version?: string;
    cached?: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// EXCHANGE INPUT
// ═══════════════════════════════════════════════════════════════

export interface ExchangeInputData {
  symbol: string;
  exchange: string;
  
  // Prices
  price: number;
  priceChange24h: number;
  
  // Volume
  volume24h: number;
  volumeRatio: number; // vs 7d avg
  
  // Order book
  bidAskSpread: number;
  bookImbalance: number; // -1 to 1
  
  // Liquidations
  longLiqs24h: number;
  shortLiqs24h: number;
  liqRatio: number;
  
  // Flow
  netflow24h: number;
  flowDirection: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
}

export type ExchangeInput = IntelligenceInput<ExchangeInputData>;

// ═══════════════════════════════════════════════════════════════
// MACRO INPUT
// ═══════════════════════════════════════════════════════════════

export interface MacroInputData {
  // Regime
  regime: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  
  // Indicators
  fearGreed: number;
  btcDominance: number;
  stableDominance: number;
  
  // Trends
  btcDomTrend: 'UP' | 'DOWN' | 'FLAT';
  stableDomTrend: 'UP' | 'DOWN' | 'FLAT';
  
  // Modifiers
  confidenceMultiplier: number;
  blockedActions: string[];
  flags: string[];
}

export type MacroInput = IntelligenceInput<MacroInputData>;

// ═══════════════════════════════════════════════════════════════
// ONCHAIN INPUT
// ═══════════════════════════════════════════════════════════════

export interface OnchainInputData {
  symbol: string;
  chain: string;
  
  // Exchange flows
  exchangeNetflow24h: number;
  exchangeReserve: number;
  reserveChange24h: number;
  
  // Whale activity
  whaleTransactions24h: number;
  largeTransfersToExchange: number;
  largeTransfersFromExchange: number;
  
  // Network
  activeAddresses24h: number;
  transactionCount24h: number;
}

export type OnchainInput = IntelligenceInput<OnchainInputData>;

// ═══════════════════════════════════════════════════════════════
// SENTIMENT INPUT
// ═══════════════════════════════════════════════════════════════

export interface SentimentInputData {
  symbol: string;
  
  // Aggregated sentiment
  sentiment: number; // -1 to 1
  confidence: number;
  
  // Source breakdown
  twitterSentiment: number;
  newsSentiment: number;
  socialMentions24h: number;
  
  // Trends
  sentimentTrend: 'IMPROVING' | 'DECLINING' | 'STABLE';
  mentionsTrend: 'UP' | 'DOWN' | 'FLAT';
}

export type SentimentInput = IntelligenceInput<SentimentInputData>;

// ═══════════════════════════════════════════════════════════════
// CONNECTIONS INPUT (RESERVED FOR P2)
// ═══════════════════════════════════════════════════════════════

/**
 * @reserved P2 — Connections integration
 * DO NOT implement until Connections merge
 */
export interface ConnectionsInputData {
  // Placeholder — will be defined in P2
  _reserved: true;
}

export type ConnectionsInput = IntelligenceInput<ConnectionsInputData>;

// ═══════════════════════════════════════════════════════════════
// AGGREGATED INPUT
// ═══════════════════════════════════════════════════════════════

export interface IntelligenceInputBundle {
  timestamp: number;
  symbol: string;
  
  exchange?: ExchangeInput;
  macro?: MacroInput;
  onchain?: OnchainInput;
  sentiment?: SentimentInput;
  
  // Reserved for P2
  connections?: ConnectionsInput;
  
  // Quality assessment
  overallQuality: number;
  missingInputs: InputSource[];
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateInputFreshness(
  input: IntelligenceInput,
  maxAgeMs: number = 60000
): boolean {
  return input.ageMs <= maxAgeMs;
}

export function validateInputQuality(
  input: IntelligenceInput,
  minQuality: number = 0.5
): boolean {
  return input.quality >= minQuality;
}

console.log('[P1.D] Intelligence inputs contract loaded (STUB)');
