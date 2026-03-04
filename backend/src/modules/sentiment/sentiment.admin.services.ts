/**
 * S3.8.1 — Sentiment Admin Services
 * 
 * Config, Eval, and Runs management for Sentiment Engine
 * Works in mock mode, storage optional
 */

// ============================================
// Types
// ============================================

export interface SentimentConfig {
  thresholds: {
    neutralLow: number;
    neutralHigh: number;
    strongSignal: number;
    weakSignal: number;
  };
  rules: {
    bullishBoost: boolean;
    bearishOverride: boolean;
    shortTextPenalty: boolean;
  };
  modes: {
    allowMock: boolean;
    allowUrlAnalyzer: boolean;
  };
  updatedAt: string;
}

export interface SentimentRun {
  createdAt: string;
  mode: string;
  inputHash: string;
  inputPreview: string;
  output: {
    label: string;
    score: number;
    confidence: number;
    modelScore: number;
    rulesBoost: number;
  };
  meta: {
    modelVersion: string;
    qualityVersion: string;
    latencyMs: number;
    rulesApplied: string[];
    reasons: string[];
  };
}

export interface EvalReport {
  createdAt: string;
  datasetVersion: string;
  totalSamples: number;
  accuracy: number;
  confusionMatrix: {
    positive: { tp: number; fp: number; fn: number };
    neutral: { tp: number; fp: number; fn: number };
    negative: { tp: number; fp: number; fn: number };
  };
  modelContribution: number;
  rulesContribution: number;
  modelVersion: string;
  qualityVersion: string;
}

export interface SentimentStatus {
  engineMode: 'mock' | 'runtime';
  modelVersion: string;
  qualityVersion: string;
  uptimeSec: number;
  avgLatencyMs: number;
  requestsLastHour: number;
  storageEnabled: boolean;
  health: 'HEALTHY' | 'DEGRADED' | 'DISABLED';
}

// ============================================
// Default Config
// ============================================

const DEFAULT_CONFIG: SentimentConfig = {
  thresholds: {
    neutralLow: 0.45,
    neutralHigh: 0.55,
    strongSignal: 0.80,
    weakSignal: 0.55,
  },
  rules: {
    bullishBoost: true,
    bearishOverride: true,
    shortTextPenalty: true,
  },
  modes: {
    allowMock: true,
    allowUrlAnalyzer: true,
  },
  updatedAt: new Date().toISOString(),
};

// ============================================
// In-Memory State (for metrics without storage)
// ============================================

let startTime = Date.now();
let requestCount = 0;
let latencySum = 0;
let latencyCount = 0;

// In-memory storage (used when SENTIMENT_STORAGE_ENABLED=false)
let inMemoryConfig: SentimentConfig = { ...DEFAULT_CONFIG };
let inMemoryRuns: SentimentRun[] = [];
let inMemoryEvalReports: EvalReport[] = [];

// ============================================
// Config Service
// ============================================

