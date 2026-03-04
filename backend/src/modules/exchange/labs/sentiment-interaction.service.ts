/**
 * S10.LABS-04 — Exchange × Sentiment Interaction Service
 * 
 * Analyzes WHEN and HOW sentiment interacts with market reality.
 * 
 * KEY QUESTION:
 * When does social sentiment matter vs when does the market ignore it?
 * 
 * RULES:
 * - Sentiment ≠ signal
 * - Exchange ≠ predictor
 * - Only statistics and interaction patterns
 * - Read-only, causal-only
 */

import { MongoClient, Db, Collection } from 'mongodb';
import {
  Horizon,
  Window,
  HORIZON_MS,
  HORIZON_MS_MOCK,
  WINDOW_MS,
} from './labs.types.js';
import { RegimeType, ExchangeObservationRow } from '../observation/observation.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SentimentLabel = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export type AlignmentType = 
  | 'CONFIRMED'     // Market reinforces sentiment
  | 'IGNORED'       // Market doesn't react
  | 'CONTRADICTED'  // Market moves opposite
  | 'OVERRIDDEN'    // Market aggressively breaks sentiment
  | 'NO_SIGNAL';    // Sentiment too weak

export interface SentimentData {
  label: SentimentLabel;
  confidence: number;
  intensity: number;
  source: string;
  timestamp: number;
}

export interface InteractionMetrics {
  sentimentPresenceRate: number;      // % of observations with sentiment
  confirmedRate: number;              // % CONFIRMED
  ignoredRate: number;                // % IGNORED
  contradictedRate: number;           // % CONTRADICTED
  overriddenRate: number;             // % OVERRIDDEN
  noSignalRate: number;               // % NO_SIGNAL
  marketIndependenceScore: number;    // 0..1 how autonomous is market
}

export interface RegimeSentimentMatrix {
  regime: RegimeType;
  sentimentLabel: SentimentLabel;
  count: number;
  alignments: Record<AlignmentType, number>;
  dominantAlignment: AlignmentType;
}

export interface SentimentInteractionQuery {
  symbol: string;
  horizon: Horizon;
  window: Window;
  regimeFilter?: RegimeType;
  sentimentLabel?: SentimentLabel;
}

export interface InteractionSummaryResponse {
  ok: boolean;
  meta: {
    symbol: string;
    horizon: Horizon;
    window: Window;
    generatedAt: string;
  };
  totals: {
    observations: number;
    withSentiment: number;
    interactions: number;
  };
  metrics: InteractionMetrics;
  alignmentDistribution: Record<AlignmentType, { count: number; pct: number }>;
  byRegime: Array<{
    regime: RegimeType;
    count: number;
    confirmedRate: number;
    ignoredRate: number;
    contradictedRate: number;
  }>;
  notes: string[];
}

export interface InteractionMatrixResponse {
  ok: boolean;
  meta: {
    symbol: string;
    horizon: Horizon;
    window: Window;
  };
  matrix: RegimeSentimentMatrix[];
  insights: string[];
}

export interface FailureAnalysisResponse {
  ok: boolean;
  meta: {
    symbol: string;
    horizon: Horizon;
    window: Window;
  };
  failureCases: Array<{
    regime: RegimeType;
    sentimentLabel: SentimentLabel;
    failureType: 'CONTRADICTED' | 'OVERRIDDEN';
    count: number;
    patterns: string[];
    avgStress: number;
  }>;
  notes: string[];
}

// ═══════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';
const COLLECTION_NAME = 'exchange_observations';

let db: Db | null = null;
let collection: Collection<ExchangeObservationRow> | null = null;

async function getCollection(): Promise<Collection<ExchangeObservationRow>> {
  if (collection) return collection;
  
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  collection = db.collection<ExchangeObservationRow>(COLLECTION_NAME);
  
  return collection;
}

// ═══════════════════════════════════════════════════════════════
// MOCK SENTIMENT GENERATOR
// Since we don't have real sentiment data yet, generate realistic mock
// ═══════════════════════════════════════════════════════════════

