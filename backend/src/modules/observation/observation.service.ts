/**
 * S6.1 — Observation Model Dataset
 * S6.2 — Observation Targets & Metrics
 * S6.3 — Observation Rules v0
 * =================================
 * 
 * ObservationRow = SignalEvent + Market Context + Tweet Context + Outcome + Targets + Decision
 * 
 * ЦЕЛЬ: Ответить на вопрос "Когда sentiment стоит учитывать?"
 * 
 * НЕ ML. Только сбор, нормализация и детерминированные правила.
 * 
 * LOCKED CONTRACT — не менять без версионирования.
 */

import { MongoClient, Db, Collection, ObjectId } from 'mongodb';

// ============================================================
// Types — LOCKED CONTRACT v2 (S6.2 + S6.3)
// ============================================================

/**
 * S6.3 — Observation Decision Types
 */
export type ObservationDecision = 'USE' | 'IGNORE' | 'MISS_ALERT';

export interface ObservationRow {
  _id?: ObjectId;
  
  // A. Identifiers
  observation_id: string;
  signal_id: string;
  tweet_id?: string;
  asset: 'BTC' | 'ETH' | 'SOL';
  timestamp_t0: Date;
  horizon: '5m' | '15m' | '1h' | '4h' | '24h';
  
  // B. Sentiment Features (v1.6 FROZEN)
  sentiment: {
    label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    score: number;
    confidence: number;
    booster_applied: boolean;
    cnn_label?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
    cnn_confidence?: number | null;
    bullish_analysis?: 'VALID' | 'BLOCKED' | 'HARD_BLOCK' | 'IGNORE' | null;
  };
  
  // C. Market Context (deterministic, no ML)
  market: {
    price_t0: number;
    delta_15m_before: number | null;  // % change price[t0] vs price[t0-15m]
    delta_1h_before: number | null;
    delta_4h_before: number | null;
    delta_24h_before: number | null;
    volatility_1h: number | null;     // abs(high-low)/price за 1h до t0
    range_1h: number | null;          // high-low / price
    momentum_15m: number | null;      // = delta_15m_before
  };
  
  // D. Tweet / Social Context
  social: {
    likes: number;
    reposts: number;
    replies: number;
    influence_score: number | null;
    signal_strength: 'WEAK' | 'NORMAL' | 'STRONG';
    text_length: number;
    has_link: boolean;
    has_media: boolean;
    has_question: boolean;
    conflict_terms: boolean;
  };
  
  // E. Outcome (from S5.3)
  outcome: {
    reaction_direction: 'UP' | 'DOWN' | 'FLAT';
    reaction_magnitude: 'STRONG' | 'WEAK' | 'NONE';
    outcome_label: 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'TRUE_NEGATIVE' | 'FALSE_NEGATIVE' | 'MISSED_OPPORTUNITY' | 'NO_SIGNAL';
    delta_pct: number;
  };
  
  // F. Observation Targets (S6.2 — computed, no ML)
  targets: {
    usable_signal: boolean;       // conf >= 0.7 && (TP || TN)
    missed_opportunity: boolean;  // NEUTRAL + STRONG movement
    false_confidence: boolean;    // conf >= 0.7 && FP
    noise_signal: boolean;        // high engagement + FP
  };
  
  // G. Observation Decision (S6.3 — rule-based, no ML)
  decision: {
    verdict: ObservationDecision;  // USE | IGNORE | MISS_ALERT
    reasons: string[];             // ["high_confidence", "true_positive", ...]
    version: string;               // "v0"
  };
  
  // Meta
  schema_version: string;
  created_at: Date;
}

// ============================================================
// Constants
// ============================================================

const SCHEMA_VERSION = 'S6.3-v2';  // Updated for training readiness
const DECISION_VERSION = 'v0.1';   // Relaxed for data collection phase

// Thresholds for target computation (S6.2)
// NOTE: Relaxed for data collection phase to get class balance
const THRESHOLDS = {
  USABLE_CONFIDENCE_MIN: 0.65,    // Relaxed from 0.7 for data collection
  LOW_CONFIDENCE_MAX: 0.55,       // Relaxed from 0.6
  HIGH_ENGAGEMENT_THRESHOLD: 100,  // likes + reposts
  HIGH_INFLUENCE_THRESHOLD: 50,    // influence_score
};

// Horizons considered stable for USE decision (S6.3)
// NOTE: Expanded for data collection phase to get USE examples
const STABLE_HORIZONS = ['15m', '1h', '4h'] as const;  // Added 15m for early phase