export const ConfigService = {
  /**
   * Get current config
   */
  async getConfig(db: any | null): Promise<SentimentConfig> {
    if (db) {
      try {
        const doc = await db.collection('sentiment_settings').findOne({ _id: 'active' });
        if (doc) {
          const { _id, ...config } = doc;
          return config as SentimentConfig;
        }
      } catch (e) {
        console.error('[ConfigService] DB error:', e);
      }
    }
    return { ...inMemoryConfig };
  },

  /**
   * Update config (partial patch)
   */
  async patchConfig(db: any | null, patch: Partial<SentimentConfig>): Promise<SentimentConfig> {
    const current = await this.getConfig(db);
    
    // Deep merge
    const updated: SentimentConfig = {
      thresholds: { ...current.thresholds, ...patch.thresholds },
      rules: { ...current.rules, ...patch.rules },
      modes: { ...current.modes, ...patch.modes },
      updatedAt: new Date().toISOString(),
    };
    
    // Validate thresholds
    if (updated.thresholds.neutralLow < 0 || updated.thresholds.neutralLow > 1) {
      throw new Error('neutralLow must be between 0 and 1');
    }
    if (updated.thresholds.neutralHigh < 0 || updated.thresholds.neutralHigh > 1) {
      throw new Error('neutralHigh must be between 0 and 1');
    }
    if (updated.thresholds.neutralLow >= updated.thresholds.neutralHigh) {
      throw new Error('neutralLow must be less than neutralHigh');
    }
    if (updated.thresholds.strongSignal < 0.5 || updated.thresholds.strongSignal > 1) {
      throw new Error('strongSignal must be between 0.5 and 1');
    }
    if (updated.thresholds.weakSignal < 0 || updated.thresholds.weakSignal > 0.8) {
      throw new Error('weakSignal must be between 0 and 0.8');
    }
    
    // Save
    if (db) {
      try {
        await db.collection('sentiment_settings').updateOne(
          { _id: 'active' },
          { $set: updated },
          { upsert: true }
        );
      } catch (e) {
        console.error('[ConfigService] DB save error:', e);
      }
    }
    
    inMemoryConfig = updated;
    return updated;
  },
};

// ============================================
// Runs Logging Service
// ============================================

export const RunsLoggingService = {
  /**
   * Log a sentiment run
   */
  async logRun(db: any | null, run: SentimentRun): Promise<void> {
    // Always track in memory for metrics
    requestCount++;
    latencySum += run.meta.latencyMs;
    latencyCount++;
    
    // Store in DB if enabled
    if (db) {
      try {
        await db.collection('sentiment_runs').insertOne(run);
      } catch (e) {
        console.error('[RunsLoggingService] DB error:', e);
      }
    } else {
      // Keep last 100 in memory
      inMemoryRuns.unshift(run);
      if (inMemoryRuns.length > 100) {
        inMemoryRuns = inMemoryRuns.slice(0, 100);
      }
    }
  },

  /**
   * Get recent runs
   */
  async getRuns(db: any | null, limit: number = 50): Promise<SentimentRun[]> {
    if (db) {
      try {
        return await db.collection('sentiment_runs')
          .find({}, { projection: { _id: 0 } })
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
      } catch (e) {
        console.error('[RunsLoggingService] DB error:', e);
      }
    }
    return inMemoryRuns.slice(0, limit);
  },

  /**
   * Create input hash
   */
  hashInput(text: string): string {
    // Simple hash for demo (in production use crypto.createHash)
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  },

  /**
   * Create preview (clean and truncate)
   */
  createPreview(text: string, maxLen: number = 80): string {
    return text.replace(/[\r\n\t]+/g, ' ').trim().substring(0, maxLen);
  },
};

// ============================================
// Eval Harness Service
// ============================================

// Mock eval dataset
const EVAL_DATASET = [
  { text: 'Bitcoin is pumping hard! Moon incoming! 🚀', expected: 'POSITIVE' },
  { text: 'BTC looking extremely bullish, breaking resistance', expected: 'POSITIVE' },
  { text: 'Great news for crypto adoption!', expected: 'POSITIVE' },
  { text: 'Market rally continues, bulls in control', expected: 'POSITIVE' },
  { text: 'Massive dump incoming, sell now!', expected: 'NEGATIVE' },
  { text: 'Market crash, panic selling everywhere', expected: 'NEGATIVE' },
  { text: 'SEC delays ETF decision again', expected: 'NEGATIVE' },
  { text: 'Fear and uncertainty in the market', expected: 'NEGATIVE' },
  { text: 'BTC trading sideways today', expected: 'NEUTRAL' },
  { text: 'No significant price movement', expected: 'NEUTRAL' },
  { text: 'Market consolidating at current levels', expected: 'NEUTRAL' },
  { text: 'Waiting for next catalyst', expected: 'NEUTRAL' },
];

