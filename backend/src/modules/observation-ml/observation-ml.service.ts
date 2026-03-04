/**
 * S6.5 — ObservationModel v1
 * ==========================
 * 
 * First trainable intelligence layer.
 * Learns to distinguish USE from IGNORE from MISS_ALERT.
 * 
 * MODEL: LogisticRegression / XGBoost (simple, interpretable)
 * 
 * DOES NOT:
 * - Predict price
 * - Change sentiment
 * - Trade
 * - Affect core system
 * 
 * DOES:
 * - Score signal quality
 * - Explain decisions
 * - Prepare for S7 (Validation Layer)
 * 
 * INTEGRATION: Admin UI only, read-only for core
 */

import { MongoClient, Db, Collection } from 'mongodb';
import { observationService, ObservationRow } from '../observation/observation.service.js';

// ============================================================
// Types
// ============================================================

export type MLDecision = 'USE' | 'IGNORE' | 'MISS_ALERT';

export interface FeatureVector {
  // Sentiment features
  sentiment_label_encoded: number;  // POS=1, NEU=0, NEG=-1
  sentiment_confidence: number;
  cnn_confidence: number | null;
  booster_applied: number;  // 0 or 1
  
  // Price context
  price_direction_encoded: number;  // UP=1, FLAT=0, DOWN=-1
  price_magnitude_encoded: number;  // STRONG=2, WEAK=1, NONE=0
  horizon_encoded: number;  // 5m=1, 15m=2, 1h=3, 4h=4, 24h=5
  
  // Market context
  volatility_1h: number | null;
  momentum_15m: number | null;
  delta_1h_before: number | null;
  
  // Meta
  is_false_confidence: number;  // 0 or 1
  is_missed_opportunity: number;  // 0 or 1
  confidence_bucket: number;  // 0=<0.5, 1=0.5-0.7, 2=0.7-0.9, 3=0.9+
}

export interface MLPrediction {
  decision: MLDecision;
  confidence: number;
  probabilities: {
    USE: number;
    IGNORE: number;
    MISS_ALERT: number;
  };
  reasons: string[];
  feature_importance: Array<{ feature: string; weight: number }>;
}

export interface ModelMetrics {
  accuracy: number;
  precision_use: number;
  recall_miss: number;
  false_confidence_reduction: number;
  f1_score: number;
  confusion_matrix: {
    USE: { USE: number; IGNORE: number; MISS_ALERT: number };
    IGNORE: { USE: number; IGNORE: number; MISS_ALERT: number };
    MISS_ALERT: { USE: number; IGNORE: number; MISS_ALERT: number };
  };
}

export interface TrainingResult {
  model_id: string;
  version: string;
  trained_at: Date;
  train_size: number;
  val_size: number;
  metrics: ModelMetrics;
  feature_importance: Array<{ feature: string; weight: number }>;
  status: 'TRAINED' | 'FAILED' | 'INSUFFICIENT_DATA';
}

// ============================================================
// Constants
// ============================================================

const MODEL_VERSION = 'v1.0';
const MIN_TRAINING_SAMPLES = 500;
const TRAIN_SPLIT = 0.7;

// Label encodings
const SENTIMENT_ENCODING = { POSITIVE: 1, NEUTRAL: 0, NEGATIVE: -1 };
const DIRECTION_ENCODING = { UP: 1, FLAT: 0, DOWN: -1 };
const MAGNITUDE_ENCODING = { STRONG: 2, WEAK: 1, NONE: 0 };
const HORIZON_ENCODING = { '5m': 1, '15m': 2, '1h': 3, '4h': 4, '24h': 5 };

// ============================================================
// Feature Engineering
// ============================================================

/**
 * Extract feature vector from ObservationRow
 */
