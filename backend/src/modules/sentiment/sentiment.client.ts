/**
 * Sentiment Runtime Client (v1.6.0 - FROZEN)
 * ==========================================
 * Thin proxy to FastAPI sentiment service with mock fallback
 * 
 * v1.6.0 = MOCK v1.5 + ML1.4 Hybrid Confidence Booster
 * 
 * FROZEN as of Phase ML1.4 (Dec 2025)
 * 
 * v1.5 Formula: finalScore = cnnScore * 0.60 + lexScore * 0.25 + rulesBias * 0.15
 * v1.6 Addition: CNN Confidence Booster (when MOCK=NEUTRAL, CNN=POSITIVE, CNN.conf >= 0.7)
 */

import axios, { AxiosInstance } from 'axios';

const SENTIMENT_URL = process.env.SENTIMENT_URL || 'http://127.0.0.1:8015';
const SENTIMENT_TIMEOUT = parseInt(process.env.SENTIMENT_TIMEOUT_MS || '8000');
const MOCK_MODE = process.env.SENTIMENT_MOCK_MODE === 'true';

// ============================================================
// v1.5.0 FROZEN Configuration (A3)
// DO NOT MODIFY - changes require v1.6.0
// ============================================================

const ENGINE_VERSION = '1.6.0';
const RULESET_VERSION = 'ML1.4-hybrid';
const FROZEN = true;

// ============================================================
// ML1.4 Hybrid Confidence Booster Configuration
// ============================================================

const ML14_CONFIG = {
  enabled: true, // Runtime flag, can be toggled via admin
  cnnConfidenceThreshold: 0.70, // CNN must be >= 70% confident
  maxBoost: 0.15, // Maximum confidence boost
  boostMultiplier: 0.2, // confidence += cnn.confidence * this
  confidenceCap: 0.85, // Never exceed this confidence
};

// Runtime state for ML1.4 booster (can be toggled via admin API)
let ml14BoosterEnabled = ML14_CONFIG.enabled;

const V15_CONFIG = {
  weights: { cnn: 0.60, lexicon: 0.25, rules: 0.15 },
  thresholds: { positive: 0.55, negative: 0.40 },
  confidence: { modelWeight: 0.40, agreementWeight: 0.35, signalStrengthWeight: 0.25 },
  penalties: { 
    singleWordFactor: 0.4,
    shortTextChars: 20, 
    shortTextFactor: 0.7, 
    conflictingSignalsFactor: 0.6, 
    questionToneFactor: 0.8 
  },
};

// ============================================================
// Lexicon (FROZEN v1.5.0)
// ============================================================

const LEXICON = {
  positive: [
    // Core bullish terms
    'bullish', 'moon', 'pump', 'ath', 'breakout', 'surge', 'rally', 'soar',
    'accumulation', 'hodl', 'diamond hands', 'buy the dip', 'undervalued',
    'bullrun', 'parabolic', 'explosive', 'massive', 'huge',
    'buy', 'long', 'accumulate', 'load', 'stack',
    'optimistic', 'confident', 'strong', 'healthy',
    'growing', 'recovery', 'support', 'breakthrough', 'milestone',
    // A1 Calibration additions
    'etf', 'approval', 'approved', 'institutional', 'adoption', 'accelerating',
    'breaking', 'new highs', 'all-time high', 'all time high', 'highs',
    'tvl growth', 'ecosystem', 'exploding', 'divergence', 'confirmed',
    'blackrock', 'grayscale', 'fidelity', 'whale', 'whales loading',
    'resistance', 'beginning', 'gift', 'leg up', 'charge',
  ],
  negative: [
    // Core bearish terms
    'bearish', 'dump', 'crash', 'plunge', 'tank', 'collapse',
    'capitulation', 'panic', 'fear', 'fud', 'scam', 'rug', 'ponzi',
    'overvalued', 'bubble', 'correction', 'selloff',
    'sell', 'short', 'exit', 'liquidate',
    'worried', 'concerned', 'risky', 'dangerous', 'warning',
    'decline', 'drop', 'fall', 'loss',
    // A1 Calibration additions
    'hack', 'hacked', 'exploit', 'vulnerability', 'crackdown',
    'regulatory', 'sec', 'lawsuit', 'fraud', 'manipulation',
    'dead cat', 'trap', 'fake pump', 'rekt', 'pain ahead',
  ],
  neutral: [
    // Core neutral terms
    'stable', 'unchanged', 'sideways', 'consolidating', 'flat',
    'steady', 'holding', 'range', 'balanced', 'moderate',
    'low volume', 'low activity', 'quiet', 'calm', 'prices unchanged',
    // A1 Calibration additions
    'remains', 'processed', 'normal', 'normal levels', 'within range',
    'awaits', 'waiting', 'fees', 'gas fees', 'transactions',
    'lists', 'listed', 'launched', 'new trading pair',
    'ratio', 'volume', 'trading volume',
  ],
  mixed: ['but', 'however', 'although', 'despite', 'yet', 'though'],
  question: ['?', 'should i', 'is it', 'what if', 'anyone think', 'thoughts on'],
};