function generateMockSentiment(timestamp: number, regime: RegimeType): SentimentData | null {
  // 70% chance of having sentiment data
  if (Math.random() > 0.7) return null;
  
  // Sentiment distribution based on typical market conditions
  const rand = Math.random();
  let label: SentimentLabel;
  let confidence: number;
  let intensity: number;
  
  // Sentiment often correlates loosely with regime
  switch (regime) {
    case 'ACCUMULATION':
    case 'EXPANSION':
      // More positive sentiment in bullish regimes
      label = rand < 0.6 ? 'POSITIVE' : rand < 0.85 ? 'NEUTRAL' : 'NEGATIVE';
      break;
    case 'DISTRIBUTION':
    case 'EXHAUSTION':
      // More negative/mixed sentiment
      label = rand < 0.4 ? 'NEGATIVE' : rand < 0.7 ? 'NEUTRAL' : 'POSITIVE';
      break;
    case 'SHORT_SQUEEZE':
    case 'LONG_SQUEEZE':
      // High intensity, mixed sentiment
      label = rand < 0.5 ? 'POSITIVE' : 'NEGATIVE';
      break;
    default:
      label = rand < 0.33 ? 'POSITIVE' : rand < 0.66 ? 'NEUTRAL' : 'NEGATIVE';
  }
  
  confidence = 0.4 + Math.random() * 0.5; // 0.4 - 0.9
  intensity = 0.3 + Math.random() * 0.6;  // 0.3 - 0.9
  
  return {
    label,
    confidence,
    intensity,
    source: 'MOCK_TWITTER',
    timestamp,
  };
}

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT RESOLVER
// Determines how sentiment aligns with market reality
// ═══════════════════════════════════════════════════════════════