export function extractFeatures(row: ObservationRow): FeatureVector {
  const confBucket = 
    row.sentiment.confidence >= 0.9 ? 3 :
    row.sentiment.confidence >= 0.7 ? 2 :
    row.sentiment.confidence >= 0.5 ? 1 : 0;
  
  return {
    // Sentiment
    sentiment_label_encoded: SENTIMENT_ENCODING[row.sentiment.label] ?? 0,
    sentiment_confidence: row.sentiment.confidence,
    cnn_confidence: row.sentiment.cnn_confidence ?? null,
    booster_applied: row.sentiment.booster_applied ? 1 : 0,
    
    // Price context
    price_direction_encoded: DIRECTION_ENCODING[row.outcome.reaction_direction] ?? 0,
    price_magnitude_encoded: MAGNITUDE_ENCODING[row.outcome.reaction_magnitude] ?? 0,
    horizon_encoded: HORIZON_ENCODING[row.horizon] ?? 3,
    
    // Market context
    volatility_1h: row.market.volatility_1h,
    momentum_15m: row.market.momentum_15m,
    delta_1h_before: row.market.delta_1h_before,
    
    // Meta
    is_false_confidence: row.targets.false_confidence ? 1 : 0,
    is_missed_opportunity: row.targets.missed_opportunity ? 1 : 0,
    confidence_bucket: confBucket,
  };
}

/**
 * Get target label from ObservationRow
 */
export function extractTarget(row: ObservationRow): MLDecision {
  // Use existing decision if available
  if (row.decision?.verdict) {
    return row.decision.verdict as MLDecision;
  }
  
  // Fallback to computed target
  if (row.targets.missed_opportunity) return 'MISS_ALERT';
  if (row.targets.usable_signal) return 'USE';
  return 'IGNORE';
}

// ============================================================
// Simple Logistic Regression (Pure TypeScript)
// ============================================================

/**
 * Simple LogisticRegression implementation
 * For production, consider using ml.js or similar
 */
class SimpleLogReg {
  private weights: Map<string, number[]> = new Map();
  private classes: MLDecision[] = ['USE', 'IGNORE', 'MISS_ALERT'];
  private featureNames: string[] = [];
  private trained: boolean = false;
  