// ============================================================
// v1.5 Analysis Functions
// ============================================================

function calculateLexiconScore(text: string): {
  scoreNorm: number;
  positiveWords: string[];
  negativeWords: string[];
  neutralWords: string[];
  mixedSignals: boolean;
  questionTone: boolean;
} {
  const textLower = text.toLowerCase();
  const words = textLower.split(/\s+/);
  const totalWords = Math.max(words.length, 1);
  
  const positiveWords = LEXICON.positive.filter(w => textLower.includes(w));
  const negativeWords = LEXICON.negative.filter(w => textLower.includes(w));
  const neutralWords = LEXICON.neutral.filter(w => textLower.includes(w));
  const mixedIndicators = LEXICON.mixed.filter(w => textLower.includes(w));
  const questionIndicators = LEXICON.question.filter(w => textLower.includes(w));
  
  // If neutral words detected and no strong signals, bias towards neutral (0.5)
  let rawScore: number;
  if (neutralWords.length > 0 && positiveWords.length === 0 && negativeWords.length === 0) {
    rawScore = 0; // Pure neutral → scoreNorm = 0.5
  } else {
    rawScore = (positiveWords.length - negativeWords.length) / totalWords;
  }
  
  const scoreNorm = Math.max(0, Math.min(1, (rawScore + 1) / 2));
  
  return {
    scoreNorm,
    positiveWords,
    negativeWords,
    neutralWords,
    mixedSignals: mixedIndicators.length > 0 || (positiveWords.length > 0 && negativeWords.length > 0),
    questionTone: questionIndicators.length > 0,
  };
}

function calculateRulesBias(
  positiveWords: string[],
  negativeWords: string[],
  mixedSignals: boolean,
  questionTone: boolean,
  shortText: boolean
): { bias: number; rulesApplied: string[]; reasons: string[] } {
  let bias = 0;
  const rulesApplied: string[] = [];
  const reasons: string[] = [];
  
  if (positiveWords.length >= 2) {
    bias += 0.08;
    rulesApplied.push('BULLISH_BOOST');
    reasons.push(`Strong bullish signals: ${positiveWords.slice(0, 3).join(', ')}`);
  } else if (positiveWords.length === 1) {
    bias += 0.04;
    rulesApplied.push('BULLISH_KEYWORDS');
    reasons.push(`Bullish keyword: ${positiveWords[0]}`);
  }
  
  if (negativeWords.length >= 2) {
    bias -= 0.08;
    rulesApplied.push('BEARISH_BOOST');
    reasons.push(`Strong bearish signals: ${negativeWords.slice(0, 3).join(', ')}`);
  } else if (negativeWords.length === 1) {
    bias -= 0.04;
    rulesApplied.push('BEARISH_KEYWORDS');
    reasons.push(`Bearish keyword: ${negativeWords[0]}`);
  }
  
  if (mixedSignals && positiveWords.length > 0 && negativeWords.length > 0) {
    bias *= 0.5;
    rulesApplied.push('CONFLICT_DAMPENER');
    reasons.push('Conflicting bullish/bearish signals');
  }
  
  if (questionTone) {
    bias *= 0.7;
    rulesApplied.push('QUESTION_DAMPENER');
    reasons.push('Question tone reduces signal strength');
  }
  
  if (shortText) {
    bias *= 0.8;
    rulesApplied.push('SHORT_TEXT_PENALTY');
    reasons.push('Short text reduces reliability');
  }
  
  return { bias: Math.max(-0.2, Math.min(0.2, bias)), rulesApplied, reasons };
}