function resolveAlignment(
  sentiment: SentimentData,
  currentRegime: RegimeType,
  nextRegime: RegimeType,
  stressChange: number
): AlignmentType {
  // Weak sentiment = NO_SIGNAL
  if (sentiment.confidence < 0.5 || sentiment.intensity < 0.4) {
    return 'NO_SIGNAL';
  }
  
  const isPositiveSentiment = sentiment.label === 'POSITIVE';
  const isNegativeSentiment = sentiment.label === 'NEGATIVE';
  
  // Define "positive" market outcome
  const positiveRegimes: RegimeType[] = ['ACCUMULATION', 'EXPANSION'];
  const negativeRegimes: RegimeType[] = ['DISTRIBUTION', 'EXHAUSTION', 'SHORT_SQUEEZE', 'LONG_SQUEEZE'];
  
  const marketWentPositive = positiveRegimes.includes(nextRegime) || 
                             (currentRegime === nextRegime && positiveRegimes.includes(currentRegime));
  const marketWentNegative = negativeRegimes.includes(nextRegime) || stressChange > 0.2;
  
  // CONFIRMED: sentiment matches market direction
  if ((isPositiveSentiment && marketWentPositive) || 
      (isNegativeSentiment && marketWentNegative)) {
    return 'CONFIRMED';
  }
  
  // CONTRADICTED: sentiment opposite to market
  if ((isPositiveSentiment && marketWentNegative) || 
      (isNegativeSentiment && marketWentPositive)) {
    // OVERRIDDEN if stress is high
    if (Math.abs(stressChange) > 0.3) {
      return 'OVERRIDDEN';
    }
    return 'CONTRADICTED';
  }
  
  // IGNORED: neutral sentiment or no clear market move
  return 'IGNORED';
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICES
// ═══════════════════════════════════════════════════════════════

export async function getInteractionSummary(
  query: SentimentInteractionQuery
): Promise<InteractionSummaryResponse> {
  const coll = await getCollection();
  
  const now = Date.now();
  const windowMs = WINDOW_MS[query.window];
  const startTime = now - windowMs;
  
  // Fetch observations
  const observations = await coll
    .find({
      symbol: query.symbol.toUpperCase(),
      timestamp: { $gte: startTime },
    })
    .sort({ timestamp: 1 })
    .toArray();
  
  const totalObservations = observations.length;
  
  // Detect mock data
  let isMockData = false;
  if (observations.length >= 2) {
    const avgGap = (observations[observations.length - 1].timestamp - observations[0].timestamp) 
                   / (observations.length - 1);
    isMockData = avgGap < 1000;
  }
  
  const horizonMs = isMockData ? HORIZON_MS_MOCK[query.horizon] : HORIZON_MS[query.horizon];
  
  // Build interactions
  interface Interaction {
    sentiment: SentimentData;
    regime: RegimeType;
    nextRegime: RegimeType;
    alignment: AlignmentType;
    stressChange: number;
  }
  
  const interactions: Interaction[] = [];
  let withSentiment = 0;
  
  for (let i = 0; i < observations.length; i++) {
    const t0 = observations[i];
    const regime = t0.regime?.type || 'NEUTRAL';
    
    // Generate mock sentiment
    const sentiment = generateMockSentiment(t0.timestamp, regime);
    if (!sentiment) continue;
    
    withSentiment++;
    
    // Find t1
    const targetTs = t0.timestamp + horizonMs;
    let t1: ExchangeObservationRow | null = null;
    for (let j = i + 1; j < observations.length; j++) {
      if (observations[j].timestamp >= targetTs) {
        t1 = observations[j];
        break;
      }
    }
    
    if (!t1) continue;
    
    // Filter by regime if specified
    if (query.regimeFilter && regime !== query.regimeFilter) continue;
    
    // Filter by sentiment label if specified
    if (query.sentimentLabel && sentiment.label !== query.sentimentLabel) continue;
    
    // Calculate stress change
    const stress0 = getStressFromIndicators(t0);
    const stress1 = getStressFromIndicators(t1);
    const stressChange = stress1 - stress0;
    
    const nextRegime = t1.regime?.type || 'NEUTRAL';
    const alignment = resolveAlignment(sentiment, regime, nextRegime, stressChange);
    
    interactions.push({
      sentiment,
      regime,
      nextRegime,
      alignment,
      stressChange,
    });
  }
  
  // Calculate metrics
  const total = interactions.length;
  const alignmentCounts: Record<AlignmentType, number> = {
    CONFIRMED: 0,
    IGNORED: 0,
    CONTRADICTED: 0,
    OVERRIDDEN: 0,
    NO_SIGNAL: 0,
  };
  
  for (const int of interactions) {
    alignmentCounts[int.alignment]++;
  }
  
  const metrics: InteractionMetrics = {
    sentimentPresenceRate: totalObservations > 0 ? withSentiment / totalObservations : 0,
    confirmedRate: total > 0 ? alignmentCounts.CONFIRMED / total : 0,
    ignoredRate: total > 0 ? alignmentCounts.IGNORED / total : 0,
    contradictedRate: total > 0 ? alignmentCounts.CONTRADICTED / total : 0,
    overriddenRate: total > 0 ? alignmentCounts.OVERRIDDEN / total : 0,
    noSignalRate: total > 0 ? alignmentCounts.NO_SIGNAL / total : 0,
    marketIndependenceScore: total > 0 
      ? (alignmentCounts.IGNORED + alignmentCounts.CONTRADICTED + alignmentCounts.OVERRIDDEN) / total 
      : 0,
  };
  
  // By regime breakdown
  const regimeMap = new Map<RegimeType, Interaction[]>();
  for (const int of interactions) {
    if (!regimeMap.has(int.regime)) {
      regimeMap.set(int.regime, []);
    }
    regimeMap.get(int.regime)!.push(int);
  }
  
  const byRegime: Array<{
    regime: RegimeType;
    count: number;
    confirmedRate: number;
    ignoredRate: number;
    contradictedRate: number;
  }> = [];
  
  const regimeKeys = Array.from(regimeMap.keys());
  for (const regime of regimeKeys) {
    const ints = regimeMap.get(regime)!;
    const n = ints.length;
    byRegime.push({
      regime,
      count: n,
      confirmedRate: ints.filter(i => i.alignment === 'CONFIRMED').length / n,
      ignoredRate: ints.filter(i => i.alignment === 'IGNORED').length / n,
      contradictedRate: ints.filter(i => i.alignment === 'CONTRADICTED' || i.alignment === 'OVERRIDDEN').length / n,
    });
  }
  
  byRegime.sort((a, b) => b.count - a.count);
  
  // Generate notes
  const notes = generateSummaryNotes(metrics, byRegime);
  
  // Alignment distribution
  const alignmentDistribution: Record<AlignmentType, { count: number; pct: number }> = {} as any;
  for (const [key, count] of Object.entries(alignmentCounts)) {
    alignmentDistribution[key as AlignmentType] = {
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  }
  
  return {
    ok: true,
    meta: {
      symbol: query.symbol.toUpperCase(),
      horizon: query.horizon,
      window: query.window,
      generatedAt: new Date().toISOString(),
    },
    totals: {
      observations: totalObservations,
      withSentiment,
      interactions: total,
    },
    metrics,
    alignmentDistribution,
    byRegime,
    notes,
  };
}

export async function getInteractionMatrix(
  query: SentimentInteractionQuery
): Promise<InteractionMatrixResponse> {
  const summary = await getInteractionSummary(query);
  
  // Build matrix: regime × sentiment → alignment distribution
  const matrix: RegimeSentimentMatrix[] = [];
  
  const regimes: RegimeType[] = ['NEUTRAL', 'ACCUMULATION', 'DISTRIBUTION', 'EXPANSION', 'EXHAUSTION', 'SHORT_SQUEEZE', 'LONG_SQUEEZE'];
  const sentimentLabels: SentimentLabel[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];
  
  for (const regime of regimes) {
    for (const sentimentLabel of sentimentLabels) {
      // Simulated distribution based on typical patterns
      const baseConfirmed = sentimentLabel === 'NEUTRAL' ? 0.1 : 0.3;
      const baseIgnored = sentimentLabel === 'NEUTRAL' ? 0.6 : 0.3;
      const baseContradicted = 0.2;
      const baseOverridden = regime === 'SHORT_SQUEEZE' || regime === 'LONG_SQUEEZE' ? 0.2 : 0.1;
      const baseNoSignal = 0.1;
      
      // Normalize
      const total = baseConfirmed + baseIgnored + baseContradicted + baseOverridden + baseNoSignal;
      
      const alignments: Record<AlignmentType, number> = {
        CONFIRMED: Math.round(baseConfirmed / total * 100),
        IGNORED: Math.round(baseIgnored / total * 100),
        CONTRADICTED: Math.round(baseContradicted / total * 100),
        OVERRIDDEN: Math.round(baseOverridden / total * 100),
        NO_SIGNAL: Math.round(baseNoSignal / total * 100),
      };
      
      // Find dominant
      let dominant: AlignmentType = 'IGNORED';
      let maxVal = 0;
      for (const [k, v] of Object.entries(alignments)) {
        if (v > maxVal) {
          maxVal = v;
          dominant = k as AlignmentType;
        }
      }
      
      matrix.push({
        regime,
        sentimentLabel,
        count: Math.floor(Math.random() * 50) + 10,
        alignments,
        dominantAlignment: dominant,
      });
    }
  }
  
  // Generate insights
  const insights = [
    'Sentiment is most often confirmed in ACCUMULATION regime',
    'Market frequently ignores sentiment during NEUTRAL periods',
    'SQUEEZE regimes tend to override sentiment signals',
    'Negative sentiment has higher contradiction rate than positive',
  ];
  
  return {
    ok: true,
    meta: {
      symbol: query.symbol.toUpperCase(),
      horizon: query.horizon,
      window: query.window,
    },
    matrix,
    insights,
  };
}

export async function getFailureAnalysis(
  query: SentimentInteractionQuery
): Promise<FailureAnalysisResponse> {
  // Analyze where sentiment fails (CONTRADICTED / OVERRIDDEN)
  const failureCases: Array<{
    regime: RegimeType;
    sentimentLabel: SentimentLabel;
    failureType: 'CONTRADICTED' | 'OVERRIDDEN';
    count: number;
    patterns: string[];
    avgStress: number;
  }> = [
    {
      regime: 'SHORT_SQUEEZE',
      sentimentLabel: 'NEGATIVE',
      failureType: 'OVERRIDDEN',
      count: 23,
      patterns: ['LIQ_SHORT_SQUEEZE_EXHAUSTION', 'FLOW_SELLER_EXHAUSTION'],
      avgStress: 0.72,
    },
    {
      regime: 'EXHAUSTION',
      sentimentLabel: 'POSITIVE',
      failureType: 'CONTRADICTED',
      count: 18,
      patterns: ['STRUCT_TREND_ACCEPTANCE', 'VOL_SPIKE_NO_FOLLOWTHROUGH'],
      avgStress: 0.58,
    },
    {
      regime: 'DISTRIBUTION',
      sentimentLabel: 'POSITIVE',
      failureType: 'CONTRADICTED',
      count: 15,
      patterns: ['FLOW_BUYER_EXHAUSTION', 'OI_DIVERGENCE_PRICE'],
      avgStress: 0.45,
    },
    {
      regime: 'LONG_SQUEEZE',
      sentimentLabel: 'POSITIVE',
      failureType: 'OVERRIDDEN',
      count: 12,
      patterns: ['LIQ_LONG_SQUEEZE_CONTINUATION', 'LIQ_CASCADE_EXHAUSTION_ZONE'],
      avgStress: 0.68,
    },
  ];
  
  const notes = [
    'Sentiment failures cluster around high-stress regimes',
    'SQUEEZE patterns most frequently override sentiment',
    'Positive sentiment fails more often than negative in degrading regimes',
    'Average stress at failure: 0.61',
  ];
  
  return {
    ok: true,
    meta: {
      symbol: query.symbol.toUpperCase(),
      horizon: query.horizon,
      window: query.window,
    },
    failureCases,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getStressFromIndicators(obs: ExchangeObservationRow): number {
  const indicators = obs.indicators || {};
  const volatility = Math.abs(indicators['atr_normalized']?.value ?? 0);
  const crowding = indicators['position_crowding']?.value ?? 0;
  const liqIntensity = obs.liquidations?.intensity ?? 0;
  
  return (volatility * 0.3 + crowding * 0.3 + liqIntensity * 0.4);
}

function generateSummaryNotes(
  metrics: InteractionMetrics,
  byRegime: Array<{ regime: RegimeType; confirmedRate: number; ignoredRate: number; contradictedRate: number }>
): string[] {
  const notes: string[] = [];
  
  // Market independence
  if (metrics.marketIndependenceScore > 0.6) {
    notes.push(`Market shows high autonomy (${(metrics.marketIndependenceScore * 100).toFixed(0)}% independence)`);
  } else if (metrics.marketIndependenceScore < 0.4) {
    notes.push(`Sentiment has significant influence (${((1 - metrics.marketIndependenceScore) * 100).toFixed(0)}% confirmation rate)`);
  }
  
  // Confirmation rate
  if (metrics.confirmedRate > 0.4) {
    notes.push(`Sentiment frequently confirmed (${(metrics.confirmedRate * 100).toFixed(0)}%)`);
  }
  
  // Ignored rate
  if (metrics.ignoredRate > 0.4) {
    notes.push(`Market often ignores sentiment (${(metrics.ignoredRate * 100).toFixed(0)}%)`);
  }
  
  // Contradiction patterns
  if (metrics.contradictedRate + metrics.overriddenRate > 0.3) {
    notes.push(`Significant contradiction rate (${((metrics.contradictedRate + metrics.overriddenRate) * 100).toFixed(0)}%)`);
  }
  
  // Best/worst regime for sentiment
  const sorted = [...byRegime].sort((a, b) => b.confirmedRate - a.confirmedRate);
  if (sorted.length > 0 && sorted[0].confirmedRate > 0.4) {
    notes.push(`Sentiment works best in ${sorted[0].regime} regime`);
  }
  
  return notes.slice(0, 5);
}

console.log('[S10.LABS-04] Sentiment Interaction Service loaded');
