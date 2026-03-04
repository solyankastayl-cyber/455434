/**
 * S5.2 — PRICE LAYER
 * 
 * Price Source Integration for Sentiment × Price correlation.
 * 
 * Architecture:
 * - PriceProvider: Unified interface for price data
 * - SnapshotCollector: Collects price at signal timestamps
 * - HorizonScheduler: Schedules future price snapshots
 * - ReactionCalculator: Calculates price deltas
 * 
 * Status: S5.2 IMPLEMENTATION
 * 
 * S6.1 Integration: After outcome labeling, creates ObservationRow
 */

import { MongoClient, Collection, Db, ObjectId } from 'mongodb';

// S6.1 — Observation Model integration (lazy import to avoid circular deps)
let observationServiceModule: typeof import('../observation/observation.service.js') | null = null;

async function getObservationService() {
  if (!observationServiceModule) {
    observationServiceModule = await import('../observation/observation.service.js');
  }
  return observationServiceModule.observationService;
}

// ============================================================
// TYPES
// ============================================================

export interface PricePoint {
  asset: string;
  timestamp: number;
  price: number;
  volume24h?: number;
  source: 'coingecko' | 'dex' | 'cached';
}

export interface SignalEvent {
  _id?: ObjectId;
  signal_id: string;
  source: 'twitter' | 'onchain' | 'mixed' | 'manual';
  asset: string;
  timestamp: number;
  
  sentiment: {
    label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    score: number;
    confidence: number;
    engine_version: string;
    cnn_flags?: string[];
    bullish_analysis?: string;
  };
  
  onchain?: {
    inflow_score?: number;
    outflow_score?: number;
    whale_activity?: boolean;
    anomaly_flags?: string[];
  };
  
  meta: {
    text?: string;
    text_length?: number;
    has_link?: boolean;
    engagement?: {
      likes?: number;
      reposts?: number;
      replies?: number;
    };
  };
  
  created_at: Date;
}

export interface PriceObservation {
  _id?: ObjectId;
  signal_id: string;
  horizon: 't0' | '5m' | '15m' | '1h' | '4h' | '24h';
  timestamp: number;
  price: number;
  volume?: number;
  source: string;
  collected_at: Date;
}

export interface PriceReaction {
  _id?: ObjectId;
  signal_id: string;
  horizon: '5m' | '15m' | '1h' | '4h' | '24h';
  price_t0: number;
  price_h: number;
  delta_pct: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  magnitude: 'STRONG' | 'WEAK' | 'NONE';
  calculated_at: Date;
  label_version: string;
}

// ============================================================
// S5.3 — OUTCOME LABELING TYPES
// ============================================================

/**
 * Outcome represents the quality assessment of a sentiment signal
 * based on subsequent price movement.
 * 
 * Logic (deterministic, no ML):
 * - TRUE_POSITIVE: POSITIVE sentiment → price UP
 * - FALSE_POSITIVE: POSITIVE sentiment → price DOWN/FLAT  
 * - TRUE_NEGATIVE: NEGATIVE sentiment → price DOWN
 * - FALSE_NEGATIVE: NEGATIVE sentiment → price UP/FLAT
 * - MISSED_OPPORTUNITY: NEUTRAL sentiment → STRONG price movement
 * - NO_SIGNAL: NEUTRAL sentiment → FLAT price
 */
export type OutcomeLabel = 
  | 'TRUE_POSITIVE'      // Signal worked: POSITIVE → UP
  | 'FALSE_POSITIVE'     // Signal failed: POSITIVE → DOWN/FLAT
  | 'TRUE_NEGATIVE'      // Signal worked: NEGATIVE → DOWN
  | 'FALSE_NEGATIVE'     // Signal failed: NEGATIVE → UP/FLAT
  | 'MISSED_OPPORTUNITY' // Could have signaled: NEUTRAL → STRONG movement
  | 'NO_SIGNAL'          // Correct neutral: NEUTRAL → FLAT
  | 'PENDING';           // Not enough data yet

export interface Outcome {
  _id?: ObjectId;
  signal_id: string;
  horizon: '5m' | '15m' | '1h' | '4h' | '24h';
  
  // Input data
  sentiment_label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  sentiment_confidence: number;
  price_direction: 'UP' | 'DOWN' | 'FLAT';
  price_magnitude: 'STRONG' | 'WEAK' | 'NONE';
  delta_pct: number;
  