function analyzeV15Mock(text: string): PredictResponse {
  const lexResult = calculateLexiconScore(text);
  const wordCount = text.split(/\s+/).length;
  const shortText = text.length < V15_CONFIG.penalties.shortTextChars;
  const veryShortText = wordCount < 3; // Less than 3 words
  const singleWord = wordCount === 1;
  
  // Simulate CNN score based on lexicon
  let simulatedCnnScore = lexResult.scoreNorm;
  // Reduced randomness to be more deterministic
  simulatedCnnScore += (Math.random() - 0.5) * 0.05;
  simulatedCnnScore = Math.max(0.15, Math.min(0.85, simulatedCnnScore));
  
  // A1 Calibration: Force NEUTRAL for very short text (1-2 words) even with signals
  // Single words like "moon" or "rekt" are too ambiguous
  if (singleWord) {
    simulatedCnnScore = 0.5; // Force neutral for single-word text
  } else if (veryShortText && lexResult.positiveWords.length === 0 && lexResult.negativeWords.length === 0) {
    simulatedCnnScore = 0.5; // Force neutral for ambiguous short text
  }
  
  const rulesResult = calculateRulesBias(
    lexResult.positiveWords,
    lexResult.negativeWords,
    lexResult.mixedSignals,
    lexResult.questionTone,
    shortText
  );
  
  // Ensemble score
  const cnnContribution = simulatedCnnScore * V15_CONFIG.weights.cnn;
  const lexContribution = lexResult.scoreNorm * V15_CONFIG.weights.lexicon;
  const rulesContribution = rulesResult.bias * V15_CONFIG.weights.rules;
  
  let finalScore = cnnContribution + lexContribution + rulesContribution;
  finalScore = Math.max(0, Math.min(1, finalScore));
  
  // A1 Calibration: Force NEUTRAL for single-word text regardless of score
  let label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  if (singleWord) {
    label = 'NEUTRAL';
  } else if (finalScore >= V15_CONFIG.thresholds.positive) {
    label = 'POSITIVE';
  } else if (finalScore <= V15_CONFIG.thresholds.negative) {
    label = 'NEGATIVE';
  } else {
    label = 'NEUTRAL';
  }
  
  // Penalty calculation
  let penalty = 1.0;
  const penaltyReasons: string[] = [];
  if (singleWord) { 
    penalty *= 0.4; // A1: Very harsh penalty for single words
    penaltyReasons.push('single word'); 
  } else if (shortText) { 
    penalty *= V15_CONFIG.penalties.shortTextFactor; 
    penaltyReasons.push('short text'); 
  }
  if (lexResult.mixedSignals) { penalty *= V15_CONFIG.penalties.conflictingSignalsFactor; penaltyReasons.push('conflicting signals'); }
  if (lexResult.questionTone) { penalty *= V15_CONFIG.penalties.questionToneFactor; penaltyReasons.push('question tone'); }
  
  // A1 Calibration: Improved confidence formula
  // - For clear signals with multiple keywords, boost confidence
  // - For short/ambiguous text, lower confidence
  const modelConfidence = Math.abs(simulatedCnnScore - 0.5) * 2;
  const agreement = 1 - Math.abs(simulatedCnnScore - lexResult.scoreNorm);
  
  // Signal strength bonus: more keywords = higher confidence
  const totalKeywords = lexResult.positiveWords.length + lexResult.negativeWords.length;
  const signalStrength = Math.min(totalKeywords / 3, 1); // Max bonus at 3+ keywords
  
  // Base confidence
  let confidence =
    modelConfidence * V15_CONFIG.confidence.modelWeight +
    agreement * V15_CONFIG.confidence.agreementWeight +
    signalStrength * 0.25; // A1: Signal strength contributes up to 0.25
  
  // Apply penalty
  confidence *= penalty;
  confidence = Math.max(0, Math.min(1, confidence));
  
  let confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  if (confidence >= 0.7) confidenceLevel = 'HIGH';
  else if (confidence >= 0.4) confidenceLevel = 'MEDIUM';
  else confidenceLevel = 'LOW';
  
  return {
    label,
    score: Math.round(finalScore * 1000) / 1000,
    meta: {
      // A3: Version info in every response
      engineVersion: ENGINE_VERSION,
      ruleset: RULESET_VERSION,
      frozen: FROZEN,
      modelVersion: 'mock-v1.5',
      qualityVersion: 'S3.v1.5',
      latencyMs: Math.floor(Math.random() * 10) + 1,
      mock: true,
      confidence: confidenceLevel,
      confidenceScore: Math.round(confidence * 1000) / 1000,
      adjusted: rulesResult.rulesApplied.length > 0,
      adjustReasons: rulesResult.rulesApplied,
      reasons: rulesResult.reasons,
      bias: {
        bullish: lexResult.positiveWords.length > 0,
        bearish: lexResult.negativeWords.length > 0,
        neutral: lexResult.positiveWords.length === 0 && lexResult.negativeWords.length === 0,
      },
      breakdown: {
        cnnScore: Math.round(simulatedCnnScore * 1000) / 1000,
        cnnContribution: Math.round(cnnContribution * 1000) / 1000,
        lexScoreNorm: Math.round(lexResult.scoreNorm * 1000) / 1000,
        lexContribution: Math.round(lexContribution * 1000) / 1000,
        rulesBias: Math.round(rulesResult.bias * 1000) / 1000,
        rulesContribution: Math.round(rulesContribution * 1000) / 1000,
      },
      confidenceDetails: {
        modelConfidence: Math.round(modelConfidence * 1000) / 1000,
        agreement: Math.round(agreement * 1000) / 1000,
        signalStrength: Math.round(signalStrength * 1000) / 1000,
        penalty: Math.round(penalty * 1000) / 1000,
        penaltyReasons,
      },
      detected: {
        positiveWords: lexResult.positiveWords,
        negativeWords: lexResult.negativeWords,
        neutralWords: lexResult.neutralWords,
        mixedSignals: lexResult.mixedSignals,
        questionTone: lexResult.questionTone,
        shortText,
        singleWord,
      },
      formula: V15_CONFIG.weights,
    },
  };
}

