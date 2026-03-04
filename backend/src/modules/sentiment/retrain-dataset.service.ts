/**
 * Retrain Dataset Service — ML1.R
 * ================================
 * 
 * Сбор и подготовка датасета для retrain CNN.
 * 
 * ПРАВИЛА:
 * - MOCK — источник истины для label
 * - CNN — помощник, учится приближаться к MOCK
 * - Цена — НЕ ИСПОЛЬЗУЕТСЯ на этом этапе
 * 
 * БАЛАНС ДАТАСЕТА:
 * - POSITIVE: 25-35%
 * - NEUTRAL: 35-45%  
 * - NEGATIVE: 25-35%
 * 
 * ЗАПРЕЩЕНО:
 * - Собирать > 10,000 примеров
 * - Брать sarcasm, questions, conflicts
 * - Менять label от MOCK
 */

import { MongoClient, Db, Collection } from 'mongodb';

// ============================================================
// Types
// ============================================================

export interface RetrainSample {
  _id?: string;
  text: string;
  mockLabel: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  mockConfidence: number;
  mockScore: number;
  cnnLabel: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  cnnConfidence: number;
  cnnScore: number;
  finalLabel: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  finalConfidence: number;
  flags: string[];
  meta: {
    length: number;
    isShort: boolean;
    containsPrice: boolean;
    containsNews: boolean;
    containsSlang: boolean;
    containsQuestion: boolean;
    containsSarcasm: boolean;
    containsConflict: boolean;
    wordCount: number;
  };
  mismatchType: 'MOCK_NEUTRAL_CNN_POSITIVE' | 'MOCK_POSITIVE_CNN_NEUTRAL' | 'MATCH' | 'OTHER';
  isValidForRetrain: boolean;
  excludeReason?: string;
  // CNN Bullish Analysis (NEW)
  bullishAnalysis?: {
    classification: BullishClassification;
    reason: string;
    canBoost: boolean;
    hasValidSignals: boolean;
    signals: string[];
    blockReasons: string[];
  };
  createdAt: Date;
  source: 'shadow_log' | 'manual' | 'import';
}

export interface DatasetStats {
  total: number;
  validForRetrain: number;
  byLabel: {
    POSITIVE: number;
    NEUTRAL: number;
    NEGATIVE: number;
  };
  byMismatchType: {
    MOCK_NEUTRAL_CNN_POSITIVE: number;
    MOCK_POSITIVE_CNN_NEUTRAL: number;
    MATCH: number;
    OTHER: number;
  };
  balance: {
    positiveRatio: number;
    neutralRatio: number;
    negativeRatio: number;
    isBalanced: boolean;
  };
  excluded: {
    sarcasm: number;
    questions: number;
    conflicts: number;
    tooShort: number;
    other: number;
  };
}

export interface DatasetValidation {
  isValid: boolean;
  totalSamples: number;
  validSamples: number;
  errors: string[];
  warnings: string[];
  balance: {
    positiveRatio: number;
    neutralRatio: number;
    negativeRatio: number;
    isAcceptable: boolean;
  };
}

// ============================================================
// Crypto/News Detection Patterns
// ============================================================

const CRYPTO_PATTERNS = {
  price: /\$?\d+k?|\bprice\b|\btarget\b|\bATH\b|\bpump\b|\bdump\b/i,
  news: /\bbreaking\b|\bJUST IN\b|\bflash\b|\breport\b|\bfiled\b|\bapproved\b|\bannounced\b/i,
  slang: /\bhodl\b|\bfomo\b|\bmooning\b|\brekt\b|\bwagmi\b|\bngmi\b|\bbullish\b|\bbearish\b|\bLFG\b/i,
  question: /\?$|\bwhat\b|\bwhy\b|\bhow\b|\bwhen\b|\bwhere\b|\bshould\b/i,
  sarcasm: /\byeah right\b|\bsure\b.*\.{3}|\blol\b|\blmao\b|\bsarcasm\b/i,
  conflict: /\bbut\b|\bhowever\b|\balthough\b|\bdespite\b|\byet\b/i,
};