  // Output label
  outcome: OutcomeLabel;
  outcome_confidence: number;  // How certain we are (based on magnitude)
  
  // Meta
  label_version: string;
  calculated_at: Date;
}

// ============================================================
// CONSTANTS
// ============================================================

const HORIZONS = [
  { key: 't0', delay: 0 },
  { key: '5m', delay: 5 * 60 * 1000 },
  { key: '15m', delay: 15 * 60 * 1000 },
  { key: '1h', delay: 60 * 60 * 1000 },
  { key: '4h', delay: 4 * 60 * 60 * 1000 },
  { key: '24h', delay: 24 * 60 * 60 * 1000 },
] as const;

// Thresholds for S5.3 Outcome Labeling (FROZEN)
const REACTION_THRESHOLDS = {
  FLAT_MAX: 0.5,      // |delta| < 0.5% = FLAT
  WEAK_MAX: 2.0,      // 0.5% - 2% = WEAK
  STRONG_MIN: 2.0,    // > 2% = STRONG
  LABEL_VERSION: 'S5.3-v1',
};

// Outcome confidence based on magnitude
const OUTCOME_CONFIDENCE = {
  STRONG: 0.95,   // High confidence when movement is strong
  WEAK: 0.70,     // Medium confidence when movement is weak
  NONE: 0.50,     // Low confidence when flat (could go either way)
};

// Asset mapping for CoinGecko
const ASSET_MAP: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'WETH': 'ethereum',
};

// ============================================================
// PRICE PROVIDER
// ============================================================

class PriceProvider {
  private cache: Map<string, { price: number; timestamp: number }> = new Map();
  private cacheTTL = 60 * 1000; // 1 minute cache
  private db: Db | null = null;
  
  /**
   * Connect to MongoDB for price fallback
   */
  private async connectDb(): Promise<Db> {
    if (this.db) return this.db;
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const client = new MongoClient(mongoUrl);
    await client.connect();
    this.db = client.db('ai_on_crypto');
    return this.db;
  }
  
  /**
   * Get current price for asset
   */
  async getPrice(asset: string): Promise<PricePoint | null> {
    const normalizedAsset = asset.toUpperCase();
    const cacheKey = normalizedAsset;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return {
        asset: normalizedAsset,
        timestamp: cached.timestamp,
        price: cached.price,
        source: 'cached',
      };
    }
    
    // Try MongoDB price_points first (DEX-based prices)
    const dbPrice = await this.getPriceFromDb(normalizedAsset);
    if (dbPrice) {
      this.cache.set(cacheKey, { price: dbPrice.price, timestamp: dbPrice.timestamp });
      return dbPrice;
    }
    
    // Fallback to CoinGecko (with rate limit handling)
    const cgPrice = await this.getPriceFromCoinGecko(normalizedAsset);
    if (cgPrice) {
      this.cache.set(cacheKey, { price: cgPrice.price, timestamp: cgPrice.timestamp });
      return cgPrice;
    }
    
    // Final fallback: use hardcoded approximate prices for testing
    const fallbackPrices: Record<string, number> = {
      'BTC': 97000,
      'ETH': 2700,
      'SOL': 200,
      'WETH': 2700,
    };
    
    if (fallbackPrices[normalizedAsset]) {
      const timestamp = Date.now();
      this.cache.set(cacheKey, { price: fallbackPrices[normalizedAsset], timestamp });
      console.warn(`[PriceProvider] Using fallback price for ${normalizedAsset}`);
      return {
        asset: normalizedAsset,
        timestamp,
        price: fallbackPrices[normalizedAsset],
        source: 'cached',
      };
    }
    