export interface PredictRequest {
  text: string;
}

export interface PredictResponse {
  label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  score: number;
  meta: {
    // A3: Version info
    engineVersion?: string;
    ruleset?: string;
    frozen?: boolean;
    modelVersion: string;
    qualityVersion?: string;
    latencyMs: number;
    mock?: boolean;
    confidence?: string;
    confidenceScore?: number;
    adjusted?: boolean;
    adjustReasons?: string[];
    reasons?: string[];
    // ML1.4: Hybrid Booster info
    hybridBooster?: {
      applied: boolean;
      originalConfidence?: number;
      boostedConfidence?: number;
      cnnLabel?: string;
      cnnConfidence?: number;
      reason?: string;
    };
    flags?: string[];
    bias?: {
      bullish: boolean;
      bearish: boolean;
      neutral?: boolean;
    };
    breakdown?: {
      cnnScore: number;
      cnnContribution: number;
      lexScoreNorm: number;
      lexContribution: number;
      rulesBias: number;
      rulesContribution: number;
    };
    confidenceDetails?: {
      modelConfidence: number;
      agreement: number;
      signalStrength?: number;
      penalty: number;
      penaltyReasons: string[];
    };
    detected?: {
      positiveWords: string[];
      negativeWords: string[];
      neutralWords?: string[];
      mixedSignals: boolean;
      questionTone: boolean;
      shortText: boolean;
      singleWord?: boolean;
    };
    formula?: Record<string, number>;
  };
}

export interface BatchItem {
  id: string;
  text: string;
}

export interface BatchRequest {
  items: BatchItem[];
}

export interface BatchResultItem {
  id: string;
  label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
  score: number | null;
  error: string | null;
}

export interface BatchResponse {
  results: BatchResultItem[];
  meta: {
    modelVersion: string;
    qualityVersion?: string;
    totalItems: number;
    adjustedItems?: number;
    latencyMs: number;
    mock?: boolean;
  };
}