// CNN Bullish Filtering Patterns (NEW)
const CNN_BULLISH_PATTERNS = {
  // Valid institutional/fundamental signals
  institutional: /\binstitutional\b|\bETF\b|\bapproval\b|\bfiling\b|\bregulation\b|\bSEC\b|\bBlackRock\b|\bFidelity\b/i,
  onchain: /\bon-chain\b|\bvolume\b|\binflow\b|\boutflow\b|\bhash rate\b|\bwhale\b|\baccumulation\b/i,
  development: /\bpartnership\b|\bintegration\b|\blaunch\b|\bupdate\b|\bupgrade\b|\bmainnet\b|\btestnet\b/i,
  
  // Invalid clickbait patterns
  clickbait: /you won't believe|this is huge|must see|urgent|breaking now|don't miss|game changer/i,
  
  // Hard block patterns (never boost)
  hardBlock: /\bscam\b|\bhack\b|\bexploit\b|\blawsuit\b|\bfraud\b|\brug\b|\bponzi\b/i,
  negation: /\bnot\b|\bfake\b|\brumor\b|\bscam\b|\bdenied\b|\bfalse\b/i,
};

// CNN Bullish Classification Result
type BullishClassification = 'VALID' | 'BLOCKED' | 'HARD_BLOCK' | 'IGNORE';

interface BullishAnalysis {
  classification: BullishClassification;
  reason: string;
  canBoost: boolean;
  hasValidSignals: boolean;
  signals: string[];
  blockReasons: string[];
}

// ============================================================
// CNN Bullish Filtering Functions
// ============================================================

/**
 * Analyze text for CNN Bullish signal validity
 * This is the core filtering function for "CNN saw POSITIVE when MOCK saw NEUTRAL"
 * 
 * VALID: Text has institutional/onchain/development signals, no hard blocks
 * BLOCKED: Text is clickbait, too short, has negation, or low quality
 * HARD_BLOCK: Text contains scam/hack/exploit terms
 * IGNORE: Not a CNN Bullish case (MOCK != NEUTRAL or CNN != POSITIVE)
 */