  /**
   * Sigmoid function
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }
  
  /**
   * Softmax for multi-class
   */
  private softmax(logits: number[]): number[] {
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map(l => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    return expLogits.map(e => e / sumExp);
  }
  
  /**
   * Train the model using gradient descent
   */
  train(X: number[][], y: MLDecision[], options?: {
    learningRate?: number;
    iterations?: number;
  }): void {
    const lr = options?.learningRate || 0.1;
    const iterations = options?.iterations || 1000;
    
    if (X.length === 0) return;
    
    const numFeatures = X[0].length;
    this.featureNames = [
      'sentiment_label_encoded',
      'sentiment_confidence',
      'cnn_confidence',
      'booster_applied',
      'price_direction_encoded',
      'price_magnitude_encoded',
      'horizon_encoded',
      'volatility_1h',
      'momentum_15m',
      'delta_1h_before',
      'is_false_confidence',
      'is_missed_opportunity',
      'confidence_bucket',
    ].slice(0, numFeatures);
    
    // Initialize weights
    for (const cls of this.classes) {
      this.weights.set(cls, new Array(numFeatures + 1).fill(0)); // +1 for bias
    }
    
    // One-vs-rest training
    for (const cls of this.classes) {
      const w = this.weights.get(cls)!;
      const yBinary = y.map(label => label === cls ? 1 : 0);
      
      for (let iter = 0; iter < iterations; iter++) {
        const gradients = new Array(numFeatures + 1).fill(0);
        
        for (let i = 0; i < X.length; i++) {
          const xi = [...X[i], 1]; // Add bias term
          const z = xi.reduce((sum, xij, j) => sum + xij * w[j], 0);
          const pred = this.sigmoid(z);
          const error = pred - yBinary[i];
          
          for (let j = 0; j < xi.length; j++) {
            gradients[j] += error * xi[j];
          }
        }
        
        // Update weights
        for (let j = 0; j < w.length; j++) {
          w[j] -= lr * gradients[j] / X.length;
        }
      }
    }
    
    this.trained = true;
  }
  
  /**
   * Predict class probabilities
   */
  predictProba(x: number[]): { USE: number; IGNORE: number; MISS_ALERT: number } {
    if (!this.trained) {
      return { USE: 0.33, IGNORE: 0.34, MISS_ALERT: 0.33 };
    }
    
    const xi = [...x, 1]; // Add bias
    const logits: number[] = [];
    
    for (const cls of this.classes) {
      const w = this.weights.get(cls)!;
      const z = xi.reduce((sum, xij, j) => sum + xij * w[j], 0);
      logits.push(z);
    }
    
    const probs = this.softmax(logits);
    return {
      USE: probs[0],
      IGNORE: probs[1],
      MISS_ALERT: probs[2],
    };
  }
  
  /**
   * Predict class
   */
  predict(x: number[]): MLDecision {
    const probs = this.predictProba(x);
    const entries = Object.entries(probs) as [MLDecision, number][];
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }
  
  /**
   * Get feature importance (absolute weight values)
   */
  getFeatureImportance(): Array<{ feature: string; weight: number }> {
    if (!this.trained) return [];
    
    const importance: Map<string, number> = new Map();
    
    for (const cls of this.classes) {
      const w = this.weights.get(cls)!;
      for (let i = 0; i < this.featureNames.length; i++) {
        const current = importance.get(this.featureNames[i]) || 0;
        importance.set(this.featureNames[i], current + Math.abs(w[i]));
      }
    }
    
    return Array.from(importance.entries())
      .map(([feature, weight]) => ({ feature, weight: weight / this.classes.length }))
      .sort((a, b) => b.weight - a.weight);
  }
  
  /**
   * Check if model is trained
   */
  isTrained(): boolean {
    return this.trained;
  }
  
  /**
   * Export model state
   */
  export(): { weights: Record<string, number[]>; featureNames: string[] } {
    const weights: Record<string, number[]> = {};
    for (const [cls, w] of this.weights.entries()) {
      weights[cls] = [...w];
    }
    return { weights, featureNames: this.featureNames };
  }
  
  /**
   * Import model state
   */
  import(state: { weights: Record<string, number[]>; featureNames: string[] }): void {
    this.weights.clear();
    for (const [cls, w] of Object.entries(state.weights)) {
      this.weights.set(cls as MLDecision, w);
    }
    this.featureNames = state.featureNames;
    this.trained = true;
  }
}

// ============================================================
// ObservationML Service
// ============================================================

class ObservationMLService {
  private db: Db | null = null;
  private models: Collection | null = null;
  private model: SimpleLogReg | null = null;
  private currentModelId: string | null = null;
  
  /**
   * Connect to MongoDB
   */
  private async connect(): Promise<void> {
    if (this.db) return;
    
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'price_correlator';
    
    const client = new MongoClient(mongoUrl);
    await client.connect();
    this.db = client.db(dbName);
    this.models = this.db.collection('observation_models');
    
    console.log('[ObservationML] Connected to MongoDB');
  }
  