// Conflict terms that suggest uncertainty
const CONFLICT_TERMS = [
  'but', 'however', 'although', 'maybe', 'might', 'could', 'uncertain',
  'not sure', 'risky', 'careful', 'watch out', 'both ways', 'either way',
];

// ============================================================
// Observation Service
// ============================================================

class ObservationService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private observations: Collection<ObservationRow> | null = null;
  private pricePoints: Collection | null = null;
  
  async connect(): Promise<void> {
    if (this.db) return;
    
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    this.client = new MongoClient(mongoUrl);
    await this.client.connect();
    this.db = this.client.db('ai_on_crypto');
    
    this.observations = this.db.collection('observation_rows');
    this.pricePoints = this.db.collection('price_points');
    
    // Create indexes
    await this.observations.createIndex({ observation_id: 1 }, { unique: true });
    await this.observations.createIndex({ signal_id: 1, horizon: 1 });
    await this.observations.createIndex({ asset: 1, timestamp_t0: -1 });
    await this.observations.createIndex({ 'targets.usable_signal': 1 });
    await this.observations.createIndex({ 'targets.missed_risk': 1 });
    await this.observations.createIndex({ 'outcome.outcome_label': 1 });
    
    console.log('[Observation] Connected to MongoDB');
  }
  
  /**
   * Create ObservationRow from SignalEvent + PriceReaction + Outcome
   * Now includes S6.2 targets and S6.3 decision
   */
  async createObservation(params: {
    signal_id: string;
    tweet_id?: string;
    asset: 'BTC' | 'ETH' | 'SOL';
    timestamp_t0: Date;
    horizon: '5m' | '15m' | '1h' | '4h' | '24h';
    sentiment: ObservationRow['sentiment'];
    price_t0: number;
    reaction: {
      direction: 'UP' | 'DOWN' | 'FLAT';
      magnitude: 'STRONG' | 'WEAK' | 'NONE';
      delta_pct: number;
    };
    outcome_label: ObservationRow['outcome']['outcome_label'];
    social?: Partial<ObservationRow['social']>;
    text?: string;
  }): Promise<ObservationRow> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    // Generate observation_id
    const observation_id = `obs_${params.signal_id}_${params.horizon}`;
    
    // Get market context
    const market = await this.getMarketContext(params.asset, params.timestamp_t0, params.price_t0);
    
    // Compute social context
    const social = this.computeSocialContext(params.social, params.text);
    
    // Build outcome
    const outcome: ObservationRow['outcome'] = {
      reaction_direction: params.reaction.direction,
      reaction_magnitude: params.reaction.magnitude,
      outcome_label: params.outcome_label,
      delta_pct: params.reaction.delta_pct,
    };
    
    // S6.2 — Compute targets (deterministic, no ML)
    const targets = this.computeTargets(params.sentiment, outcome, social);
    
    // S6.3 — Compute decision (rule-based, no ML)
    const decision = this.computeDecision(params.sentiment, outcome, targets, params.horizon);
    
    const row: ObservationRow = {
      observation_id,
      signal_id: params.signal_id,
      tweet_id: params.tweet_id,
      asset: params.asset,
      timestamp_t0: params.timestamp_t0,
      horizon: params.horizon,
      sentiment: params.sentiment,
      market,
      social,
      outcome,
      targets,
      decision,
      schema_version: SCHEMA_VERSION,
      created_at: new Date(),
    };
    
    // Upsert
    await this.observations.updateOne(
      { observation_id },
      { $set: row },
      { upsert: true }
    );
    
    console.log(`[Observation] Created ${observation_id}: decision=${decision.verdict}, usable=${targets.usable_signal}, missed=${targets.missed_opportunity}`);
    
    return row;
  }
  
  /**
   * Get market context features
   * All computed RELATIVE to t0
   */
  private async getMarketContext(
    asset: string,
    t0: Date,
    price_t0: number
  ): Promise<ObservationRow['market']> {
    const market: ObservationRow['market'] = {
      price_t0,
      delta_15m_before: null,
      delta_1h_before: null,
      delta_4h_before: null,
      delta_24h_before: null,
      volatility_1h: null,
      range_1h: null,
      momentum_15m: null,
    };
    
    if (!this.pricePoints) return market;
    
    try {
      // Get historical prices before t0
      const prices = await this.pricePoints.find({
        symbol: asset,
        timestamp: {
          $gte: new Date(t0.getTime() - 24 * 60 * 60 * 1000),
          $lt: t0,
        },
      }).sort({ timestamp: 1 }).toArray();
      
      if (prices.length === 0) return market;
      
      // Find prices at specific times before t0
      const findPriceAt = (minutesBefore: number): number | null => {
        const targetTime = t0.getTime() - minutesBefore * 60 * 1000;
        const tolerance = 5 * 60 * 1000; // 5 min tolerance
        
        const match = prices.find(p => 
          Math.abs(new Date(p.timestamp).getTime() - targetTime) < tolerance
        );
        
        return match ? parseFloat(match.priceUsd) : null;
      };
      
      // Compute deltas
      const price15m = findPriceAt(15);
      const price1h = findPriceAt(60);
      const price4h = findPriceAt(240);
      const price24h = findPriceAt(1440);
      
      if (price15m) market.delta_15m_before = ((price_t0 - price15m) / price15m) * 100;
      if (price1h) market.delta_1h_before = ((price_t0 - price1h) / price1h) * 100;
      if (price4h) market.delta_4h_before = ((price_t0 - price4h) / price4h) * 100;
      if (price24h) market.delta_24h_before = ((price_t0 - price24h) / price24h) * 100;
      
      // Compute volatility (1h before t0)
      const hour_ago = t0.getTime() - 60 * 60 * 1000;
      const hourPrices = prices.filter(p => new Date(p.timestamp).getTime() >= hour_ago);
      
      if (hourPrices.length > 0) {
        const priceValues = hourPrices.map(p => parseFloat(p.priceUsd));
        const high = Math.max(...priceValues);
        const low = Math.min(...priceValues);
        const avg = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;
        
        market.volatility_1h = ((high - low) / avg) * 100;
        market.range_1h = (high - low) / avg;
      }
      
      // Momentum = delta_15m_before
      market.momentum_15m = market.delta_15m_before;
      
    } catch (error) {
      console.warn(`[Observation] Market context error: ${error}`);
    }
    
    return market;
  }
  
  /**
   * Compute social context from tweet data
   */
  private computeSocialContext(
    social?: Partial<ObservationRow['social']>,
    text?: string
  ): ObservationRow['social'] {
    const result: ObservationRow['social'] = {
      likes: social?.likes || 0,
      reposts: social?.reposts || 0,
      replies: social?.replies || 0,
      influence_score: social?.influence_score || null,
      signal_strength: social?.signal_strength || 'NORMAL',
      text_length: text?.length || 0,
      has_link: text ? /https?:\/\//.test(text) : false,
      has_media: text ? /\.(jpg|jpeg|png|gif|mp4)/i.test(text) : false,
      has_question: text ? /\?/.test(text) : false,
      conflict_terms: text ? this.hasConflictTerms(text) : false,
    };
    
    // Determine signal strength based on engagement
    const engagement = result.likes + result.reposts;
    if (engagement > 1000) result.signal_strength = 'STRONG';
    else if (engagement > 100) result.signal_strength = 'NORMAL';
    else result.signal_strength = 'WEAK';
    
    return result;
  }
  
  /**
   * Check for conflict/uncertainty terms
   */
  private hasConflictTerms(text: string): boolean {
    const lowerText = text.toLowerCase();
    return CONFLICT_TERMS.some(term => lowerText.includes(term));
  }
  
  /**
   * S6.2 — Compute observation targets (deterministic, NO ML)
   * 
   * Updated formula:
   * - usable_signal: conf >= 0.7 AND (TP OR TN) — requires correct direction
   * - missed_opportunity: NEUTRAL + STRONG movement — key for S6
   * - false_confidence: conf >= 0.7 AND FP — where confidence lies
   * - noise_signal: high engagement + FP — social hype vs market effect
   */
  private computeTargets(
    sentiment: ObservationRow['sentiment'],
    outcome: ObservationRow['outcome'],
    social: ObservationRow['social']
  ): ObservationRow['targets'] {
    // Target A: usable_signal (S6.2 updated formula)
    // conf >= 0.7 AND (outcome = TRUE_POSITIVE OR outcome = TRUE_NEGATIVE)
    const usable_signal = 
      sentiment.confidence >= THRESHOLDS.USABLE_CONFIDENCE_MIN &&
      (outcome.outcome_label === 'TRUE_POSITIVE' || outcome.outcome_label === 'TRUE_NEGATIVE');
    
    // Target B: missed_opportunity
    // NEUTRAL + STRONG movement — главное золото S6
    const missed_opportunity = 
      sentiment.label === 'NEUTRAL' &&
      outcome.reaction_magnitude === 'STRONG';
    
    // Target C: false_confidence (NEW in S6.2)
    // conf >= 0.7 AND FP — where confidence lies
    const false_confidence = 
      sentiment.confidence >= THRESHOLDS.USABLE_CONFIDENCE_MIN &&
      outcome.outcome_label === 'FALSE_POSITIVE';
    
    // Target D: noise_signal (S6.2 updated)
    // high engagement OR high influence + FP
    const engagement = social.likes + social.reposts;
    const highEngagement = engagement >= THRESHOLDS.HIGH_ENGAGEMENT_THRESHOLD;
    const highInfluence = (social.influence_score || 0) >= THRESHOLDS.HIGH_INFLUENCE_THRESHOLD;
    const noise_signal = 
      (highEngagement || highInfluence) &&
      outcome.outcome_label === 'FALSE_POSITIVE';
    
    return { usable_signal, missed_opportunity, false_confidence, noise_signal };
  }
  
  /**
   * S6.3 — Compute observation decision (rule-based, NO ML)
   * 
   * Decision order (important):
   * 1. MISS_ALERT — highest priority
   * 2. USE — if signal is usable
   * 3. IGNORE — default
   * 
   * Rules v0 (LOCKED):
   * - USE: usable_signal && conf >= 0.7 && horizon in [1h, 4h] && (TP || TN)
   * - IGNORE: conf < 0.6 || NO_SIGNAL || magnitude = NONE
   * - MISS_ALERT: NEUTRAL + STRONG movement
   */
  private computeDecision(
    sentiment: ObservationRow['sentiment'],
    outcome: ObservationRow['outcome'],
    targets: ObservationRow['targets'],
    horizon: ObservationRow['horizon']
  ): ObservationRow['decision'] {
    const reasons: string[] = [];
    let verdict: ObservationDecision;
    
    // Rule C — MISS_ALERT (highest priority)
    if (targets.missed_opportunity) {
      verdict = 'MISS_ALERT';
      reasons.push('neutral_with_strong_movement');
      reasons.push(`magnitude_${outcome.reaction_magnitude.toLowerCase()}`);
      reasons.push(`direction_${outcome.reaction_direction.toLowerCase()}`);
      return { verdict, reasons, version: DECISION_VERSION };
    }
    
    // Rule A — USE
    const isStableHorizon = STABLE_HORIZONS.includes(horizon as any);
    const isHighConfidence = sentiment.confidence >= THRESHOLDS.USABLE_CONFIDENCE_MIN;
    const isCorrectOutcome = outcome.outcome_label === 'TRUE_POSITIVE' || outcome.outcome_label === 'TRUE_NEGATIVE';
    
    if (targets.usable_signal && isHighConfidence && isStableHorizon && isCorrectOutcome) {
      verdict = 'USE';
      reasons.push('high_confidence');
      reasons.push(outcome.outcome_label.toLowerCase());
      reasons.push(`horizon_${horizon}`);
      if (sentiment.booster_applied) reasons.push('cnn_boosted');
      return { verdict, reasons, version: DECISION_VERSION };
    }
    
    // Rule B — IGNORE (default)
    verdict = 'IGNORE';
    
    // Add specific ignore reasons
    if (sentiment.confidence < THRESHOLDS.LOW_CONFIDENCE_MAX) {
      reasons.push('low_confidence');
    }
    if (outcome.outcome_label === 'NO_SIGNAL') {
      reasons.push('no_signal');
    }
    if (outcome.reaction_magnitude === 'NONE') {
      reasons.push('no_movement');
    }
    if (outcome.outcome_label === 'FALSE_POSITIVE') {
      reasons.push('false_positive');
    }
    if (outcome.outcome_label === 'FALSE_NEGATIVE') {
      reasons.push('false_negative');
    }
    if (!isStableHorizon) {
      reasons.push(`unstable_horizon_${horizon}`);
    }
    if (targets.noise_signal) {
      reasons.push('noise_signal');
    }
    if (targets.false_confidence) {
      reasons.push('false_confidence');
    }
    
    // If no specific reason, add generic
    if (reasons.length === 0) {
      reasons.push('default_ignore');
    }
    
    return { verdict, reasons, version: DECISION_VERSION };
  }
  
  /**
   * Get observation statistics (S6.2 updated)
   */
  async getStats(): Promise<{
    total: number;
    usable: number;
    missed: number;
    falseConfidence: number;
    noise: number;
    byHorizon: Record<string, { total: number; usable: number; missed: number }>;
    byAsset: Record<string, number>;
    byOutcome: Record<string, number>;
    byDecision: Record<string, number>;
  }> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const total = await this.observations.countDocuments();
    const usable = await this.observations.countDocuments({ 'targets.usable_signal': true });
    const missed = await this.observations.countDocuments({ 'targets.missed_opportunity': true });
    const falseConfidence = await this.observations.countDocuments({ 'targets.false_confidence': true });
    const noise = await this.observations.countDocuments({ 'targets.noise_signal': true });
    
    // By horizon
    const horizonAgg = await this.observations.aggregate([
      {
        $group: {
          _id: '$horizon',
          total: { $sum: 1 },
          usable: { $sum: { $cond: ['$targets.usable_signal', 1, 0] } },
          missed: { $sum: { $cond: ['$targets.missed_opportunity', 1, 0] } },
        },
      },
    ]).toArray();
    
    const byHorizon: Record<string, { total: number; usable: number; missed: number }> = {};
    horizonAgg.forEach(h => {
      byHorizon[h._id] = { total: h.total, usable: h.usable, missed: h.missed };
    });
    
    // By asset
    const assetAgg = await this.observations.aggregate([
      { $group: { _id: '$asset', count: { $sum: 1 } } },
    ]).toArray();
    const byAsset: Record<string, number> = {};
    assetAgg.forEach(a => byAsset[a._id] = a.count);
    
    // By outcome
    const outcomeAgg = await this.observations.aggregate([
      { $group: { _id: '$outcome.outcome_label', count: { $sum: 1 } } },
    ]).toArray();
    const byOutcome: Record<string, number> = {};
    outcomeAgg.forEach(o => byOutcome[o._id] = o.count);
    
    // S6.3 — By decision verdict
    const decisionAgg = await this.observations.aggregate([
      { $group: { _id: '$decision.verdict', count: { $sum: 1 } } },
    ]).toArray();
    const byDecision: Record<string, number> = {};
    decisionAgg.forEach(d => byDecision[d._id || 'UNKNOWN'] = d.count);
    
    return { total, usable, missed, falseConfidence, noise, byHorizon, byAsset, byOutcome, byDecision };
  }
  
  // ============================================================
  // S6.2 — METRICS API
  // ============================================================
  
  /**
   * S6.2 — Get metrics summary
   */
  async getMetricsSummary(): Promise<{
    usableRate: number;
    missRate: number;
    falseConfidenceRate: number;
    noiseRate: number;
    total: number;
    byConfidenceBucket: Array<{
      bucket: string;
      total: number;
      usable: number;
      usableRate: number;
      tpRate: number;
    }>;
  }> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const total = await this.observations.countDocuments();
    const usable = await this.observations.countDocuments({ 'targets.usable_signal': true });
    const missed = await this.observations.countDocuments({ 'targets.missed_opportunity': true });
    const falseConf = await this.observations.countDocuments({ 'targets.false_confidence': true });
    const noise = await this.observations.countDocuments({ 'targets.noise_signal': true });
    
    const usableRate = total > 0 ? (usable / total) * 100 : 0;
    const missRate = total > 0 ? (missed / total) * 100 : 0;
    const falseConfidenceRate = total > 0 ? (falseConf / total) * 100 : 0;
    const noiseRate = total > 0 ? (noise / total) * 100 : 0;
    
    // By confidence bucket
    const buckets = [
      { name: '0.9-1.0', min: 0.9, max: 1.0 },
      { name: '0.7-0.9', min: 0.7, max: 0.9 },
      { name: '0.5-0.7', min: 0.5, max: 0.7 },
      { name: '<0.5', min: 0, max: 0.5 },
    ];
    
    const byConfidenceBucket = [];
    
    for (const bucket of buckets) {
      const bucketTotal = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
      });
      
      const bucketUsable = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
        'targets.usable_signal': true,
      });
      
      const bucketTP = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
        'outcome.outcome_label': { $in: ['TRUE_POSITIVE', 'TRUE_NEGATIVE'] },
      });
      
      byConfidenceBucket.push({
        bucket: bucket.name,
        total: bucketTotal,
        usable: bucketUsable,
        usableRate: bucketTotal > 0 ? (bucketUsable / bucketTotal) * 100 : 0,
        tpRate: bucketTotal > 0 ? (bucketTP / bucketTotal) * 100 : 0,
      });
    }
    
    return {
      usableRate,
      missRate,
      falseConfidenceRate,
      noiseRate,
      total,
      byConfidenceBucket,
    };
  }
  
  /**
   * S6.2 — Confidence Calibration
   * For each confidence bucket: expected_confidence vs actual_TP_rate
   */
  async getCalibration(): Promise<Array<{
    bucket: string;
    expectedConfidence: number;
    actualTPRate: number;
    calibrationGap: number;
    total: number;
  }>> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const buckets = [
      { name: '0.9-1.0', min: 0.9, max: 1.0, expected: 0.95 },
      { name: '0.8-0.9', min: 0.8, max: 0.9, expected: 0.85 },
      { name: '0.7-0.8', min: 0.7, max: 0.8, expected: 0.75 },
      { name: '0.6-0.7', min: 0.6, max: 0.7, expected: 0.65 },
      { name: '0.5-0.6', min: 0.5, max: 0.6, expected: 0.55 },
      { name: '<0.5', min: 0, max: 0.5, expected: 0.25 },
    ];
    
    const results = [];
    
    for (const bucket of buckets) {
      const total = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
      });
      
      const tpCount = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
        'outcome.outcome_label': { $in: ['TRUE_POSITIVE', 'TRUE_NEGATIVE'] },
      });
      
      const actualTPRate = total > 0 ? tpCount / total : 0;
      const calibrationGap = bucket.expected - actualTPRate;
      
      results.push({
        bucket: bucket.name,
        expectedConfidence: bucket.expected,
        actualTPRate,
        calibrationGap,
        total,
      });
    }
    
    return results;
  }
  
  /**
   * S6.2 — Horizon Stability
   * Compare usable_rate across horizons
   */
  async getHorizonStability(): Promise<Array<{
    horizon: string;
    total: number;
    usable: number;
    usableRate: number;
    missed: number;
    missRate: number;
    tpRate: number;
  }>> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const horizons = ['5m', '15m', '1h', '4h', '24h'];
    const results = [];
    
    for (const horizon of horizons) {
      const total = await this.observations.countDocuments({ horizon });
      const usable = await this.observations.countDocuments({ horizon, 'targets.usable_signal': true });
      const missed = await this.observations.countDocuments({ horizon, 'targets.missed_opportunity': true });
      const tp = await this.observations.countDocuments({
        horizon,
        'outcome.outcome_label': { $in: ['TRUE_POSITIVE', 'TRUE_NEGATIVE'] },
      });
      
      results.push({
        horizon,
        total,
        usable,
        usableRate: total > 0 ? (usable / total) * 100 : 0,
        missed,
        missRate: total > 0 ? (missed / total) * 100 : 0,
        tpRate: total > 0 ? (tp / total) * 100 : 0,
      });
    }
    
    return results;
  }
  
  // ============================================================
  // S6.3 — RULES API
  // ============================================================
  
  /**
   * S6.3 — Apply rules to all existing observations (re-compute decisions)
   */
  async applyRules(options?: { dryRun?: boolean }): Promise<{
    processed: number;
    updated: number;
    byDecision: Record<string, number>;
  }> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const allRows = await this.observations.find({}).toArray();
    const byDecision: Record<string, number> = { USE: 0, IGNORE: 0, MISS_ALERT: 0 };
    let updated = 0;
    
    for (const row of allRows) {
      // Recompute targets with new formula
      const targets = this.computeTargets(row.sentiment, row.outcome, row.social);
      
      // Compute decision
      const decision = this.computeDecision(row.sentiment, row.outcome, targets, row.horizon);
      
      byDecision[decision.verdict] = (byDecision[decision.verdict] || 0) + 1;
      
      if (!options?.dryRun) {
        await this.observations.updateOne(
          { observation_id: row.observation_id },
          { 
            $set: { 
              targets, 
              decision,
              schema_version: SCHEMA_VERSION,
            } 
          }
        );
        updated++;
      }
    }
    
    console.log(`[Observation Rules] Applied v0 rules: USE=${byDecision.USE}, IGNORE=${byDecision.IGNORE}, MISS_ALERT=${byDecision.MISS_ALERT}`);
    
    return {
      processed: allRows.length,
      updated: options?.dryRun ? 0 : updated,
      byDecision,
    };
  }
  
  /**
   * S6.3 — Get rules statistics
   */
  async getRulesStats(): Promise<{
    total: number;
    byDecision: Record<string, number>;
    byDecisionPercent: Record<string, number>;
    useByConfidence: Array<{ bucket: string; count: number; rate: number }>;
    missByHorizon: Array<{ horizon: string; count: number; rate: number }>;
    missReasonsTop: Array<{ reason: string; count: number }>;
  }> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const total = await this.observations.countDocuments();
    
    // By decision
    const decisionAgg = await this.observations.aggregate([
      { $group: { _id: '$decision.verdict', count: { $sum: 1 } } },
    ]).toArray();
    
    const byDecision: Record<string, number> = { USE: 0, IGNORE: 0, MISS_ALERT: 0 };
    const byDecisionPercent: Record<string, number> = { USE: 0, IGNORE: 0, MISS_ALERT: 0 };
    
    decisionAgg.forEach(d => {
      const key = d._id || 'UNKNOWN';
      byDecision[key] = d.count;
      byDecisionPercent[key] = total > 0 ? (d.count / total) * 100 : 0;
    });
    
    // USE by confidence bucket
    const confidenceBuckets = [
      { name: '0.9-1.0', min: 0.9, max: 1.0 },
      { name: '0.7-0.9', min: 0.7, max: 0.9 },
      { name: '<0.7', min: 0, max: 0.7 },
    ];
    
    const useByConfidence = [];
    for (const bucket of confidenceBuckets) {
      const bucketTotal = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
      });
      const useCount = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
        'decision.verdict': 'USE',
      });
      useByConfidence.push({
        bucket: bucket.name,
        count: useCount,
        rate: bucketTotal > 0 ? (useCount / bucketTotal) * 100 : 0,
      });
    }
    
    // MISS_ALERT by horizon
    const horizons = ['5m', '15m', '1h', '4h', '24h'];
    const missByHorizon = [];
    for (const horizon of horizons) {
      const horizonTotal = await this.observations.countDocuments({ horizon });
      const missCount = await this.observations.countDocuments({ horizon, 'decision.verdict': 'MISS_ALERT' });
      missByHorizon.push({
        horizon,
        count: missCount,
        rate: horizonTotal > 0 ? (missCount / horizonTotal) * 100 : 0,
      });
    }
    
    // Top MISS reasons (from decision.reasons)
    const missRows = await this.observations.find({ 'decision.verdict': 'MISS_ALERT' }).toArray();
    const reasonCounts: Record<string, number> = {};
    missRows.forEach(row => {
      (row.decision?.reasons || []).forEach(reason => {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      });
    });
    const missReasonsTop = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      total,
      byDecision,
      byDecisionPercent,
      useByConfidence,
      missByHorizon,
      missReasonsTop,
    };
  }
  
  /**
   * S6.3 — Get USE observations
   */
  async getUsableObservations(limit: number = 50): Promise<ObservationRow[]> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    return this.observations
      .find({ 'decision.verdict': 'USE' })
      .sort({ 'sentiment.confidence': -1 })
      .limit(limit)
      .toArray();
  }
  
  /**
   * S6.3 — Get MISS_ALERT observations
   */
  async getMissAlertObservations(limit: number = 50): Promise<ObservationRow[]> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    return this.observations
      .find({ 'decision.verdict': 'MISS_ALERT' })
      .sort({ 'outcome.delta_pct': -1 })  // Biggest movers first
      .limit(limit)
      .toArray();
  }
  
  /**
   * Get observations with filters
   */
  async getObservations(params: {
    asset?: string;
    horizon?: string;
    usable_only?: boolean;
    missed_only?: boolean;
    decision?: string;
    limit?: number;
  }): Promise<ObservationRow[]> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const filter: any = {};
    if (params.asset) filter.asset = params.asset;
    if (params.horizon) filter.horizon = params.horizon;
    if (params.usable_only) filter['targets.usable_signal'] = true;
    if (params.missed_only) filter['targets.missed_opportunity'] = true;
    if (params.decision) filter['decision.verdict'] = params.decision;
    
    return this.observations
      .find(filter)
      .sort({ timestamp_t0: -1 })
      .limit(params.limit || 100)
      .toArray();
  }
  
  /**
   * Get missed opportunities for analysis
   */
  async getMissedOpportunities(limit: number = 50): Promise<ObservationRow[]> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    return this.observations
      .find({ 'targets.missed_opportunity': true })
      .sort({ 'outcome.delta_pct': -1 })  // Biggest movers first
      .limit(limit)
      .toArray();
  }

  /**
   * Backfill: Create ObservationRows from existing SignalEvents
   * 
   * This processes all SignalEvents that have outcomes but no observation rows.
   * Used to populate the observation_rows collection from historical data.
   */
  async backfillFromSignalEvents(options?: {
    limit?: number;
    asset?: string;
    dryRun?: boolean;
  }): Promise<{
    processed: number;
    created: number;
    skipped: number;
    errors: string[];
  }> {
    await this.connect();
    if (!this.observations || !this.db) throw new Error('Not connected');
    
    const signalEvents = this.db.collection('signal_events');
    const outcomes = this.db.collection('outcomes');
    const priceReactions = this.db.collection('price_reactions');
    const priceObservations = this.db.collection('price_observations');
    
    const result = {
      processed: 0,
      created: 0,
      skipped: 0,
      errors: [] as string[],
    };
    
    // Get SignalEvents
    const filter: any = {};
    if (options?.asset) filter.asset = options.asset;
    
    const signals = await signalEvents
      .find(filter)
      .sort({ created_at: -1 })
      .limit(options?.limit || 1000)
      .toArray();
    
    console.log(`[Observation Backfill] Processing ${signals.length} signals...`);
    
    const HORIZONS = ['5m', '15m', '1h', '4h', '24h'] as const;
    
    for (const signal of signals) {
      result.processed++;
      
      for (const horizon of HORIZONS) {
        const observation_id = `obs_${signal.signal_id}_${horizon}`;
        
        // Check if already exists
        const existing = await this.observations.findOne({ observation_id });
        if (existing) {
          result.skipped++;
          continue;
        }
        
        // Get outcome for this signal + horizon
        const outcome = await outcomes.findOne({ 
          signal_id: signal.signal_id, 
          horizon 
        });
        
        if (!outcome) {
          // No outcome yet, skip
          result.skipped++;
          continue;
        }
        
        // Get t0 price
        const t0Obs = await priceObservations.findOne({ 
          signal_id: signal.signal_id, 
          horizon: 't0' 
        });
        
        if (!t0Obs) {
          result.skipped++;
          continue;
        }
        
        // Get reaction
        const reaction = await priceReactions.findOne({ 
          signal_id: signal.signal_id, 
          horizon 
        });
        
        if (!reaction) {
          result.skipped++;
          continue;
        }
        
        if (options?.dryRun) {
          result.created++;
          continue;
        }
        
        try {
          // Prepare sentiment data
          const sentimentData = {
            label: signal.sentiment.label as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE',
            score: signal.sentiment.score || 0.5,
            confidence: signal.sentiment.confidence || 0.5,
            booster_applied: (signal.sentiment.cnn_flags || []).includes('cnn_positive_boost'),
            cnn_label: signal.sentiment.cnn_label || null,
            cnn_confidence: signal.sentiment.cnn_confidence || null,
            bullish_analysis: signal.sentiment.bullish_analysis as any || null,
          };
          
          // Create observation
          await this.createObservation({
            signal_id: signal.signal_id,
            tweet_id: signal.meta?.tweet_id,
            asset: signal.asset as 'BTC' | 'ETH' | 'SOL',
            timestamp_t0: new Date(signal.timestamp),
            horizon: horizon,
            sentiment: sentimentData,
            price_t0: t0Obs.price,
            reaction: {
              direction: reaction.direction,
              magnitude: reaction.magnitude,
              delta_pct: reaction.delta_pct,
            },
            outcome_label: outcome.outcome,
            social: {
              likes: signal.meta?.engagement?.likes || 0,
              reposts: signal.meta?.engagement?.reposts || 0,
              replies: signal.meta?.engagement?.replies || 0,
              influence_score: null,
              signal_strength: 'NORMAL',
            },
            text: signal.meta?.text,
          });
          
          result.created++;
        } catch (error: any) {
          result.errors.push(`${signal.signal_id}/${horizon}: ${error.message}`);
        }
      }
    }
    
    console.log(`[Observation Backfill] Complete: processed=${result.processed}, created=${result.created}, skipped=${result.skipped}, errors=${result.errors.length}`);
    
    return result;
  }
  
  /**
   * Get observation by ID
   */
  async getObservation(observation_id: string): Promise<ObservationRow | null> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    return this.observations.findOne({ observation_id });
  }
  
  /**
   * Get observations for a signal
   */
  async getObservationsForSignal(signal_id: string): Promise<ObservationRow[]> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    return this.observations.find({ signal_id }).toArray();
  }
  
  /**
   * Get usability rate by confidence bucket
   */
  async getUsabilityByConfidence(): Promise<Array<{
    bucket: string;
    total: number;
    usable: number;
    usableRate: number;
  }>> {
    await this.connect();
    if (!this.observations) throw new Error('Not connected');
    
    const buckets = [
      { name: '0.9-1.0', min: 0.9, max: 1.0 },
      { name: '0.7-0.9', min: 0.7, max: 0.9 },
      { name: '0.5-0.7', min: 0.5, max: 0.7 },
      { name: '<0.5', min: 0, max: 0.5 },
    ];
    
    const results = [];
    
    for (const bucket of buckets) {
      const total = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
      });
      
      const usable = await this.observations.countDocuments({
        'sentiment.confidence': { $gte: bucket.min, $lt: bucket.max },
        'targets.usable_signal': true,
      });
      
      results.push({
        bucket: bucket.name,
        total,
        usable,
        usableRate: total > 0 ? (usable / total) * 100 : 0,
      });
    }
    
    return results;
  }
}

export const observationService = new ObservationService();