function analyzeCnnBullish(
  text: string,
  mockLabel: string,
  cnnLabel: string,
  cnnConfidence: number,
  meta: RetrainSample['meta']
): BullishAnalysis {
  // IGNORE: Not a CNN Bullish case
  if (mockLabel !== 'NEUTRAL' || cnnLabel !== 'POSITIVE') {
    return {
      classification: 'IGNORE',
      reason: 'Not a MOCK_NEUTRAL + CNN_POSITIVE case',
      canBoost: false,
      hasValidSignals: false,
      signals: [],
      blockReasons: [],
    };
  }

  const signals: string[] = [];
  const blockReasons: string[] = [];

  // Check for HARD BLOCK patterns (scam, hack, etc)
  if (CNN_BULLISH_PATTERNS.hardBlock.test(text)) {
    return {
      classification: 'HARD_BLOCK',
      reason: 'Contains scam/hack/exploit terms — NEVER boost',
      canBoost: false,
      hasValidSignals: false,
      signals: [],
      blockReasons: ['hard_block_terms'],
    };
  }

  // Check for negation patterns
  if (CNN_BULLISH_PATTERNS.negation.test(text)) {
    blockReasons.push('negation_detected');
  }

  // Check for clickbait patterns
  if (CNN_BULLISH_PATTERNS.clickbait.test(text)) {
    blockReasons.push('clickbait_detected');
  }

  // TEXT QUALITY CHECKS
  // Rule: Too short (<10 words) — unreliable signal
  if (meta.wordCount < 10) {
    blockReasons.push('too_short_for_bullish');
  }

  // Rule: Questions are unreliable for bullish signals
  if (meta.containsQuestion) {
    blockReasons.push('question_unreliable');
  }

  // Rule: Conflicting signals (but, however) reduce reliability
  if (meta.containsConflict) {
    blockReasons.push('conflicting_signals');
  }

  // Rule: Low CNN confidence (<65%) — weak signal
  if (cnnConfidence < 0.65) {
    blockReasons.push('low_cnn_confidence');
  }

  // CHECK FOR VALID SIGNALS
  // Institutional signals (ETF, BlackRock, SEC approval)
  if (CNN_BULLISH_PATTERNS.institutional.test(text)) {
    signals.push('institutional');
  }

  // On-chain signals (whale, accumulation, volume)
  if (CNN_BULLISH_PATTERNS.onchain.test(text)) {
    signals.push('onchain');
  }

  // Development signals (partnership, launch, upgrade)
  if (CNN_BULLISH_PATTERNS.development.test(text)) {
    signals.push('development');
  }

  // Crypto slang (bullish, mooning) — weak but valid
  if (meta.containsSlang) {
    signals.push('crypto_slang');
  }

  // News context — adds credibility
  if (meta.containsNews) {
    signals.push('news_context');
  }

  // DECISION LOGIC
  const hasValidSignals = signals.length > 0;
  const hasBlockReasons = blockReasons.length > 0;

  // BLOCKED: Has block reasons, even with valid signals
  if (hasBlockReasons) {
    return {
      classification: 'BLOCKED',
      reason: `Blocked: ${blockReasons.join(', ')}`,
      canBoost: false,
      hasValidSignals,
      signals,
      blockReasons,
    };
  }

  // VALID: No blocks + has valid signals
  if (hasValidSignals) {
    return {
      classification: 'VALID',
      reason: `Valid bullish signals: ${signals.join(', ')}`,
      canBoost: true,
      hasValidSignals: true,
      signals,
      blockReasons: [],
    };
  }

  // BLOCKED: No signals detected — CNN might be hallucinating
  return {
    classification: 'BLOCKED',
    reason: 'No valid bullish signals detected — CNN may be overconfident',
    canBoost: false,
    hasValidSignals: false,
    signals: [],
    blockReasons: ['no_valid_signals'],
  };
}

// ============================================================
// Dataset Service
// ============================================================

class RetrainDatasetService {
  private db: Db | null = null;
  private collection: Collection<RetrainSample> | null = null;
  private mongoClient: MongoClient | null = null;

  constructor() {}

  async connect(): Promise<void> {
    if (this.db) return;

    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'crypto_platform';

    try {
      this.mongoClient = new MongoClient(mongoUrl);
      await this.mongoClient.connect();
      this.db = this.mongoClient.db(dbName);
      this.collection = this.db.collection<RetrainSample>('retrain_dataset');
      
      // Create indexes
      await this.collection.createIndex({ mockLabel: 1 });
      await this.collection.createIndex({ mismatchType: 1 });
      await this.collection.createIndex({ isValidForRetrain: 1 });
      await this.collection.createIndex({ createdAt: -1 });
      
      console.log('[RetrainDataset] Connected to MongoDB');
    } catch (error) {
      console.error('[RetrainDataset] MongoDB connection error:', error);
      throw error;
    }
  }

  /**
   * Analyze text for meta information
   */
  private analyzeText(text: string): RetrainSample['meta'] {
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    
    return {
      length: text.length,
      isShort: wordCount < 15,
      containsPrice: CRYPTO_PATTERNS.price.test(text),
      containsNews: CRYPTO_PATTERNS.news.test(text),
      containsSlang: CRYPTO_PATTERNS.slang.test(text),
      containsQuestion: CRYPTO_PATTERNS.question.test(text),
      containsSarcasm: CRYPTO_PATTERNS.sarcasm.test(text),
      containsConflict: CRYPTO_PATTERNS.conflict.test(text),
      wordCount,
    };
  }