export const EvalHarnessService = {
  /**
   * Run evaluation against dataset
   */
  async runEval(
    db: any | null,
    analyzeFunc: (text: string) => Promise<{ label: string; score: number; meta?: any }>
  ): Promise<EvalReport> {
    const results: Array<{ expected: string; predicted: string; correct: boolean }> = [];
    let modelScoreSum = 0;
    let rulesBoostSum = 0;
    
    // Run predictions
    for (const sample of EVAL_DATASET) {
      try {
        const result = await analyzeFunc(sample.text);
        const correct = result.label === sample.expected;
        results.push({
          expected: sample.expected,
          predicted: result.label,
          correct,
        });
        
        if (result.meta) {
          modelScoreSum += result.meta.modelScore || 0;
          rulesBoostSum += Math.abs(result.meta.rulesBoost || 0);
        }
      } catch (e) {
        results.push({
          expected: sample.expected,
          predicted: 'ERROR',
          correct: false,
        });
      }
    }
    
    // Calculate metrics
    const accuracy = results.filter(r => r.correct).length / results.length;
    
    // Confusion matrix
    const cm = {
      positive: { tp: 0, fp: 0, fn: 0 },
      neutral: { tp: 0, fp: 0, fn: 0 },
      negative: { tp: 0, fp: 0, fn: 0 },
    };
    
    for (const r of results) {
      const expected = r.expected.toLowerCase() as keyof typeof cm;
      const predicted = r.predicted.toLowerCase() as keyof typeof cm;
      
      if (r.correct && cm[expected]) {
        cm[expected].tp++;
      } else {
        if (cm[expected]) cm[expected].fn++;
        if (cm[predicted]) cm[predicted].fp++;
      }
    }
    
    // Create report
    const report: EvalReport = {
      createdAt: new Date().toISOString(),
      datasetVersion: 'v1',
      totalSamples: results.length,
      accuracy: Math.round(accuracy * 100) / 100,
      confusionMatrix: cm,
      modelContribution: Math.round((modelScoreSum / results.length) * 100) / 100,
      rulesContribution: Math.round((rulesBoostSum / results.length) * 100) / 100,
      modelVersion: 'mock-v1.0',
      qualityVersion: 'S3',
    };
    
    // Save report
    if (db) {
      try {
        await db.collection('sentiment_eval_reports').insertOne(report);
      } catch (e) {
        console.error('[EvalHarnessService] DB error:', e);
      }
    } else {
      inMemoryEvalReports.unshift(report);
      if (inMemoryEvalReports.length > 20) {
        inMemoryEvalReports = inMemoryEvalReports.slice(0, 20);
      }
    }
    
    return report;
  },

  /**
   * Get eval reports
   */
  async getReports(db: any | null, limit: number = 20): Promise<EvalReport[]> {
    if (db) {
      try {
        return await db.collection('sentiment_eval_reports')
          .find({}, { projection: { _id: 0 } })
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
      } catch (e) {
        console.error('[EvalHarnessService] DB error:', e);
      }
    }
    return inMemoryEvalReports.slice(0, limit);
  },
};

// ============================================
// Status Service
// ============================================

export const StatusService = {
  /**
   * Get sentiment engine status
   */
  getStatus(isMockMode: boolean, storageEnabled: boolean): SentimentStatus {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
    
    // Determine health
    let health: 'HEALTHY' | 'DEGRADED' | 'DISABLED' = 'HEALTHY';
    if (avgLatencyMs > 500) health = 'DEGRADED';
    if (!isMockMode && avgLatencyMs > 2000) health = 'DISABLED';
    
    return {
      engineMode: isMockMode ? 'mock' : 'runtime',
      modelVersion: isMockMode ? 'mock-v1.0' : 'cnn_v1',
      qualityVersion: 'S3',
      uptimeSec,
      avgLatencyMs,
      requestsLastHour: requestCount,
      storageEnabled,
      health,
    };
  },

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    startTime = Date.now();
    requestCount = 0;
    latencySum = 0;
    latencyCount = 0;
  },
};