  /**
   * Prepare training data
   */
  async prepareTrainingData(): Promise<{
    X: number[][];
    y: MLDecision[];
    featureNames: string[];
    stats: {
      total: number;
      byClass: Record<MLDecision, number>;
      ready: boolean;
    };
  }> {
    const rows = await observationService.getObservations({ limit: 10000 });
    
    const X: number[][] = [];
    const y: MLDecision[] = [];
    const byClass: Record<MLDecision, number> = { USE: 0, IGNORE: 0, MISS_ALERT: 0 };
    
    for (const row of rows) {
      const features = extractFeatures(row);
      const target = extractTarget(row);
      
      // Convert to array, handle nulls
      const featureArray = [
        features.sentiment_label_encoded,
        features.sentiment_confidence,
        features.cnn_confidence ?? 0.5,
        features.booster_applied,
        features.price_direction_encoded,
        features.price_magnitude_encoded,
        features.horizon_encoded,
        features.volatility_1h ?? 0,
        features.momentum_15m ?? 0,
        features.delta_1h_before ?? 0,
        features.is_false_confidence,
        features.is_missed_opportunity,
        features.confidence_bucket,
      ];
      
      X.push(featureArray);
      y.push(target);
      byClass[target] = (byClass[target] || 0) + 1;
    }
    
    const featureNames = [
      'sentiment_label_encoded',
      'sentiment_confidence',
      'cnn_confidence',
      'booster_applied',
      'price_direction_encoded',
      'price_magnitude_encoded',
      'horizon_encoded',
      'volatility_1h',
      'momentum_15m',
      'delta_1h_before',
      'is_false_confidence',
      'is_missed_opportunity',
      'confidence_bucket',
    ];
    
    return {
      X,
      y,
      featureNames,
      stats: {
        total: rows.length,
        byClass,
        ready: rows.length >= MIN_TRAINING_SAMPLES,
      },
    };
  }
  
  /**
   * Train the model
   */
  async train(options?: { force?: boolean }): Promise<TrainingResult> {
    await this.connect();
    
    const data = await this.prepareTrainingData();
    
    // Check if we have enough data
    if (!data.stats.ready && !options?.force) {
      return {
        model_id: '',
        version: MODEL_VERSION,
        trained_at: new Date(),
        train_size: 0,
        val_size: 0,
        metrics: {
          accuracy: 0,
          precision_use: 0,
          recall_miss: 0,
          false_confidence_reduction: 0,
          f1_score: 0,
          confusion_matrix: {
            USE: { USE: 0, IGNORE: 0, MISS_ALERT: 0 },
            IGNORE: { USE: 0, IGNORE: 0, MISS_ALERT: 0 },
            MISS_ALERT: { USE: 0, IGNORE: 0, MISS_ALERT: 0 },
          },
        },
        feature_importance: [],
        status: 'INSUFFICIENT_DATA',
      };
    }
    
    // Split data (time-based)
    const splitIdx = Math.floor(data.X.length * TRAIN_SPLIT);
    const X_train = data.X.slice(0, splitIdx);
    const y_train = data.y.slice(0, splitIdx);
    const X_val = data.X.slice(splitIdx);
    const y_val = data.y.slice(splitIdx);
    
    // Train model
    const model = new SimpleLogReg();
    model.train(X_train, y_train, {
      learningRate: 0.1,
      iterations: 1000,
    });
    
    // Evaluate
    const metrics = this.evaluate(model, X_val, y_val);
    const feature_importance = model.getFeatureImportance();
    
    // Save model
    const model_id = `obs_model_${Date.now()}`;
    const modelState = model.export();
    
    if (this.models) {
      await this.models.updateOne(
        { model_id },
        {
          $set: {
            model_id,
            version: MODEL_VERSION,
            trained_at: new Date(),
            train_size: X_train.length,
            val_size: X_val.length,
            metrics,
            feature_importance,
            model_state: modelState,
            is_active: true,
          },
        },
        { upsert: true }
      );
      
      // Deactivate old models
      await this.models.updateMany(
        { model_id: { $ne: model_id } },
        { $set: { is_active: false } }
      );
    }
    
    // Set as current model
    this.model = model;
    this.currentModelId = model_id;
    
    console.log(`[ObservationML] Model trained: ${model_id}, accuracy=${metrics.accuracy.toFixed(3)}`);
    
    return {
      model_id,
      version: MODEL_VERSION,
      trained_at: new Date(),
      train_size: X_train.length,
      val_size: X_val.length,
      metrics,
      feature_importance,
      status: 'TRAINED',
    };
  }
  