  /**
   * Determine mismatch type
   */
  private getMismatchType(
    mockLabel: string,
    cnnLabel: string
  ): RetrainSample['mismatchType'] {
    if (mockLabel === cnnLabel) return 'MATCH';
    if (mockLabel === 'NEUTRAL' && cnnLabel === 'POSITIVE') return 'MOCK_NEUTRAL_CNN_POSITIVE';
    if (mockLabel === 'POSITIVE' && cnnLabel === 'NEUTRAL') return 'MOCK_POSITIVE_CNN_NEUTRAL';
    return 'OTHER';
  }

  /**
   * Determine if sample is valid for retrain
   * Based on strict criteria from checklist
   */
  private validateForRetrain(
    sample: Partial<RetrainSample>,
    meta: RetrainSample['meta']
  ): { isValid: boolean; excludeReason?: string } {
    // ЗАПРЕЩЕНО: sarcasm
    if (meta.containsSarcasm) {
      return { isValid: false, excludeReason: 'sarcasm_detected' };
    }

    // ЗАПРЕЩЕНО: questions
    if (meta.containsQuestion) {
      return { isValid: false, excludeReason: 'question_detected' };
    }

    // ЗАПРЕЩЕНО: conflicts (but, however, although)
    if (meta.containsConflict) {
      return { isValid: false, excludeReason: 'conflict_words_detected' };
    }

    // ЗАПРЕЩЕНО: too short (<5 words)
    if (meta.wordCount < 5) {
      return { isValid: false, excludeReason: 'too_short' };
    }

    // ЗАПРЕЩЕНО: MOCK = NEGATIVE & CNN = POSITIVE (dangerous case)
    if (sample.mockLabel === 'NEGATIVE' && sample.cnnLabel === 'POSITIVE') {
      return { isValid: false, excludeReason: 'dangerous_mismatch_neg_pos' };
    }

    // CNN Bullish Case: MOCK = NEUTRAL, CNN = POSITIVE
    // This is the most valuable case for analysis
    if (sample.mismatchType === 'MOCK_NEUTRAL_CNN_POSITIVE') {
      // CNN confidence >= 65% is sufficient for analysis
      // No strict MOCK confidence limit - we want to collect these cases
      if ((sample.cnnConfidence || 0) >= 0.65) {
        return { isValid: true };
      }
      // Low CNN confidence - still collect but mark for review
      return { isValid: true }; // Collect all CNN bullish cases for analysis
    }

    // Limited (≤15%): MOCK = POSITIVE, CNN = NEUTRAL
    if (sample.mismatchType === 'MOCK_POSITIVE_CNN_NEUTRAL') {
      // Only if has crypto terms and no sarcasm/negation
      if (meta.containsSlang || meta.containsNews || meta.containsPrice) {
        return { isValid: true };
      }
      return { isValid: false, excludeReason: 'no_crypto_context' };
    }

    // Match cases - valid but lower priority
    if (sample.mismatchType === 'MATCH') {
      return { isValid: true };
    }

    return { isValid: false, excludeReason: 'other_mismatch_type' };
  }

