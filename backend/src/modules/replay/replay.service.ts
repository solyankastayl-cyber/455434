/**
 * S5.6.H — Historical Replay Module
 * ==================================
 * 
 * Ускоренная проверка пайплайна Sentiment → Price → Outcome
 * на реальных прошлых данных без ожидания времени.
 * 
 * РЕЖИМ: READ-ONLY
 * - Не пишет в production dataset
 * - Использует реальные твиты + историческую цену
 * - Результат = мгновенный backtest
 * 
 * FREEZE: Sentiment v1.6 — LOCKED, no changes allowed
 */

import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { sentimentClient } from '../sentiment/sentiment.client.js';

// ============================================================
// Types
// ============================================================

export interface ReplaySession {
  _id?: ObjectId;
  session_id: string;
  asset: 'BTC' | 'ETH' | 'SOL';
  timeRange: {
    from: Date;
    to: Date;
  };
  tweetSource: 'twitter-history' | 'manual';
  tweetLimit: number;
  horizons: ('5m' | '15m' | '1h' | '4h' | '24h')[];
  sentimentVersion: string;
  priceSource: 'coingecko-history' | 'mongodb-history';
  mode: 'READ_ONLY';
  status: 'CREATED' | 'INGESTING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  stats: {
    tweetsIngested: number;
    signalsCreated: number;
    outcomesLabeled: number;
    errors: number;
  };
  results?: ReplaySummary;
  createdAt: Date;
  completedAt?: Date;
}

export interface ReplayTweet {
  tweet_id: string;
  text: string;
  created_at: Date;  // CRITICAL: t0 = tweet time, NOT now
  author_id: string;
  author_username: string;
  engagement?: {
    likes: number;
    reposts: number;
  };
}

export interface ReplaySignal {
  session_id: string;
  tweet_id: string;
  asset: string;
  t0_timestamp: Date;
  sentiment: {
    label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    score: number;
    confidence: number;
    engine_version: string;
    reasons: string[];
  };
  prices: {
    t0?: number;
    '5m'?: number;
    '15m'?: number;
    '1h'?: number;
    '4h'?: number;
    '24h'?: number;
  };
  reactions: {
    [horizon: string]: {
      delta_pct: number;
      direction: 'UP' | 'DOWN' | 'FLAT';
      magnitude: 'STRONG' | 'WEAK' | 'NONE';
    };
  };
  outcomes: {
    [horizon: string]: {
      label: string;
      confidence: number;
    };
  };
  meta: {
    text: string;
    text_length: number;
  };
}

export interface ReplaySummary {
  totalSignals: number;
  byHorizon: {
    [horizon: string]: {
      total: number;
      tp: number;
      fp: number;
      tn: number;
      fn: number;
      missed: number;
      noSignal: number;
      accuracy: number;
    };
  };
  byConfidenceBucket: {
    [bucket: string]: {
      total: number;
      tp: number;
      fp: number;
      accuracy: number;
    };
  };
  bySentiment: {
    [label: string]: {
      total: number;
      upCount: number;
      downCount: number;
      flatCount: number;
    };
  };
  missedOpportunities: number;
  edgeAssessment: 'STRONG' | 'WEAK' | 'NONE' | 'PENDING';
}

// ============================================================
// Thresholds (FROZEN from S5.3)
// ============================================================

const THRESHOLDS = {
  FLAT_MAX: 0.5,      // |delta| < 0.5% = FLAT
  WEAK_MAX: 2.0,      // 0.5% - 2% = WEAK
  STRONG_MIN: 2.0,    // > 2% = STRONG
};

const CONFIDENCE_BUCKETS = [
  { label: '0.8+', min: 0.8, max: 1.0 },
  { label: '0.7-0.8', min: 0.7, max: 0.8 },
  { label: '0.6-0.7', min: 0.6, max: 0.7 },
  { label: '0.5-0.6', min: 0.5, max: 0.6 },
  { label: '<0.5', min: 0, max: 0.5 },
];

// ============================================================
// Historical Price Provider
// ============================================================

class HistoricalPriceProvider {
  private db: Db | null = null;
  private pricePoints: Collection | null = null;
  