  /**
   * Evaluate model
   */
  private evaluate(model: SimpleLogReg, X: number[][], y: MLDecision[]): ModelMetrics {
    const predictions = X.map(x => model.predict(x));
    
    // Confusion matrix
    const confusion: ModelMetrics['confusion_matrix'] = {
      USE: { USE: 0, IGNORE: 0, MISS_ALERT: 0 },
      IGNORE: { USE: 0, IGNORE: 0, MISS_ALERT: 0 },
      MISS_ALERT: { USE: 0, IGNORE: 0, MISS_ALERT: 0 },
    };
    
    let correct = 0;
    for (let i = 0; i < y.length; i++) {
      confusion[y[i]][predictions[i]]++;
      if (y[i] === predictions[i]) correct++;
    }
    
    // Metrics
    const accuracy = y.length > 0 ? correct / y.length : 0;
    
    // Precision(USE)
    const use_predicted = confusion.USE.USE + confusion.IGNORE.USE + confusion.MISS_ALERT.USE;
    const precision_use = use_predicted > 0 ? confusion.USE.USE / use_predicted : 0;
    
    // Recall(MISS_ALERT)
    const miss_actual = confusion.MISS_ALERT.USE + confusion.MISS_ALERT.IGNORE + confusion.MISS_ALERT.MISS_ALERT;
    const recall_miss = miss_actual > 0 ? confusion.MISS_ALERT.MISS_ALERT / miss_actual : 0;
    
    // F1 (macro average)
    const f1_score = precision_use > 0 && recall_miss > 0 
      ? 2 * (precision_use * recall_miss) / (precision_use + recall_miss)
      : 0;
    
    // False confidence reduction (placeholder)
    const false_confidence_reduction = 0;
    
    return {
      accuracy,
      precision_use,
      recall_miss,
      false_confidence_reduction,
      f1_score,
      confusion_matrix: confusion,
    };
  }
  
  /**
   * Load active model
   */
  async loadModel(): Promise<boolean> {
    await this.connect();
    if (!this.models) return false;
    
    const activeModel = await this.models.findOne({ is_active: true });
    if (!activeModel) return false;
    
    const model = new SimpleLogReg();
    model.import(activeModel.model_state);
    
    this.model = model;
    this.currentModelId = activeModel.model_id;
    
    console.log(`[ObservationML] Loaded model: ${activeModel.model_id}`);
    return true;
  }
  
  /**
   * Predict for a single ObservationRow
   */
  async predict(row: ObservationRow): Promise<MLPrediction | null> {
    if (!this.model) {
      const loaded = await this.loadModel();
      if (!loaded) return null;
    }
    
    const features = extractFeatures(row);
    const featureArray = [
      features.sentiment_label_encoded,
      features.sentiment_confidence,
      features.cnn_confidence ?? 0.5,
      features.booster_applied,
      features.price_direction_encoded,
      features.price_magnitude_encoded,
      features.horizon_encoded,
      features.volatility_1h ?? 0,
      features.momentum_15m ?? 0,
      features.delta_1h_before ?? 0,
      features.is_false_confidence,
      features.is_missed_opportunity,
      features.confidence_bucket,
    ];
    
    const probs = this.model!.predictProba(featureArray);
    const decision = this.model!.predict(featureArray);
    const maxProb = Math.max(probs.USE, probs.IGNORE, probs.MISS_ALERT);
    
    // Generate reasons
    const reasons: string[] = [];
    if (features.sentiment_confidence < 0.5) reasons.push('low_sentiment_confidence');
    if (features.sentiment_confidence >= 0.7) reasons.push('high_sentiment_confidence');
    if (features.price_magnitude_encoded === 2) reasons.push('strong_price_movement');
    if (features.is_false_confidence) reasons.push('false_confidence_pattern');
    if (features.is_missed_opportunity) reasons.push('missed_opportunity_pattern');
    
    return {
      decision,
      confidence: maxProb,
      probabilities: probs,
      reasons,
      feature_importance: this.model!.getFeatureImportance().slice(0, 5),
    };
  }
  