  /**
   * Add sample from shadow comparison
   */
  async addFromShadow(
    text: string,
    mock: { label: string; score: number; confidence: number },
    cnn: { label: string; score: number; confidence: number },
    finalLabel: string,
    finalConfidence: number,
    flags: string[]
  ): Promise<{ added: boolean; reason?: string; bullishAnalysis?: BullishAnalysis }> {
    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    // Check dataset size limit (MAX 10,000)
    const currentCount = await this.collection.countDocuments();
    if (currentCount >= 10000) {
      return { added: false, reason: 'dataset_full' };
    }

    // Analyze text
    const meta = this.analyzeText(text);
    const mismatchType = this.getMismatchType(mock.label, cnn.label);

    // Validate for retrain
    const partialSample = {
      mockLabel: mock.label as RetrainSample['mockLabel'],
      cnnLabel: cnn.label as RetrainSample['cnnLabel'],
      mockConfidence: mock.confidence,
      cnnConfidence: cnn.confidence,
      mismatchType,
    };
    
    const validation = this.validateForRetrain(partialSample, meta);

    // CNN Bullish Analysis (NEW - ML1.R filtering)
    const bullishAnalysis = analyzeCnnBullish(
      text,
      mock.label,
      cnn.label,
      cnn.confidence,
      meta
    );

    const sample: RetrainSample = {
      text,
      mockLabel: mock.label as RetrainSample['mockLabel'],
      mockConfidence: mock.confidence,
      mockScore: mock.score,
      cnnLabel: cnn.label as RetrainSample['cnnLabel'],
      cnnConfidence: cnn.confidence,
      cnnScore: cnn.score,
      finalLabel: finalLabel as RetrainSample['finalLabel'],
      finalConfidence,
      flags,
      meta,
      mismatchType,
      isValidForRetrain: validation.isValid,
      excludeReason: validation.excludeReason,
      bullishAnalysis,
      createdAt: new Date(),
      source: 'shadow_log',
    };

    // Check for duplicates (by text hash)
    const textHash = this.hashText(text);
    const existing = await this.collection.findOne({ 
      text: { $regex: `^${text.substring(0, 50)}` } 
    });
    
    if (existing) {
      return { added: false, reason: 'duplicate' };
    }

    await this.collection.insertOne(sample);
    return { added: true, bullishAnalysis };
  }

  /**
   * Get dataset statistics
   */
  async getStats(): Promise<DatasetStats> {
    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    const total = await this.collection.countDocuments();
    const validForRetrain = await this.collection.countDocuments({ isValidForRetrain: true });

    const byLabel = {
      POSITIVE: await this.collection.countDocuments({ mockLabel: 'POSITIVE', isValidForRetrain: true }),
      NEUTRAL: await this.collection.countDocuments({ mockLabel: 'NEUTRAL', isValidForRetrain: true }),
      NEGATIVE: await this.collection.countDocuments({ mockLabel: 'NEGATIVE', isValidForRetrain: true }),
    };

    const byMismatchType = {
      MOCK_NEUTRAL_CNN_POSITIVE: await this.collection.countDocuments({ 
        mismatchType: 'MOCK_NEUTRAL_CNN_POSITIVE', isValidForRetrain: true 
      }),
      MOCK_POSITIVE_CNN_NEUTRAL: await this.collection.countDocuments({ 
        mismatchType: 'MOCK_POSITIVE_CNN_NEUTRAL', isValidForRetrain: true 
      }),
      MATCH: await this.collection.countDocuments({ 
        mismatchType: 'MATCH', isValidForRetrain: true 
      }),
      OTHER: await this.collection.countDocuments({ 
        mismatchType: 'OTHER', isValidForRetrain: true 
      }),
    };

    const excluded = {
      sarcasm: await this.collection.countDocuments({ excludeReason: 'sarcasm_detected' }),
      questions: await this.collection.countDocuments({ excludeReason: 'question_detected' }),
      conflicts: await this.collection.countDocuments({ excludeReason: 'conflict_words_detected' }),
      tooShort: await this.collection.countDocuments({ excludeReason: 'too_short' }),
      other: await this.collection.countDocuments({ 
        isValidForRetrain: false, 
        excludeReason: { $nin: ['sarcasm_detected', 'question_detected', 'conflict_words_detected', 'too_short'] }
      }),
    };

    const positiveRatio = validForRetrain > 0 ? byLabel.POSITIVE / validForRetrain : 0;
    const neutralRatio = validForRetrain > 0 ? byLabel.NEUTRAL / validForRetrain : 0;
    const negativeRatio = validForRetrain > 0 ? byLabel.NEGATIVE / validForRetrain : 0;

    // Balance check: POSITIVE 25-35%, NEUTRAL 35-45%, NEGATIVE 25-35%
    const isBalanced = 
      positiveRatio >= 0.25 && positiveRatio <= 0.35 &&
      neutralRatio >= 0.35 && neutralRatio <= 0.45 &&
      negativeRatio >= 0.25 && negativeRatio <= 0.35;

    return {
      total,
      validForRetrain,
      byLabel,
      byMismatchType,
      balance: {
        positiveRatio,
        neutralRatio,
        negativeRatio,
        isBalanced,
      },
      excluded,
    };
  }