export interface HealthResponse {
  status: 'READY' | 'MODEL_MISSING' | 'TOKENIZER_MISSING' | 'LOADING' | 'ERROR' | 'DEV_MODE';
  modelVersion: string | null;
  modelPath: string | null;
  tokenizerPath: string | null;
  loaded: boolean;
  error: string | null;
  mock?: boolean;
  reason?: string;
}

export interface TestResponse {
  results: Array<{
    text: string;
    label: string;
    score: number;
    error?: string;
  }>;
}

export interface EvalResponse {
  summary: {
    total: number;
    rawAccuracy: number;
    s3Accuracy: number;
    improvement: number;
    improvementPct: string;
  };
  confusionMatrix: Record<string, Record<string, number>>;
  details: Array<{
    text: string;
    expected: string;
    rawLabel: string;
    s3Label: string;
    rawCorrect: boolean;
    s3Correct: boolean;
    adjusted: boolean;
  }>;
  passed: boolean;
}

class SentimentClient {
  private client: AxiosInstance;
  private mockMode: boolean;

  constructor() {
    this.mockMode = MOCK_MODE;
    this.client = axios.create({
      baseURL: SENTIMENT_URL,
      timeout: SENTIMENT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (this.mockMode) {
      console.log('[SentimentClient] Running in MOCK MODE - sentiment_runtime disabled');
    }
  }

  isMockMode(): boolean {
    return this.mockMode;
  }

  // A3: Get freeze status for admin
  getFreezeStatus() {
    return {
      version: `v${ENGINE_VERSION}`,
      ruleset: RULESET_VERSION,
      frozen: FROZEN,
      mutable: !FROZEN,
      trainingAttached: false,
      priceFeedback: false,
      twitterIntegration: false,
      thresholds: V15_CONFIG.thresholds,
      weights: V15_CONFIG.weights,
      confidence: V15_CONFIG.confidence,
    };
  }

  // A3: Get version info
  getVersionInfo() {
    return {
      engineVersion: ENGINE_VERSION,
      ruleset: RULESET_VERSION,
      frozen: FROZEN,
    };
  }

  // ML1.4: Get Hybrid Booster status
  getBoosterStatus() {
    return {
      enabled: ml14BoosterEnabled,
      config: {
        cnnConfidenceThreshold: ML14_CONFIG.cnnConfidenceThreshold,
        maxBoost: ML14_CONFIG.maxBoost,
        boostMultiplier: ML14_CONFIG.boostMultiplier,
        confidenceCap: ML14_CONFIG.confidenceCap,
      },
    };
  }

  // ML1.4: Toggle Hybrid Booster
  setBoosterEnabled(enabled: boolean) {
    ml14BoosterEnabled = enabled;
    console.log(`[ML1.4] Hybrid Booster ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return { enabled: ml14BoosterEnabled };
  }

  // ML1.4: Update Booster threshold
  setBoosterThreshold(threshold: number) {
    if (threshold < 0.5 || threshold > 0.95) {
      throw new Error('Threshold must be between 0.5 and 0.95');
    }
    ML14_CONFIG.cnnConfidenceThreshold = threshold;
    console.log(`[ML1.4] Booster threshold updated to ${threshold}`);
    return { threshold: ML14_CONFIG.cnnConfidenceThreshold };
  }

  async health(): Promise<HealthResponse> {
    // In mock mode, return dev status with v1.5 info
    if (this.mockMode) {
      return {
        status: 'DEV_MODE',
        modelVersion: `mock-v${ENGINE_VERSION}`,
        modelPath: null,
        tokenizerPath: null,
        loaded: false,
        error: null,
        mock: true,
        reason: `Sentiment runtime disabled for dev mode. Using v${ENGINE_VERSION} (${RULESET_VERSION}, frozen=${FROZEN}).`,
      };
    }

    try {
      const response = await this.client.get<HealthResponse>('/health');
      return response.data;
    } catch (error: any) {
      return {
        status: 'ERROR',
        modelVersion: null,
        modelPath: null,
        tokenizerPath: null,
        loaded: false,
        error: error.message || 'Sentiment service unavailable',
      };
    }
  }

  async predict(text: string): Promise<PredictResponse> {
    // S4.1 Guard: prevent silent contract bugs
    if (typeof text !== 'string') {
      throw new Error(`Sentiment.predict expects string input, got ${typeof text}`);
    }
    
    const startTime = Date.now();
    let result: PredictResponse;
    
    // Return v1.5 mock in dev mode (ACTIVE PIPELINE)
    if (this.mockMode) {
      result = analyzeV15Mock(text);
    } else {
      const response = await this.client.post<PredictResponse>('/predict', { text });
      result = response.data;
    }
    
    const mockLatency = Date.now() - startTime;
    
    // ML1.4 Hybrid Confidence Booster
    // Условия: MOCK=NEUTRAL, CNN=POSITIVE, CNN.conf >= threshold
    if (ml14BoosterEnabled && result.label === 'NEUTRAL') {
      result = await this.applyHybridBooster(text, result, mockLatency);
    } else {
      // Shadow Mode только если booster не применился (fire-and-forget)
      this.runShadowComparison(text, result, mockLatency);
      // Добавляем информацию о бустере (не применён)
      result.meta.hybridBooster = {
        applied: false,
        reason: result.label !== 'NEUTRAL' 
          ? `MOCK label is ${result.label}, booster only works on NEUTRAL`
          : 'Booster disabled',
      };
      result.meta.flags = result.meta.flags || [];
    }
    
    return result;
  }
  
  /**
   * ML1.4 Hybrid Confidence Booster
   * 
   * ПРИНЦИП:
   * - MOCK остаётся SOURCE OF TRUTH (label НЕ меняется)
   * - CNN используется ТОЛЬКО как усилитель confidence
   * - Активируется ТОЛЬКО при: MOCK=NEUTRAL, CNN=POSITIVE, CNN.conf >= 0.70
   * 
   * ЧТО МЕНЯЕТСЯ:
   * - confidence (увеличивается)
   * - flags (добавляется 'cnn_positive_boost')
   * - reasons (добавляется объяснение)
   * 
   * ЧТО НЕ МЕНЯЕТСЯ:
   * - label (остаётся NEUTRAL)
   * - score
   * - thresholds
   */
  private async applyHybridBooster(
    text: string, 
    mockResult: PredictResponse, 
    mockLatency: number
  ): Promise<PredictResponse> {
    // Получаем результат CNN
    let cnnResult: { label: string; score: number; confidence: number } | null = null;
    
    try {
      const { realMLShadowClient } = await import('./real-ml-shadow.client.js');
      
      if (realMLShadowClient.isEnabled()) {
        const realResult = await realMLShadowClient.predict(text);
        if (realResult && !realResult.error) {
          cnnResult = {
            label: realResult.label,
            score: realResult.score,
            confidence: realResult.confidence,
          };
        }
      }
    } catch (err) {
      console.error('[ML1.4] Failed to get CNN result:', err);
    }
    
    // Инициализируем поля для booster
    const flags: string[] = mockResult.meta.flags || [];
    const reasons: string[] = [...(mockResult.meta.reasons || [])];
    let confidenceScore = mockResult.meta.confidenceScore || 0.5;
    const originalConfidence = confidenceScore;
    
    // Проверяем условия активации бустера
    const boosterConditions = {
      mockIsNeutral: mockResult.label === 'NEUTRAL',
      cnnIsPositive: cnnResult?.label === 'POSITIVE',
      cnnConfidenceHigh: cnnResult ? cnnResult.confidence >= ML14_CONFIG.cnnConfidenceThreshold : false,
      noConflictFlags: !mockResult.meta.detected?.mixedSignals && !mockResult.meta.detected?.questionTone,
      boosterEnabled: ml14BoosterEnabled,
    };
    
    const allConditionsMet = 
      boosterConditions.mockIsNeutral &&
      boosterConditions.cnnIsPositive &&
      boosterConditions.cnnConfidenceHigh &&
      boosterConditions.noConflictFlags &&
      boosterConditions.boosterEnabled;
    
    let boosterApplied = false;
    let boosterReason = '';
    
    if (allConditionsMet && cnnResult) {
      // Применяем бустер
      const boost = Math.min(ML14_CONFIG.maxBoost, cnnResult.confidence * ML14_CONFIG.boostMultiplier);
      confidenceScore += boost;
      
      // Ограничиваем сверху
      if (confidenceScore > ML14_CONFIG.confidenceCap) {
        confidenceScore = ML14_CONFIG.confidenceCap;
      }
      
      // Добавляем мета-флаги
      flags.push('cnn_positive_boost');
      reasons.push('CNN detected early positive signal');
      reasons.push(`High confidence neural agreement (${Math.round(cnnResult.confidence * 100)}%)`);
      
      boosterApplied = true;
      boosterReason = `Boost applied: +${Math.round(boost * 100)}% confidence`;
      
      console.log(`[ML1.4] Booster APPLIED: ${mockResult.label} → confidence ${Math.round(originalConfidence * 100)}% → ${Math.round(confidenceScore * 100)}%`);
    } else {
      // Определяем причину НЕ применения
      if (!cnnResult) {
        boosterReason = 'CNN result not available';
      } else if (!boosterConditions.cnnIsPositive) {
        boosterReason = `CNN label is ${cnnResult.label}, expected POSITIVE`;
      } else if (!boosterConditions.cnnConfidenceHigh) {
        boosterReason = `CNN confidence ${Math.round(cnnResult.confidence * 100)}% < ${Math.round(ML14_CONFIG.cnnConfidenceThreshold * 100)}% threshold`;
      } else if (!boosterConditions.noConflictFlags) {
        boosterReason = 'Conflict/question flags present, booster blocked';
      } else if (!boosterConditions.boosterEnabled) {
        boosterReason = 'Booster disabled via admin';
      }
      
      // Fire-and-forget shadow comparison (если CNN был получен)
      if (cnnResult) {
        this.runShadowComparison(text, mockResult, mockLatency);
      }
    }
    
    // Пересчитываем confidence level
    let confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    if (confidenceScore >= 0.7) confidenceLevel = 'HIGH';
    else if (confidenceScore >= 0.4) confidenceLevel = 'MEDIUM';
    else confidenceLevel = 'LOW';
    
    // Собираем результат
    return {
      ...mockResult,
      meta: {
        ...mockResult.meta,
        engineVersion: ENGINE_VERSION,
        ruleset: RULESET_VERSION,
        confidence: confidenceLevel,
        confidenceScore: Math.round(confidenceScore * 1000) / 1000,
        reasons,
        flags,
        hybridBooster: {
          applied: boosterApplied,
          originalConfidence: Math.round(originalConfidence * 1000) / 1000,
          boostedConfidence: boosterApplied ? Math.round(confidenceScore * 1000) / 1000 : undefined,
          cnnLabel: cnnResult?.label,
          cnnConfidence: cnnResult ? Math.round(cnnResult.confidence * 1000) / 1000 : undefined,
          reason: boosterReason,
        },
      },
    };
  }
  
  /**
   * ML1 Shadow Mode - Run parallel comparison with REAL ML
   * This is FIRE-AND-FORGET - does not block or affect the result
   */
  private runShadowComparison(text: string, mockResult: PredictResponse, mockLatency: number) {
    // Import dynamically to avoid circular deps
    import('./real-ml-shadow.client.js').then(({ realMLShadowClient }) => {
      if (realMLShadowClient.isEnabled()) {
        realMLShadowClient.shadowCompare(
          text,
          {
            label: mockResult.label,
            score: mockResult.score,
            confidence: mockResult.meta?.confidenceScore || 0.5,
          },
          mockLatency
        ).catch(err => {
          console.error('[ML1 Shadow] Comparison error:', err.message);
        });
      }
    }).catch(() => {
      // Shadow client not available, ignore
    });
  }

  async predictBatch(items: BatchItem[]): Promise<BatchResponse> {
    // Return v1.5 mock in dev mode
    if (this.mockMode) {
      const results = items.map((item) => {
        const analysis = analyzeV15Mock(item.text);
        return {
          id: item.id,
          label: analysis.label,
          score: analysis.score,
          error: null,
        };
      });
      
      const adjustedCount = results.filter((_, i) => {
        const analysis = analyzeV15Mock(items[i].text);
        return analysis.meta.adjusted;
      }).length;
      
      return {
        results,
        meta: {
          modelVersion: 'mock-v1.5',
          qualityVersion: 'S3.v1.5',
          totalItems: items.length,
          adjustedItems: adjustedCount,
          latencyMs: items.length + Math.floor(Math.random() * 5),
          mock: true,
        },
      };
    }

    const response = await this.client.post<BatchResponse>('/predict-batch', { items });
    return response.data;
  }

  async eval(): Promise<EvalResponse> {
    if (this.mockMode) {
      // Run v1.5 evaluation on test dataset
      const testData = [
        { text: 'Bitcoin breakout! Very bullish!', expected: 'POSITIVE' },
        { text: 'Crypto market crashing hard', expected: 'NEGATIVE' },
        { text: 'ETH trading sideways', expected: 'NEUTRAL' },
        { text: 'SOL pump incoming moon!', expected: 'POSITIVE' },
        { text: 'Panic selling everywhere fear', expected: 'NEGATIVE' },
        { text: 'Market looks stable today', expected: 'NEUTRAL' },
        { text: 'BTC ATH soon accumulation', expected: 'POSITIVE' },
        { text: 'Dump dump dump sell now', expected: 'NEGATIVE' },
        { text: 'Prices unchanged no movement', expected: 'NEUTRAL' },
        { text: 'Bullish sentiment growing strong', expected: 'POSITIVE' },
        { text: 'Bear market confirmed crash', expected: 'NEGATIVE' },
        { text: 'Mixed signals uncertain market', expected: 'NEUTRAL' },
      ];
      
      let correct = 0;
      const details = testData.map(item => {
        const analysis = analyzeV15Mock(item.text);
        const match = analysis.label === item.expected;
        if (match) correct++;
        
        return {
          text: item.text,
          expected: item.expected,
          rawLabel: analysis.label,
          s3Label: analysis.label,
          rawCorrect: match,
          s3Correct: match,
          adjusted: analysis.meta.adjusted || false,
        };
      });
      
      const accuracy = correct / testData.length;
      
      // Build confusion matrix
      const confusionMatrix: Record<string, Record<string, number>> = {
        positive: { tp: 0, fp: 0, fn: 0 },
        neutral: { tp: 0, fp: 0, fn: 0 },
        negative: { tp: 0, fp: 0, fn: 0 },
      };
      
      details.forEach(d => {
        const exp = d.expected.toLowerCase();
        const pred = d.s3Label.toLowerCase();
        if (d.s3Correct) {
          confusionMatrix[exp].tp++;
        } else {
          confusionMatrix[exp].fn++;
          confusionMatrix[pred].fp++;
        }
      });
      
      return {
        summary: {
          total: testData.length,
          rawAccuracy: accuracy,
          s3Accuracy: accuracy,
          improvement: 0,
          improvementPct: 'N/A (mock v1.5)',
        },
        confusionMatrix,
        details,
        passed: accuracy >= 0.6,
      };
    }

    const response = await this.client.post<EvalResponse>('/eval');
    return response.data;
  }

  async reload(): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (this.mockMode) {
      return { ok: false, error: 'Cannot reload in mock mode - sentiment_runtime is disabled' };
    }

    try {
      const response = await this.client.post('/reload');
      return response.data;
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }

  async test(): Promise<TestResponse> {
    if (this.mockMode) {
      const testTexts = [
        'Bitcoin is pumping! Moon incoming! 🚀',
        'Market crash imminent, sell everything',
        'ETH price stable today',
        'BTC looks bullish but could be a trap',
        'Should I buy SOL?',
      ];
      
      return {
        results: testTexts.map(text => {
          const analysis = analyzeV15Mock(text);
          return {
            text,
            label: analysis.label,
            score: analysis.score,
          };
        }),
      };
    }

    const response = await this.client.post<TestResponse>('/test');
    return response.data;
  }

  isAvailable(): boolean {
    return this.mockMode || !!SENTIMENT_URL;
  }
}

export const sentimentClient = new SentimentClient();