  /**
   * Get model status and metrics
   */
  async getStatus(): Promise<{
    hasModel: boolean;
    modelId: string | null;
    version: string;
    trainingStats: {
      total: number;
      byClass: Record<MLDecision, number>;
      ready: boolean;
      minRequired: number;
    };
    metrics: ModelMetrics | null;
    feature_importance: Array<{ feature: string; weight: number }>;
  }> {
    await this.connect();
    
    const data = await this.prepareTrainingData();
    
    let metrics: ModelMetrics | null = null;
    let feature_importance: Array<{ feature: string; weight: number }> = [];
    
    if (this.models) {
      const activeModel = await this.models.findOne({ is_active: true });
      if (activeModel) {
        metrics = activeModel.metrics;
        feature_importance = activeModel.feature_importance || [];
        this.currentModelId = activeModel.model_id;
      }
    }
    
    return {
      hasModel: this.model !== null || metrics !== null,
      modelId: this.currentModelId,
      version: MODEL_VERSION,
      trainingStats: {
        total: data.stats.total,
        byClass: data.stats.byClass,
        ready: data.stats.ready,
        minRequired: MIN_TRAINING_SAMPLES,
      },
      metrics,
      feature_importance,
    };
  }
  
  /**
   * Compare Rules v0 vs ML v1
   */
  async compareWithRules(): Promise<{
    rulesV0: {
      accuracy: number;
      precision_use: number;
      recall_miss: number;
    };
    mlV1: {
      accuracy: number;
      precision_use: number;
      recall_miss: number;
    } | null;
    improvement: {
      accuracy_delta: number;
      precision_delta: number;
      recall_delta: number;
    } | null;
  }> {
    const data = await this.prepareTrainingData();
    
    // Rules v0 performance (current decisions)
    const rows = await observationService.getObservations({ limit: 10000 });
    
    let rulesCorrect = 0;
    let rulesUseCorrect = 0;
    let rulesUsePredicted = 0;
    let rulesMissCorrect = 0;
    let rulesMissActual = 0;
    
    for (const row of rows) {
      const actual = extractTarget(row);
      const predicted = row.decision?.verdict as MLDecision || 'IGNORE';
      
      if (actual === predicted) rulesCorrect++;
      if (predicted === 'USE') {
        rulesUsePredicted++;
        if (actual === 'USE') rulesUseCorrect++;
      }
      if (actual === 'MISS_ALERT') {
        rulesMissActual++;
        if (predicted === 'MISS_ALERT') rulesMissCorrect++;
      }
    }
    
    const rulesV0 = {
      accuracy: rows.length > 0 ? rulesCorrect / rows.length : 0,
      precision_use: rulesUsePredicted > 0 ? rulesUseCorrect / rulesUsePredicted : 0,
      recall_miss: rulesMissActual > 0 ? rulesMissCorrect / rulesMissActual : 0,
    };
    
    // ML v1 (if available)
    let mlV1 = null;
    let improvement = null;
    
    if (this.models) {
      const activeModel = await this.models.findOne({ is_active: true });
      if (activeModel?.metrics) {
        mlV1 = {
          accuracy: activeModel.metrics.accuracy,
          precision_use: activeModel.metrics.precision_use,
          recall_miss: activeModel.metrics.recall_miss,
        };
        
        improvement = {
          accuracy_delta: mlV1.accuracy - rulesV0.accuracy,
          precision_delta: mlV1.precision_use - rulesV0.precision_use,
          recall_delta: mlV1.recall_miss - rulesV0.recall_miss,
        };
      }
    }
    
    return { rulesV0, mlV1, improvement };
  }
}

export const observationMLService = new ObservationMLService();