  /**
   * Validate dataset before retrain
   */
  async validateDataset(): Promise<DatasetValidation> {
    const stats = await this.getStats();
    const errors: string[] = [];
    const warnings: string[] = [];

    // MIN 1000 samples
    if (stats.validForRetrain < 1000) {
      errors.push(`Insufficient samples: ${stats.validForRetrain} < 1000 minimum`);
    }

    // MAX 10000 samples
    if (stats.validForRetrain > 10000) {
      errors.push(`Too many samples: ${stats.validForRetrain} > 10000 maximum`);
    }

    // NEUTRAL must be >= 30%
    if (stats.balance.neutralRatio < 0.30) {
      errors.push(`NEUTRAL ratio too low: ${(stats.balance.neutralRatio * 100).toFixed(1)}% < 30%`);
    }

    // Balance warnings
    if (stats.balance.positiveRatio < 0.25) {
      warnings.push(`POSITIVE ratio low: ${(stats.balance.positiveRatio * 100).toFixed(1)}%`);
    }
    if (stats.balance.positiveRatio > 0.35) {
      warnings.push(`POSITIVE ratio high: ${(stats.balance.positiveRatio * 100).toFixed(1)}%`);
    }
    if (stats.balance.negativeRatio < 0.25) {
      warnings.push(`NEGATIVE ratio low: ${(stats.balance.negativeRatio * 100).toFixed(1)}%`);
    }
    if (stats.balance.negativeRatio > 0.35) {
      warnings.push(`NEGATIVE ratio high: ${(stats.balance.negativeRatio * 100).toFixed(1)}%`);
    }

    return {
      isValid: errors.length === 0,
      totalSamples: stats.total,
      validSamples: stats.validForRetrain,
      errors,
      warnings,
      balance: {
        positiveRatio: stats.balance.positiveRatio,
        neutralRatio: stats.balance.neutralRatio,
        negativeRatio: stats.balance.negativeRatio,
        isAcceptable: stats.balance.neutralRatio >= 0.30,
      },
    };
  }

  /**
   * Export dataset for retrain (JSON format)
   */
  async exportForRetrain(): Promise<{
    samples: Array<{
      text: string;
      label: string;
      confidence_target: number;
      type: string;
    }>;
    meta: {
      exportedAt: string;
      totalSamples: number;
      balance: DatasetStats['balance'];
    };
  }> {
    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    const samples = await this.collection
      .find({ isValidForRetrain: true })
      .toArray();

    const stats = await this.getStats();

    return {
      samples: samples.map(s => ({
        text: s.text,
        label: s.mockLabel, // MOCK is source of truth
        confidence_target: s.mockConfidence,
        type: this.getSampleType(s.meta),
      })),
      meta: {
        exportedAt: new Date().toISOString(),
        totalSamples: samples.length,
        balance: stats.balance,
      },
    };
  }

  /**
   * Get sample type for retrain categorization
   */
  private getSampleType(meta: RetrainSample['meta']): string {
    if (meta.containsNews) return 'news';
    if (meta.containsSlang) return 'slang';
    if (meta.isShort) return 'short';
    if (meta.containsPrice) return 'price';
    return 'factual';
  }

  /**
   * Clear dataset (dangerous - requires confirmation)
   */
  async clearDataset(confirm: boolean = false): Promise<{ cleared: boolean; count: number }> {
    if (!confirm) {
      return { cleared: false, count: 0 };
    }

    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    const count = await this.collection.countDocuments();
    await this.collection.deleteMany({});
    
    console.log(`[RetrainDataset] Cleared ${count} samples`);
    return { cleared: true, count };
  }