    return null;
  }
  
  /**
   * Get price from MongoDB price_points collection
   */
  private async getPriceFromDb(asset: string): Promise<PricePoint | null> {
    try {
      const db = await this.connectDb();
      const collection = db.collection('price_points');
      
      // Map asset to tokenSymbol in price_points
      const symbolMap: Record<string, string> = {
        'ETH': 'WETH',
        'WETH': 'WETH',
        // BTC doesn't have DEX price, only ETH-based
      };
      
      const symbol = symbolMap[asset] || asset;
      
      // Get latest price
      const latest = await collection.findOne(
        { tokenSymbol: symbol },
        { sort: { timestamp: -1 } }
      );
      
      if (latest && latest.priceUsd) {
        const price = parseFloat(latest.priceUsd);
        return {
          asset,
          timestamp: new Date(latest.timestamp).getTime(),
          price,
          source: 'dex',
        };
      }
      
      return null;
    } catch (error) {
      console.error(`[PriceProvider] DB error: ${error}`);
      return null;
    }
  }
  
  /**
   * Get price from CoinGecko API
   */
  private async getPriceFromCoinGecko(asset: string): Promise<PricePoint | null> {
    try {
      const coinId = ASSET_MAP[asset];
      if (!coinId) {
        console.warn(`[PriceProvider] Unknown asset: ${asset}`);
        return null;
      }
      
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_vol=true`;
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[PriceProvider] CoinGecko rate limited');
        } else {
          console.error(`[PriceProvider] CoinGecko error: ${response.status}`);
        }
        return null;
      }
      
      const data = await response.json();
      const coinData = data[coinId];
      
      if (!coinData || !coinData.usd) {
        console.error(`[PriceProvider] No price data for ${coinId}`);
        return null;
      }
      
      return {
        asset,
        timestamp: Date.now(),
        price: coinData.usd,
        volume24h: coinData.usd_24h_vol,
        source: 'coingecko',
      };
    } catch (error: any) {
      console.error(`[PriceProvider] Error fetching price: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Get price at specific timestamp (uses current price if recent)
   */
  async getPriceAt(asset: string, timestamp: number): Promise<PricePoint | null> {
    // For now, use current price (historical requires paid API)
    // In production, could use stored price_points collection
    const currentPrice = await this.getPrice(asset);
    if (currentPrice) {
      return {
        ...currentPrice,
        timestamp,
      };
    }
    return null;
  }
}

// ============================================================
// PRICE LAYER SERVICE
// ============================================================

class PriceLayerService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private signalEvents: Collection<SignalEvent> | null = null;
  private priceObservations: Collection<PriceObservation> | null = null;
  private priceReactions: Collection<PriceReaction> | null = null;
  private outcomes: Collection<Outcome> | null = null;
  
  private priceProvider = new PriceProvider();
  private pendingSnapshots: Map<string, NodeJS.Timeout[]> = new Map();
  
  /**
   * Connect to MongoDB
   */
  async connect(): Promise<void> {
    if (this.db) return;
    
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    this.client = new MongoClient(mongoUrl);
    await this.client.connect();
    this.db = this.client.db('ai_on_crypto');
    
    this.signalEvents = this.db.collection('signal_events');
    this.priceObservations = this.db.collection('price_observations');
    this.priceReactions = this.db.collection('price_reactions');
    this.outcomes = this.db.collection('outcomes');
    
    // Create indexes
    await this.signalEvents.createIndex({ signal_id: 1 }, { unique: true });
    await this.signalEvents.createIndex({ asset: 1, timestamp: -1 });
    await this.signalEvents.createIndex({ 'sentiment.label': 1 });
    
    await this.priceObservations.createIndex({ signal_id: 1, horizon: 1 }, { unique: true });
    await this.priceObservations.createIndex({ signal_id: 1 });
    
    await this.priceReactions.createIndex({ signal_id: 1, horizon: 1 }, { unique: true });
    await this.priceReactions.createIndex({ signal_id: 1 });
    await this.priceReactions.createIndex({ direction: 1, magnitude: 1 });
    
    // S5.3 — Outcomes indexes
    await this.outcomes.createIndex({ signal_id: 1, horizon: 1 }, { unique: true });
    await this.outcomes.createIndex({ outcome: 1, horizon: 1 });
    await this.outcomes.createIndex({ sentiment_label: 1, outcome: 1 });
    
    console.log('[PriceLayer] Connected to MongoDB');
  }
  
  /**
   * Create a new SignalEvent and start collecting price snapshots
   */
  async createSignalEvent(data: Omit<SignalEvent, '_id' | 'signal_id' | 'created_at'>): Promise<SignalEvent> {
    await this.connect();
    if (!this.signalEvents || !this.priceObservations) throw new Error('Not connected');
    
    const signal_id = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const signalEvent: SignalEvent = {
      signal_id,
      ...data,
      created_at: new Date(),
    };
    
    await this.signalEvents.insertOne(signalEvent);
    
    // Collect t0 price immediately
    await this.collectPriceSnapshot(signal_id, data.asset, data.timestamp, 't0');
    
    // Schedule future snapshots
    this.scheduleSnapshots(signal_id, data.asset, data.timestamp);
    
    console.log(`[PriceLayer] Created SignalEvent: ${signal_id} for ${data.asset}`);
    
    return signalEvent;
  }
  
  /**
   * Schedule price snapshots for all horizons
   */
  private scheduleSnapshots(signal_id: string, asset: string, t0: number): void {
    const timeouts: NodeJS.Timeout[] = [];
    
    for (const horizon of HORIZONS) {
      if (horizon.key === 't0') continue; // Already collected
      
      const timeout = setTimeout(async () => {
        const targetTs = t0 + horizon.delay;
        await this.collectPriceSnapshot(signal_id, asset, targetTs, horizon.key);
        
        // Calculate reaction after collecting
        if (horizon.key !== 't0') {
          await this.calculateReaction(signal_id, horizon.key as any);
        }
      }, horizon.delay);
      
      timeouts.push(timeout);
    }
    
    this.pendingSnapshots.set(signal_id, timeouts);
  }
  
  /**
   * Collect price snapshot for a signal at specific horizon
   */
  async collectPriceSnapshot(
    signal_id: string,
    asset: string,
    timestamp: number,
    horizon: PriceObservation['horizon']
  ): Promise<PriceObservation | null> {
    await this.connect();
    if (!this.priceObservations) throw new Error('Not connected');
    
    try {
      const pricePoint = await this.priceProvider.getPrice(asset);
      if (!pricePoint) {
        console.error(`[PriceLayer] Failed to get price for ${asset} at ${horizon}`);
        return null;
      }
      
      const observation: PriceObservation = {
        signal_id,
        horizon,
        timestamp,
        price: pricePoint.price,
        volume: pricePoint.volume24h,
        source: pricePoint.source,
        collected_at: new Date(),
      };
      
      // Upsert (in case of retry)
      await this.priceObservations.updateOne(
        { signal_id, horizon },
        { $set: observation },
        { upsert: true }
      );
      
      console.log(`[PriceLayer] Collected ${horizon} price for ${signal_id}: $${pricePoint.price.toFixed(2)}`);
      
      return observation;
    } catch (error: any) {
      console.error(`[PriceLayer] Error collecting snapshot: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Calculate price reaction for a horizon
   */
  async calculateReaction(
    signal_id: string,
    horizon: PriceReaction['horizon']
  ): Promise<PriceReaction | null> {
    await this.connect();
    if (!this.priceObservations || !this.priceReactions) throw new Error('Not connected');
    
    try {
      // Get t0 and horizon prices
      const t0Obs = await this.priceObservations.findOne({ signal_id, horizon: 't0' });
      const hObs = await this.priceObservations.findOne({ signal_id, horizon });
      
      if (!t0Obs || !hObs) {
        console.warn(`[PriceLayer] Missing observations for ${signal_id} ${horizon}`);
        return null;
      }
      
      const price_t0 = t0Obs.price;
      const price_h = hObs.price;
      const delta_pct = ((price_h - price_t0) / price_t0) * 100;
      
      // Determine direction
      let direction: PriceReaction['direction'];
      if (Math.abs(delta_pct) < REACTION_THRESHOLDS.FLAT_MAX) {
        direction = 'FLAT';
      } else if (delta_pct > 0) {
        direction = 'UP';
      } else {
        direction = 'DOWN';
      }
      
      // Determine magnitude
      let magnitude: PriceReaction['magnitude'];
      const absDelta = Math.abs(delta_pct);
      if (absDelta < REACTION_THRESHOLDS.FLAT_MAX) {
        magnitude = 'NONE';
      } else if (absDelta < REACTION_THRESHOLDS.WEAK_MAX) {
        magnitude = 'WEAK';
      } else {
        magnitude = 'STRONG';
      }
      
      const reaction: PriceReaction = {
        signal_id,
        horizon,
        price_t0,
        price_h,
        delta_pct,
        direction,
        magnitude,
        calculated_at: new Date(),
        label_version: REACTION_THRESHOLDS.LABEL_VERSION,
      };
      
      // Upsert
      await this.priceReactions.updateOne(
        { signal_id, horizon },
        { $set: reaction },
        { upsert: true }
      );
      
      console.log(`[PriceLayer] Calculated ${horizon} reaction for ${signal_id}: ${direction} ${magnitude} (${delta_pct.toFixed(2)}%)`);
      
      // S5.3 — Auto-label outcome after calculating reaction
      await this.labelOutcome(signal_id, horizon);
      
      return reaction;
    } catch (error: any) {
      console.error(`[PriceLayer] Error calculating reaction: ${error.message}`);
      return null;
    }
  }
  
  // ============================================================
  // S5.3 — OUTCOME LABELING
  // ============================================================
  
  /**
   * Deterministic Outcome Labeling
   * 
   * Maps (sentiment_label, price_direction) → outcome
   * 
   * Truth table:
   * | Sentiment | Direction | Outcome            |
   * |-----------|-----------|-------------------|
   * | POSITIVE  | UP        | TRUE_POSITIVE     |
   * | POSITIVE  | DOWN      | FALSE_POSITIVE    |
   * | POSITIVE  | FLAT      | FALSE_POSITIVE    |
   * | NEGATIVE  | DOWN      | TRUE_NEGATIVE     |
   * | NEGATIVE  | UP        | FALSE_NEGATIVE    |
   * | NEGATIVE  | FLAT      | FALSE_NEGATIVE    |
   * | NEUTRAL   | UP/DOWN   | MISSED_OPPORTUNITY (if STRONG) |
   * | NEUTRAL   | UP/DOWN   | NO_SIGNAL (if WEAK) |
   * | NEUTRAL   | FLAT      | NO_SIGNAL         |
   */
  async labelOutcome(
    signal_id: string,
    horizon: Outcome['horizon']
  ): Promise<Outcome | null> {
    await this.connect();
    if (!this.signalEvents || !this.priceReactions || !this.outcomes) {
      throw new Error('Not connected');
    }
    
    try {
      // Get signal and reaction
      const signal = await this.signalEvents.findOne({ signal_id });
      const reaction = await this.priceReactions.findOne({ signal_id, horizon });
      
      if (!signal || !reaction) {
        console.warn(`[Outcome] Missing data for ${signal_id} ${horizon}`);
        return null;
      }
      
      const sentimentLabel = signal.sentiment.label;
      const direction = reaction.direction;
      const magnitude = reaction.magnitude;
      
      // Determine outcome label
      let outcomeLabel: OutcomeLabel;
      
      if (sentimentLabel === 'POSITIVE') {
        if (direction === 'UP') {
          outcomeLabel = 'TRUE_POSITIVE';
        } else {
          outcomeLabel = 'FALSE_POSITIVE';
        }
      } else if (sentimentLabel === 'NEGATIVE') {
        if (direction === 'DOWN') {
          outcomeLabel = 'TRUE_NEGATIVE';
        } else {
          outcomeLabel = 'FALSE_NEGATIVE';
        }
      } else {
        // NEUTRAL
        if (direction === 'FLAT' || magnitude === 'NONE') {
          outcomeLabel = 'NO_SIGNAL';
        } else if (magnitude === 'STRONG') {
          outcomeLabel = 'MISSED_OPPORTUNITY';
        } else {
          outcomeLabel = 'NO_SIGNAL'; // WEAK movement from NEUTRAL = acceptable
        }
      }
      
      // Calculate outcome confidence based on magnitude
      let outcomeConfidence: number;
      switch (magnitude) {
        case 'STRONG':
          outcomeConfidence = OUTCOME_CONFIDENCE.STRONG;
          break;
        case 'WEAK':
          outcomeConfidence = OUTCOME_CONFIDENCE.WEAK;
          break;
        default:
          outcomeConfidence = OUTCOME_CONFIDENCE.NONE;
      }
      
      const outcome: Outcome = {
        signal_id,
        horizon,
        sentiment_label: sentimentLabel,
        sentiment_confidence: signal.sentiment.confidence,
        price_direction: direction,
        price_magnitude: magnitude,
        delta_pct: reaction.delta_pct,
        outcome: outcomeLabel,
        outcome_confidence: outcomeConfidence,
        label_version: REACTION_THRESHOLDS.LABEL_VERSION,
        calculated_at: new Date(),
      };
      
      // Upsert
      await this.outcomes.updateOne(
        { signal_id, horizon },
        { $set: outcome },
        { upsert: true }
      );
      
      console.log(`[Outcome] Labeled ${signal_id} ${horizon}: ${outcomeLabel} (conf: ${outcomeConfidence})`);
      
      // S6.1 — Create ObservationRow after outcome labeling (fire-and-forget)
      this.createObservationRow(signal_id, horizon, signal, reaction, outcomeLabel).catch(err => {
        console.warn(`[Outcome→Observation] Failed to create ObservationRow: ${err.message}`);
      });
      
      return outcome;
    } catch (error: any) {
      console.error(`[Outcome] Error labeling: ${error.message}`);
      return null;
    }
  }
  
  /**
   * S6.1 — Create ObservationRow from signal data
   * Called after outcome labeling to populate observation_rows collection.
   */
  private async createObservationRow(
    signal_id: string,
    horizon: '5m' | '15m' | '1h' | '4h' | '24h',
    signal: SignalEvent,
    reaction: PriceReaction,
    outcomeLabel: OutcomeLabel
  ): Promise<void> {
    try {
      const observationService = await getObservationService();
      
      // Get t0 price
      const t0Obs = await this.priceObservations?.findOne({ signal_id, horizon: 't0' });
      if (!t0Obs) {
        console.warn(`[Outcome→Observation] No t0 price for ${signal_id}`);
        return;
      }
      
      // Prepare sentiment data
      const sentimentData = {
        label: signal.sentiment.label as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE',
        score: signal.sentiment.score || 0.5,
        confidence: signal.sentiment.confidence || 0.5,
        booster_applied: (signal.sentiment.cnn_flags || []).includes('cnn_positive_boost'),
        cnn_label: (signal.sentiment as any).cnn_label || null,
        cnn_confidence: (signal.sentiment as any).cnn_confidence || null,
        bullish_analysis: signal.sentiment.bullish_analysis as any || null,
      };
      
      // Create observation row
      await observationService.createObservation({
        signal_id,
        tweet_id: (signal.meta as any)?.tweet_id,
        asset: signal.asset as 'BTC' | 'ETH' | 'SOL',
        timestamp_t0: new Date(signal.timestamp),
        horizon,
        sentiment: sentimentData,
        price_t0: t0Obs.price,
        reaction: {
          direction: reaction.direction,
          magnitude: reaction.magnitude,
          delta_pct: reaction.delta_pct,
        },
        outcome_label: outcomeLabel,
        social: {
          likes: signal.meta?.engagement?.likes || 0,
          reposts: signal.meta?.engagement?.reposts || 0,
          replies: signal.meta?.engagement?.replies || 0,
          influence_score: null,
          signal_strength: 'NORMAL',
        },
        text: signal.meta?.text,
      });
      
      console.log(`[Outcome→Observation] Created ObservationRow for ${signal_id}/${horizon}`);
    } catch (error: any) {
      console.error(`[Outcome→Observation] Error: ${error.message}`);
    }
  }
  
  /**
   * Get outcomes for a signal
   */
  async getOutcomes(signal_id: string): Promise<Outcome[]> {
    await this.connect();
    if (!this.outcomes) throw new Error('Not connected');
    
    return this.outcomes.find({ signal_id }).toArray();
  }
  
  /**
   * Get outcome statistics for Admin UI
   */
  async getOutcomeStats(): Promise<{
    totalOutcomes: number;
    outcomesByLabel: Record<string, number>;
    outcomesBySentiment: Record<string, Record<string, number>>;
    accuracyByHorizon: Record<string, { total: number; correct: number; rate: number }>;
    avgConfidenceByOutcome: Record<string, number>;
  }> {
    await this.connect();
    if (!this.outcomes) throw new Error('Not connected');
    
    const totalOutcomes = await this.outcomes.countDocuments();
    
    // By outcome label
    const labelAgg = await this.outcomes.aggregate([
      { $group: { _id: '$outcome', count: { $sum: 1 } } }
    ]).toArray();
    const outcomesByLabel: Record<string, number> = {};
    labelAgg.forEach(l => outcomesByLabel[l._id] = l.count);
    
    // By sentiment → outcome
    const sentimentAgg = await this.outcomes.aggregate([
      { $group: { _id: { sentiment: '$sentiment_label', outcome: '$outcome' }, count: { $sum: 1 } } }
    ]).toArray();
    const outcomesBySentiment: Record<string, Record<string, number>> = {};
    sentimentAgg.forEach(s => {
      const sentiment = s._id.sentiment;
      const outcome = s._id.outcome;
      if (!outcomesBySentiment[sentiment]) outcomesBySentiment[sentiment] = {};
      outcomesBySentiment[sentiment][outcome] = s.count;
    });
    
    // Accuracy by horizon (TRUE_* = correct, FALSE_* = incorrect)
    const horizonAgg = await this.outcomes.aggregate([
      { 
        $group: { 
          _id: '$horizon', 
          total: { $sum: 1 },
          correct: { 
            $sum: { 
              $cond: [
                { $in: ['$outcome', ['TRUE_POSITIVE', 'TRUE_NEGATIVE', 'NO_SIGNAL']] },
                1, 
                0
              ] 
            } 
          }
        } 
      }
    ]).toArray();
    const accuracyByHorizon: Record<string, { total: number; correct: number; rate: number }> = {};
    horizonAgg.forEach(h => {
      accuracyByHorizon[h._id] = {
        total: h.total,
        correct: h.correct,
        rate: h.total > 0 ? h.correct / h.total : 0,
      };
    });
    
    // Avg confidence by outcome
    const confAgg = await this.outcomes.aggregate([
      { $group: { _id: '$outcome', avgConf: { $avg: '$outcome_confidence' } } }
    ]).toArray();
    const avgConfidenceByOutcome: Record<string, number> = {};
    confAgg.forEach(c => avgConfidenceByOutcome[c._id] = c.avgConf);
    
    return {
      totalOutcomes,
      outcomesByLabel,
      outcomesBySentiment,
      accuracyByHorizon,
      avgConfidenceByOutcome,
    };
  }
  
  /**
   * Get signal event with all observations, reactions, and outcomes
   */
  async getSignalWithPriceData(signal_id: string): Promise<{
    signal: SignalEvent;
    observations: PriceObservation[];
    reactions: PriceReaction[];
    outcomes: Outcome[];
  } | null> {
    await this.connect();
    if (!this.signalEvents || !this.priceObservations || !this.priceReactions || !this.outcomes) {
      throw new Error('Not connected');
    }
    
    const signal = await this.signalEvents.findOne({ signal_id });
    if (!signal) return null;
    
    const observations = await this.priceObservations.find({ signal_id }).toArray();
    const reactions = await this.priceReactions.find({ signal_id }).toArray();
    const outcomes = await this.outcomes.find({ signal_id }).toArray();
    
    return { signal, observations, reactions, outcomes };
  }
  
  /**
   * Get statistics for Admin UI (includes S5.3 outcomes)
   */
  async getStats(): Promise<{
    totalSignals: number;
    signalsByAsset: Record<string, number>;
    signalsBySentiment: Record<string, number>;
    reactionsByDirection: Record<string, number>;
    reactionsByMagnitude: Record<string, number>;
    avgDeltaByHorizon: Record<string, number>;
    completenessRate: number;
    // S5.3 Outcome stats
    totalOutcomes: number;
    outcomesByLabel: Record<string, number>;
    signalAccuracy: number;
  }> {
    await this.connect();
    if (!this.signalEvents || !this.priceObservations || !this.priceReactions || !this.outcomes) {
      throw new Error('Not connected');
    }
    
    const totalSignals = await this.signalEvents.countDocuments();
    
    // By asset
    const assetAgg = await this.signalEvents.aggregate([
      { $group: { _id: '$asset', count: { $sum: 1 } } }
    ]).toArray();
    const signalsByAsset: Record<string, number> = {};
    assetAgg.forEach(a => signalsByAsset[a._id] = a.count);
    
    // By sentiment
    const sentimentAgg = await this.signalEvents.aggregate([
      { $group: { _id: '$sentiment.label', count: { $sum: 1 } } }
    ]).toArray();
    const signalsBySentiment: Record<string, number> = {};
    sentimentAgg.forEach(s => signalsBySentiment[s._id] = s.count);
    
    // Reactions by direction
    const dirAgg = await this.priceReactions.aggregate([
      { $group: { _id: '$direction', count: { $sum: 1 } } }
    ]).toArray();
    const reactionsByDirection: Record<string, number> = {};
    dirAgg.forEach(d => reactionsByDirection[d._id] = d.count);
    
    // Reactions by magnitude
    const magAgg = await this.priceReactions.aggregate([
      { $group: { _id: '$magnitude', count: { $sum: 1 } } }
    ]).toArray();
    const reactionsByMagnitude: Record<string, number> = {};
    magAgg.forEach(m => reactionsByMagnitude[m._id] = m.count);
    
    // Avg delta by horizon
    const deltaAgg = await this.priceReactions.aggregate([
      { $group: { _id: '$horizon', avgDelta: { $avg: '$delta_pct' } } }
    ]).toArray();
    const avgDeltaByHorizon: Record<string, number> = {};
    deltaAgg.forEach(d => avgDeltaByHorizon[d._id] = d.avgDelta);
    
    // Completeness rate
    const totalT0 = await this.priceObservations.countDocuments({ horizon: 't0' });
    const total1h = await this.priceObservations.countDocuments({ horizon: '1h' });
    const completenessRate = totalSignals > 0 ? (total1h / totalSignals) : 0;
    
    // S5.3 — Outcome statistics
    const totalOutcomes = await this.outcomes.countDocuments();
    
    const labelAgg = await this.outcomes.aggregate([
      { $group: { _id: '$outcome', count: { $sum: 1 } } }
    ]).toArray();
    const outcomesByLabel: Record<string, number> = {};
    labelAgg.forEach(l => outcomesByLabel[l._id] = l.count);
    
    // Signal accuracy = (TRUE_POSITIVE + TRUE_NEGATIVE + NO_SIGNAL) / total
    const correctOutcomes = (outcomesByLabel['TRUE_POSITIVE'] || 0) + 
                            (outcomesByLabel['TRUE_NEGATIVE'] || 0) + 
                            (outcomesByLabel['NO_SIGNAL'] || 0);
    const signalAccuracy = totalOutcomes > 0 ? correctOutcomes / totalOutcomes : 0;
    
    return {
      totalSignals,
      signalsByAsset,
      signalsBySentiment,
      reactionsByDirection,
      reactionsByMagnitude,
      avgDeltaByHorizon,
      completenessRate,
      totalOutcomes,
      outcomesByLabel,
      signalAccuracy,
    };
  }
  
  /**
   * Get recent signals with price data for Admin UI
   */
  async getRecentSignals(limit: number = 20): Promise<Array<{
    signal: SignalEvent;
    t0_price?: number;
    reactions: PriceReaction[];
  }>> {
    await this.connect();
    if (!this.signalEvents || !this.priceObservations || !this.priceReactions) {
      throw new Error('Not connected');
    }
    
    const signals = await this.signalEvents
      .find({})
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    
    const results = [];
    
    for (const signal of signals) {
      const t0Obs = await this.priceObservations.findOne({ signal_id: signal.signal_id, horizon: 't0' });
      const reactions = await this.priceReactions.find({ signal_id: signal.signal_id }).toArray();
      
      results.push({
        signal,
        t0_price: t0Obs?.price,
        reactions,
      });
    }
    
    return results;
  }
  
  /**
   * Get correlation matrix (Sentiment × Outcome)
   */
  async getCorrelationMatrix(): Promise<{
    matrix: Array<{
      sentiment: string;
      direction: string;
      horizon: string;
      count: number;
      avgDelta: number;
    }>;
    totals: Record<string, number>;
  }> {
    await this.connect();
    if (!this.signalEvents || !this.priceReactions) throw new Error('Not connected');
    
    // Join signals with reactions
    const pipeline = [
      {
        $lookup: {
          from: 'price_reactions',
          localField: 'signal_id',
          foreignField: 'signal_id',
          as: 'reactions'
        }
      },
      { $unwind: '$reactions' },
      {
        $group: {
          _id: {
            sentiment: '$sentiment.label',
            direction: '$reactions.direction',
            horizon: '$reactions.horizon'
          },
          count: { $sum: 1 },
          avgDelta: { $avg: '$reactions.delta_pct' }
        }
      }
    ];
    
    const result = await this.signalEvents.aggregate(pipeline).toArray();
    
    const matrix = result.map(r => ({
      sentiment: r._id.sentiment,
      direction: r._id.direction,
      horizon: r._id.horizon,
      count: r.count,
      avgDelta: r.avgDelta,
    }));
    
    // Calculate totals
    const totals: Record<string, number> = {};
    matrix.forEach(m => {
      const key = `${m.sentiment}_${m.direction}`;
      totals[key] = (totals[key] || 0) + m.count;
    });
    
    return { matrix, totals };
  }
}

// Singleton
export const priceLayerService = new PriceLayerService();