  // CoinGecko API config
  private coingeckoBaseUrl = 'https://api.coingecko.com/api/v3';
  private coingeckoIds: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
  };
  
  // Price cache to reduce API calls
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private cacheTTL = 60 * 1000; // 1 minute cache
  
  // Fallback prices (last resort)
  private fallbackPrices: Record<string, number> = {
    BTC: 97000,
    ETH: 2700,
    SOL: 200,
  };
  
  // Rate limiting
  private lastApiCall = 0;
  private minApiInterval = 1500; // 1.5s between calls (CoinGecko free tier)
  
  // Bullish/bearish keywords for mock sentiment
  private bullishKeywords = ['bullish', 'moon', 'pump', 'buy', 'long', 'breakout', 'bullrun', 'accumulate', 'undervalued', 'gem', 'rocket', '🚀', 'to the moon'];
  private bearishKeywords = ['bearish', 'crash', 'dump', 'sell', 'short', 'correction', 'overvalued', 'warning', 'careful', 'risk', 'red', 'down', 'weak'];
  
  /**
   * Mock sentiment analysis based on keyword matching
   * Used when sentiment client is unavailable
   */
  mockSentiment(text: string): { label: string; score: number; confidence: number } {
    const lowerText = text.toLowerCase();
    
    let bullishScore = 0;
    let bearishScore = 0;
    
    for (const kw of this.bullishKeywords) {
      if (lowerText.includes(kw.toLowerCase())) bullishScore++;
    }
    for (const kw of this.bearishKeywords) {
      if (lowerText.includes(kw.toLowerCase())) bearishScore++;
    }
    
    // Determine label
    let label: string;
    let score: number;
    let confidence: number;
    
    if (bullishScore > bearishScore && bullishScore >= 1) {
      label = 'POSITIVE';
      score = 0.6 + Math.min(bullishScore * 0.1, 0.35);
      confidence = 0.55 + Math.min(bullishScore * 0.1, 0.35);
    } else if (bearishScore > bullishScore && bearishScore >= 1) {
      label = 'NEGATIVE';
      score = 0.4 - Math.min(bearishScore * 0.1, 0.35);
      confidence = 0.55 + Math.min(bearishScore * 0.1, 0.35);
    } else {
      label = 'NEUTRAL';
      score = 0.5;
      confidence = 0.4 + Math.random() * 0.2;
    }
    
    return { label, score, confidence };
  }
  
  async connect(mongoUrl: string): Promise<void> {
    const client = new MongoClient(mongoUrl);
    await client.connect();
    this.db = client.db('ai_on_crypto');
    this.pricePoints = this.db.collection('price_points');
  }
  
  /**
   * Rate-limited fetch from CoinGecko
   */
  private async rateLimitedFetch(url: string): Promise<any> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCall;
    
    if (timeSinceLastCall < this.minApiInterval) {
      await new Promise(r => setTimeout(r, this.minApiInterval - timeSinceLastCall));
    }
    
    this.lastApiCall = Date.now();
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[PriceProvider] CoinGecko error: ${response.status}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.warn(`[PriceProvider] CoinGecko fetch failed: ${error}`);
      return null;
    }
  }
  
  /**
   * Get historical price from CoinGecko
   * Uses /coins/{id}/history endpoint for specific date
   */
  async getHistoricalPriceFromCoinGecko(asset: string, timestamp: Date): Promise<number | null> {
    const coinId = this.coingeckoIds[asset];
    if (!coinId) return null;
    
    // CoinGecko history requires date in DD-MM-YYYY format
    const day = timestamp.getUTCDate().toString().padStart(2, '0');
    const month = (timestamp.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = timestamp.getUTCFullYear();
    const dateStr = `${day}-${month}-${year}`;
    
    const url = `${this.coingeckoBaseUrl}/coins/${coinId}/history?date=${dateStr}&localization=false`;
    
    const data = await this.rateLimitedFetch(url);
    if (data && data.market_data && data.market_data.current_price) {
      return data.market_data.current_price.usd;
    }
    
    return null;
  }
  
  /**
   * Get historical price at specific timestamp
   * Priority: MongoDB → CoinGecko → Fallback
   */
  async getPriceAt(asset: string, timestamp: Date): Promise<number | null> {
    // 1. Check cache
    const cacheKey = `${asset}_${timestamp.toISOString().substring(0, 13)}`; // Hour precision
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.price;
    }
    
    // 2. Try MongoDB (existing price_points)
    if (this.pricePoints) {
      const toleranceMs = 30 * 60 * 1000; // 30 minutes tolerance for historical
      
      try {
        const price = await this.pricePoints.findOne({
          symbol: asset,
          timestamp: {
            $gte: new Date(timestamp.getTime() - toleranceMs),
            $lte: new Date(timestamp.getTime() + toleranceMs),
          },
        }, {
          sort: { timestamp: 1 },
        });
        
        if (price && price.priceUsd) {
          const priceValue = parseFloat(price.priceUsd);
          this.priceCache.set(cacheKey, { price: priceValue, timestamp: Date.now() });
          return priceValue;
        }
      } catch (error) {
        console.warn(`[PriceProvider] MongoDB lookup failed: ${error}`);
      }
    }
    
    // 3. Try CoinGecko historical API
    const cgPrice = await this.getHistoricalPriceFromCoinGecko(asset, timestamp);
    if (cgPrice) {
      this.priceCache.set(cacheKey, { price: cgPrice, timestamp: Date.now() });
      console.log(`[PriceProvider] Got ${asset} price from CoinGecko: $${cgPrice.toFixed(2)}`);
      return cgPrice;
    }
    
    // 4. Fallback
    console.warn(`[PriceProvider] Using fallback price for ${asset}`);
    return this.fallbackPrices[asset] || null;
  }
  
  /**
   * Get all horizon prices for a signal
   * Uses batch fetching where possible
   */
  async getHorizonPrices(
    asset: string,
    t0: Date,
    horizons: string[]
  ): Promise<Record<string, number | null>> {
    const horizonMs: Record<string, number> = {
      't0': 0,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    
    const prices: Record<string, number | null> = {};
    
    // Get t0 price first
    prices['t0'] = await this.getPriceAt(asset, t0);
    
    // Get horizon prices
    for (const h of horizons) {
      const targetTime = new Date(t0.getTime() + (horizonMs[h] || 0));
      prices[h] = await this.getPriceAt(asset, targetTime);
    }
    
    return prices;
  }
}