  /**
   * Get recent samples for review
   */
  async getRecentSamples(limit: number = 20): Promise<RetrainSample[]> {
    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    const samples = await this.collection
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Remove MongoDB _id from response
    return samples.map(s => {
      const { _id, ...rest } = s;
      return rest as RetrainSample;
    });
  }

  /**
   * Analyze text for collection WITHOUT saving
   * Used for testing filter logic
   */
  analyzeForCollection(
    text: string,
    mock: { label: string; score: number; confidence: number },
    cnn: { label: string; score: number; confidence: number }
  ): {
    mismatchType: RetrainSample['mismatchType'];
    isValidForRetrain: boolean;
    excludeReason?: string;
    bullishAnalysis: BullishAnalysis;
    meta: RetrainSample['meta'];
  } {
    const meta = this.analyzeText(text);
    const mismatchType = this.getMismatchType(mock.label, cnn.label);

    const partialSample = {
      mockLabel: mock.label as RetrainSample['mockLabel'],
      cnnLabel: cnn.label as RetrainSample['cnnLabel'],
      mockConfidence: mock.confidence,
      cnnConfidence: cnn.confidence,
      mismatchType,
    };
    
    const validation = this.validateForRetrain(partialSample, meta);
    const bullishAnalysis = analyzeCnnBullish(text, mock.label, cnn.label, cnn.confidence, meta);

    return {
      mismatchType,
      isValidForRetrain: validation.isValid,
      excludeReason: validation.excludeReason,
      bullishAnalysis,
      meta,
    };
  }

  /**
   * Recalculate bullishAnalysis for all existing samples
   * Used for T2 Mismatch Analysis
   */
  async recalculateBullishAnalysis(): Promise<{
    total: number;
    updated: number;
    byClassification: Record<string, number>;
  }> {
    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    const samples = await this.collection.find({}).toArray();
    let updated = 0;
    const byClassification: Record<string, number> = {
      VALID: 0,
      BLOCKED: 0,
      HARD_BLOCK: 0,
      IGNORE: 0,
    };

    for (const sample of samples) {
      // Recalculate meta if missing
      const meta = sample.meta || this.analyzeText(sample.text);
      
      // Recalculate bullishAnalysis
      const bullishAnalysis = analyzeCnnBullish(
        sample.text,
        sample.mockLabel,
        sample.cnnLabel,
        sample.cnnConfidence,
        meta
      );

      // Update in database
      await this.collection.updateOne(
        { _id: sample._id },
        { 
          $set: { 
            bullishAnalysis,
            meta 
          } 
        }
      );

      updated++;
      byClassification[bullishAnalysis.classification]++;
    }

    return {
      total: samples.length,
      updated,
      byClassification,
    };
  }

  /**
   * Get T2 Mismatch Analysis report
   * Comprehensive analysis for decision making
   */
  async getT2Analysis(): Promise<{
    summary: {
      totalSamples: number;
      cnnBullishTotal: number;
      cnnBullishRate: number;
    };
    classification: {
      VALID: { count: number; percentage: number; samples: any[] };
      BLOCKED: { count: number; percentage: number; reasons: Record<string, number>; samples: any[] };
      HARD_BLOCK: { count: number; percentage: number; samples: any[] };
      IGNORE: { count: number; percentage: number };
    };
    validSignals: Record<string, number>;
    blockReasons: Record<string, number>;
    decision: {
      recommendation: 'FREEZE_V16' | 'RULE_TUNING' | 'TARGETED_RETRAIN';
      confidence: number;
      reasons: string[];
    };
  }> {
    await this.connect();
    if (!this.collection) throw new Error('Not connected');

    // Get all CNN Bullish samples
    const cnnBullishSamples = await this.collection.find({
      mismatchType: 'MOCK_NEUTRAL_CNN_POSITIVE'
    }).toArray();

    const totalSamples = await this.collection.countDocuments();
    const cnnBullishTotal = cnnBullishSamples.length;

    // Classify samples
    const validSamples: any[] = [];
    const blockedSamples: any[] = [];
    const hardBlockSamples: any[] = [];
    let ignoreCount = 0;

    const validSignals: Record<string, number> = {};
    const blockReasons: Record<string, number> = {};

    for (const sample of cnnBullishSamples) {
      const ba = sample.bullishAnalysis;
      if (!ba) continue;

      switch (ba.classification) {
        case 'VALID':
          validSamples.push({
            text: sample.text.substring(0, 100),
            signals: ba.signals,
            cnnConfidence: sample.cnnConfidence,
          });
          for (const sig of ba.signals || []) {
            validSignals[sig] = (validSignals[sig] || 0) + 1;
          }
          break;
        case 'BLOCKED':
          blockedSamples.push({
            text: sample.text.substring(0, 100),
            reasons: ba.blockReasons,
            cnnConfidence: sample.cnnConfidence,
          });
          for (const reason of ba.blockReasons || []) {
            blockReasons[reason] = (blockReasons[reason] || 0) + 1;
          }
          break;
        case 'HARD_BLOCK':
          hardBlockSamples.push({
            text: sample.text.substring(0, 100),
            reason: ba.reason,
          });
          break;
        case 'IGNORE':
          ignoreCount++;
          break;
      }
    }

    // Calculate decision
    const validRate = validSamples.length / cnnBullishTotal;
    const blockedRate = blockedSamples.length / cnnBullishTotal;
    const hardBlockRate = hardBlockSamples.length / cnnBullishTotal;

    let recommendation: 'FREEZE_V16' | 'RULE_TUNING' | 'TARGETED_RETRAIN';
    let confidence: number;
    const reasons: string[] = [];

    if (hardBlockRate > 0.1) {
      recommendation = 'TARGETED_RETRAIN';
      confidence = 0.8;
      reasons.push(`High HARD_BLOCK rate: ${(hardBlockRate * 100).toFixed(1)}% > 10%`);
      reasons.push('CNN is bullish on dangerous content');
    } else if (validRate >= 0.6 || (validRate + blockedRate * 0.5) >= 0.6) {
      recommendation = 'FREEZE_V16';
      confidence = Math.min(0.95, validRate + 0.1);
      reasons.push(`VALID rate: ${(validRate * 100).toFixed(1)}%`);
      reasons.push(`HARD_BLOCK rate: ${(hardBlockRate * 100).toFixed(1)}% (acceptable)`);
      reasons.push('CNN bullish signals are mostly legitimate');
      reasons.push('Hybrid Booster architecture is sufficient');
    } else if (blockedRate > 0.3) {
      recommendation = 'RULE_TUNING';
      confidence = 0.7;
      reasons.push(`High BLOCKED rate: ${(blockedRate * 100).toFixed(1)}%`);
      reasons.push('Many signals blocked by strict rules');
      reasons.push('Consider relaxing short text or question rules');
    } else {
      recommendation = 'FREEZE_V16';
      confidence = 0.6;
      reasons.push('No strong signal for changes');
      reasons.push('Default to conservative approach');
    }

    return {
      summary: {
        totalSamples,
        cnnBullishTotal,
        cnnBullishRate: cnnBullishTotal / totalSamples,
      },
      classification: {
        VALID: {
          count: validSamples.length,
          percentage: validRate * 100,
          samples: validSamples.slice(0, 10),
        },
        BLOCKED: {
          count: blockedSamples.length,
          percentage: blockedRate * 100,
          reasons: blockReasons,
          samples: blockedSamples.slice(0, 10),
        },
        HARD_BLOCK: {
          count: hardBlockSamples.length,
          percentage: hardBlockRate * 100,
          samples: hardBlockSamples,
        },
        IGNORE: {
          count: ignoreCount,
          percentage: (ignoreCount / cnnBullishTotal) * 100,
        },
      },
      validSignals,
      blockReasons,
      decision: {
        recommendation,
        confidence,
        reasons,
      },
    };
  }

  /**
   * Simple text hash for deduplication
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

// Singleton export
export const retrainDatasetService = new RetrainDatasetService();