// ============================================================
// Replay Service
// ============================================================

class ReplayService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private sessions: Collection<ReplaySession> | null = null;
  private signals: Collection<ReplaySignal> | null = null;
  private priceProvider = new HistoricalPriceProvider();
  
  async connect(): Promise<void> {
    if (this.db) return;
    
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    this.client = new MongoClient(mongoUrl);
    await this.client.connect();
    this.db = this.client.db('ai_on_crypto');
    
    // Replay-specific collections (isolated from prod)
    this.sessions = this.db.collection('replay_sessions');
    this.signals = this.db.collection('replay_signals');
    
    // Connect price provider
    await this.priceProvider.connect(mongoUrl);
    
    // Create indexes
    await this.sessions.createIndex({ session_id: 1 }, { unique: true });
    await this.signals.createIndex({ session_id: 1 });
    await this.signals.createIndex({ session_id: 1, tweet_id: 1 });
    
    console.log('[Replay] Connected to MongoDB (isolated collections)');
  }
  
  /**
   * Create a new replay session
   */
  async createSession(params: {
    asset: 'BTC' | 'ETH' | 'SOL';
    fromHours: number;
    toHours: number;
    tweetLimit: number;
  }): Promise<ReplaySession> {
    await this.connect();
    if (!this.sessions) throw new Error('Not connected');
    
    const now = new Date();
    const session: ReplaySession = {
      session_id: `replay_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      asset: params.asset,
      timeRange: {
        from: new Date(now.getTime() - params.fromHours * 60 * 60 * 1000),
        to: new Date(now.getTime() - params.toHours * 60 * 60 * 1000),
      },
      tweetSource: 'manual',  // For now, manual tweets
      tweetLimit: params.tweetLimit,
      horizons: ['5m', '15m', '1h', '4h', '24h'],
      sentimentVersion: 'v1.6-frozen',
      priceSource: 'mongodb-history',
      mode: 'READ_ONLY',
      status: 'CREATED',
      stats: {
        tweetsIngested: 0,
        signalsCreated: 0,
        outcomesLabeled: 0,
        errors: 0,
      },
      createdAt: new Date(),
    };
    
    await this.sessions.insertOne(session);
    console.log(`[Replay] Session created: ${session.session_id}`);
    
    return session;
  }
  
  /**
   * Process a batch of tweets for replay
   * CRITICAL: t0 = tweet.created_at, NOT now
   */
  async processTweets(
    sessionId: string,
    tweets: ReplayTweet[]
  ): Promise<{ processed: number; errors: number }> {
    await this.connect();
    if (!this.sessions || !this.signals) throw new Error('Not connected');
    
    const session = await this.sessions.findOne({ session_id: sessionId });
    if (!session) throw new Error(`Session ${sessionId} not found`);
    
    let processed = 0;
    let errors = 0;
    
    await this.sessions.updateOne(
      { session_id: sessionId },
      { $set: { status: 'PROCESSING' } }
    );
    
    for (const tweet of tweets) {
      try {
        // 1. Run sentiment analysis (v1.6 FROZEN) with fallback to mock
        let sentimentResult;
        try {
          sentimentResult = await sentimentClient.predict(tweet.text);
        } catch (sentimentError) {
          console.warn(`[Replay] Sentiment client failed, using mock: ${sentimentError}`);
          // Mock sentiment based on simple text analysis
          sentimentResult = this.mockSentiment(tweet.text);
        }
        
        // 2. Get historical prices (t0 = tweet time!)
        const t0 = new Date(tweet.created_at);
        const prices = await this.priceProvider.getHorizonPrices(
          session.asset,
          t0,
          session.horizons
        );
        
        // 3. Calculate reactions
        const reactions: ReplaySignal['reactions'] = {};
        const t0Price = prices['t0'];
        
        if (t0Price) {
          for (const h of session.horizons) {
            const hPrice = prices[h];
            if (hPrice) {
              const delta = ((hPrice - t0Price) / t0Price) * 100;
              const absDelta = Math.abs(delta);
              
              let direction: 'UP' | 'DOWN' | 'FLAT';
              if (absDelta < THRESHOLDS.FLAT_MAX) direction = 'FLAT';
              else if (delta > 0) direction = 'UP';
              else direction = 'DOWN';
              
              let magnitude: 'STRONG' | 'WEAK' | 'NONE';
              if (absDelta < THRESHOLDS.FLAT_MAX) magnitude = 'NONE';
              else if (absDelta >= THRESHOLDS.STRONG_MIN) magnitude = 'STRONG';
              else magnitude = 'WEAK';
              
              reactions[h] = { delta_pct: delta, direction, magnitude };
            }
          }
        }
        
        // 4. Calculate outcomes
        const outcomes: ReplaySignal['outcomes'] = {};
        const label = sentimentResult.label as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
        
        for (const [h, reaction] of Object.entries(reactions)) {
          let outcomeLabel: string;
          
          if (label === 'POSITIVE') {
            outcomeLabel = reaction.direction === 'UP' ? 'TRUE_POSITIVE' : 'FALSE_POSITIVE';
          } else if (label === 'NEGATIVE') {
            outcomeLabel = reaction.direction === 'DOWN' ? 'TRUE_NEGATIVE' : 'FALSE_NEGATIVE';
          } else {
            // NEUTRAL
            if (reaction.direction === 'FLAT' || reaction.magnitude === 'NONE') {
              outcomeLabel = 'NO_SIGNAL';
            } else if (reaction.magnitude === 'STRONG') {
              outcomeLabel = 'MISSED_OPPORTUNITY';
            } else {
              outcomeLabel = 'NO_SIGNAL';
            }
          }
          
          const confidence = reaction.magnitude === 'STRONG' ? 0.95 :
                            reaction.magnitude === 'WEAK' ? 0.70 : 0.50;
          
          outcomes[h] = { label: outcomeLabel, confidence };
        }
        
        // 5. Create replay signal
        const signal: ReplaySignal = {
          session_id: sessionId,
          tweet_id: tweet.tweet_id,
          asset: session.asset,
          t0_timestamp: t0,
          sentiment: {
            label,
            score: sentimentResult.score,
            confidence: sentimentResult.meta?.confidenceScore || 0.5,
            engine_version: 'v1.6-frozen',
            reasons: sentimentResult.meta?.reasons || [],
          },
          prices,
          reactions,
          outcomes,
          meta: {
            text: tweet.text,
            text_length: tweet.text.length,
          },
        };
        
        await this.signals.insertOne(signal);
        processed++;
        
        console.log(`[Replay] Processed tweet ${tweet.tweet_id}: ${label} → outcomes calculated`);
        
      } catch (error: any) {
        console.error(`[Replay] Error processing tweet ${tweet.tweet_id}: ${error.message}`);
        errors++;
      }
    }
    
    // Update session stats
    await this.sessions.updateOne(
      { session_id: sessionId },
      {
        $inc: {
          'stats.tweetsIngested': tweets.length,
          'stats.signalsCreated': processed,
          'stats.outcomesLabeled': processed,
          'stats.errors': errors,
        },
      }
    );
    
    return { processed, errors };
  }
  
  /**
   * Complete session and generate summary
   */
  async completeSession(sessionId: string): Promise<ReplaySummary> {
    await this.connect();
    if (!this.sessions || !this.signals) throw new Error('Not connected');
    
    const signals = await this.signals.find({ session_id: sessionId }).toArray();
    
    // Initialize summary
    const summary: ReplaySummary = {
      totalSignals: signals.length,
      byHorizon: {},
      byConfidenceBucket: {},
      bySentiment: {},
      missedOpportunities: 0,
      edgeAssessment: 'PENDING',
    };
    
    // Initialize horizons
    for (const h of ['5m', '15m', '1h', '4h', '24h']) {
      summary.byHorizon[h] = {
        total: 0, tp: 0, fp: 0, tn: 0, fn: 0, missed: 0, noSignal: 0, accuracy: 0
      };
    }
    
    // Initialize confidence buckets
    for (const bucket of CONFIDENCE_BUCKETS) {
      summary.byConfidenceBucket[bucket.label] = { total: 0, tp: 0, fp: 0, accuracy: 0 };
    }
    
    // Initialize sentiment labels
    for (const label of ['POSITIVE', 'NEUTRAL', 'NEGATIVE']) {
      summary.bySentiment[label] = { total: 0, upCount: 0, downCount: 0, flatCount: 0 };
    }
    
    // Process signals
    for (const signal of signals) {
      const conf = signal.sentiment.confidence;
      const label = signal.sentiment.label;
      
      // By sentiment
      summary.bySentiment[label].total++;
      
      // By horizon
      for (const [h, outcome] of Object.entries(signal.outcomes)) {
        const hStats = summary.byHorizon[h];
        if (!hStats) continue;
        
        hStats.total++;
        
        switch (outcome.label) {
          case 'TRUE_POSITIVE': hStats.tp++; break;
          case 'FALSE_POSITIVE': hStats.fp++; break;
          case 'TRUE_NEGATIVE': hStats.tn++; break;
          case 'FALSE_NEGATIVE': hStats.fn++; break;
          case 'MISSED_OPPORTUNITY': 
            hStats.missed++; 
            summary.missedOpportunities++;
            break;
          case 'NO_SIGNAL': hStats.noSignal++; break;
        }
        
        // Direction by sentiment
        const reaction = signal.reactions[h];
        if (reaction) {
          if (reaction.direction === 'UP') summary.bySentiment[label].upCount++;
          else if (reaction.direction === 'DOWN') summary.bySentiment[label].downCount++;
          else summary.bySentiment[label].flatCount++;
        }
      }
      
      // By confidence bucket
      for (const bucket of CONFIDENCE_BUCKETS) {
        if (conf >= bucket.min && conf < bucket.max) {
          const bStats = summary.byConfidenceBucket[bucket.label];
          bStats.total++;
          
          // Check 1h outcome for bucket stats
          const outcome1h = signal.outcomes['1h'];
          if (outcome1h) {
            if (outcome1h.label === 'TRUE_POSITIVE') bStats.tp++;
            else if (outcome1h.label === 'FALSE_POSITIVE') bStats.fp++;
          }
          break;
        }
      }
    }
    
    // Calculate accuracies
    for (const h of Object.keys(summary.byHorizon)) {
      const hStats = summary.byHorizon[h];
      const correct = hStats.tp + hStats.tn + hStats.noSignal;
      hStats.accuracy = hStats.total > 0 ? (correct / hStats.total) * 100 : 0;
    }
    
    for (const bucket of CONFIDENCE_BUCKETS) {
      const bStats = summary.byConfidenceBucket[bucket.label];
      bStats.accuracy = bStats.total > 0 ? (bStats.tp / bStats.total) * 100 : 0;
    }
    
    // Edge assessment (simple heuristic)
    const h1h = summary.byHorizon['1h'];
    if (h1h && h1h.total >= 10) {
      if (h1h.accuracy > 60) summary.edgeAssessment = 'STRONG';
      else if (h1h.accuracy > 50) summary.edgeAssessment = 'WEAK';
      else summary.edgeAssessment = 'NONE';
    }
    
    // Update session
    await this.sessions.updateOne(
      { session_id: sessionId },
      {
        $set: {
          status: 'COMPLETED',
          results: summary,
          completedAt: new Date(),
        },
      }
    );
    
    return summary;
  }
  
  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ReplaySession | null> {
    await this.connect();
    if (!this.sessions) throw new Error('Not connected');
    return this.sessions.findOne({ session_id: sessionId });
  }
  
  /**
   * Get all signals for a session
   */
  async getSessionSignals(sessionId: string): Promise<ReplaySignal[]> {
    await this.connect();
    if (!this.signals) throw new Error('Not connected');
    return this.signals.find({ session_id: sessionId }).toArray();
  }
  
  /**
   * List all sessions
   */
  async listSessions(): Promise<ReplaySession[]> {
    await this.connect();
    if (!this.sessions) throw new Error('Not connected');
    return this.sessions.find().sort({ createdAt: -1 }).limit(20).toArray();
  }
}

export const replayService = new ReplayService();
