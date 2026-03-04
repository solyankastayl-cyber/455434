/**
 * Real ML Shadow Client — ML1
 * ============================
 * 
 * ПРИНЦИП:
 * - REAL ML НИЧЕГО НЕ РЕШАЕТ
 * - REAL ML НИКУДА НЕ ПОДСТАВЛЯЕТСЯ  
 * - REAL ML ТОЛЬКО СЧИТАЕТ И ЛОГИРУЕТ
 * - MOCK / RULES — остаются ACTIVE PIPELINE
 * 
 * Shadow Mode = реальная нейронка считает параллельно,
 * но её результат НИ НА ЧТО НЕ ВЛИЯЕТ.
 */

import axios, { AxiosInstance } from 'axios';

// ============================================================
// Config
// ============================================================

const REAL_ML_URL = process.env.SENTIMENT_URL || 'http://127.0.0.1:8015';
const REAL_ML_TIMEOUT = parseInt(process.env.SENTIMENT_REAL_TIMEOUT || '5000');

const FLAGS = {
  REAL_ENABLED: process.env.SENTIMENT_REAL_ENABLED === 'true',
  REAL_SHADOW: process.env.SENTIMENT_REAL_SHADOW === 'true',
};

// ============================================================
// Types
// ============================================================

export interface RealMLResult {
  label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  score: number;
  confidence: number;
  modelVersion: string;
  latencyMs: number;
  error?: string;
}

export interface ShadowComparisonEvent {
  type: 'sentiment_shadow';
  inputHash: string;
  textLength: number;
  mock: {
    label: string;
    score: number;
    confidence: number;
  };
  real: {
    label: string;
    score: number;
    confidence: number;
  } | null;
  delta: {
    labelMismatch: boolean;
    scoreDiff: number;
    confidenceDiff: number;
  } | null;
  latency: {
    mock: number;
    real: number;
  };
  timestamp: string;
  error?: string;
}

// ============================================================
// Shadow Stats (in-memory)
// ============================================================

interface ShadowStats {
  totalComparisons: number;
  labelMatches: number;
  labelMismatches: number;
  totalScoreDiff: number;
  totalConfidenceDiff: number;
  realErrors: number;
  avgRealLatency: number;
  lastUpdate: Date;
  recentMismatches: Array<{
    text: string;
    mockLabel: string;
    realLabel: string;
    timestamp: Date;
  }>;
}

const shadowStats: ShadowStats = {
  totalComparisons: 0,
  labelMatches: 0,
  labelMismatches: 0,
  totalScoreDiff: 0,
  totalConfidenceDiff: 0,
  realErrors: 0,
  avgRealLatency: 0,
  lastUpdate: new Date(),
  recentMismatches: [],
};

// ============================================================
// Shadow Log Storage (in-memory ring buffer)
// ============================================================

const MAX_LOG_SIZE = 1000;
const shadowLog: ShadowComparisonEvent[] = [];

function addToShadowLog(event: ShadowComparisonEvent) {
  shadowLog.push(event);
  if (shadowLog.length > MAX_LOG_SIZE) {
    shadowLog.shift();
  }
}

// ============================================================
// Real ML Client
// ============================================================

class RealMLShadowClient {
  private client: AxiosInstance;
  private enabled: boolean;
  
  constructor() {
    this.enabled = FLAGS.REAL_SHADOW && !FLAGS.REAL_ENABLED;
    
    this.client = axios.create({
      baseURL: REAL_ML_URL,
      timeout: REAL_ML_TIMEOUT,
      headers: { 'Content-Type': 'application/json' },
    });
    
    console.log(`[ML1 Shadow] Initialized: enabled=${this.enabled}, url=${REAL_ML_URL}`);
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    console.log(`[ML1 Shadow] ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  /**
   * Call REAL ML runtime (without affecting anything)
   */
  async predict(text: string): Promise<RealMLResult | null> {
    if (!this.enabled) {
      return null;
    }
    
    const startTime = Date.now();
    
    try {
      const response = await this.client.post('/predict', { text });
      const latencyMs = Date.now() - startTime;
      
      const data = response.data;
      
      return {
        label: data.label || 'NEUTRAL',
        score: data.score || 0.5,
        // CNN returns confidence as string level, need to map or use score
        confidence: typeof data.confidence === 'number' 
          ? data.confidence 
          : (data.meta?.confidenceScore || this.scoreToConfidence(data.score || 0.5)),
        modelVersion: data.meta?.modelVersion || data.modelVersion || 'unknown',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      
      console.error(`[ML1 Shadow] Real ML error: ${error.message}`);
      shadowStats.realErrors++;
      
      return {
        label: 'NEUTRAL',
        score: 0.5,
        confidence: 0,
        modelVersion: 'error',
        latencyMs,
        error: error.message,
      };
    }
  }
  
  /**
   * Compare mock result with real ML (SHADOW MODE)
   * Returns the comparison event for logging
   */
  async shadowCompare(
    text: string,
    mockResult: { label: string; score: number; confidence: number },
    mockLatencyMs: number = 0
  ): Promise<ShadowComparisonEvent> {
    const startTime = Date.now();
    const realResult = await this.predict(text);
    const realLatencyMs = realResult?.latencyMs || (Date.now() - startTime);
    
    // Create comparison event
    const event: ShadowComparisonEvent = {
      type: 'sentiment_shadow',
      inputHash: this.hashText(text),
      textLength: text.length,
      mock: {
        label: mockResult.label,
        score: mockResult.score,
        confidence: mockResult.confidence,
      },
      real: realResult && !realResult.error ? {
        label: realResult.label,
        score: realResult.score,
        confidence: realResult.confidence,
      } : null,
      delta: null,
      latency: {
        mock: mockLatencyMs,
        real: realLatencyMs,
      },
      timestamp: new Date().toISOString(),
    };
    
    // Calculate delta if real result exists
    if (event.real) {
      const labelMismatch = event.mock.label !== event.real.label;
      const scoreDiff = Math.abs(event.mock.score - event.real.score);
      const confidenceDiff = Math.abs(event.mock.confidence - event.real.confidence);
      
      event.delta = {
        labelMismatch,
        scoreDiff: Math.round(scoreDiff * 1000) / 1000,
        confidenceDiff: Math.round(confidenceDiff * 1000) / 1000,
      };
      
      // Update stats
      shadowStats.totalComparisons++;
      if (labelMismatch) {
        shadowStats.labelMismatches++;
        // Track recent mismatches
        shadowStats.recentMismatches.push({
          text: text.substring(0, 100),
          mockLabel: event.mock.label,
          realLabel: event.real.label,
          timestamp: new Date(),
        });
        if (shadowStats.recentMismatches.length > 20) {
          shadowStats.recentMismatches.shift();
        }
      } else {
        shadowStats.labelMatches++;
      }
      shadowStats.totalScoreDiff += scoreDiff;
      shadowStats.totalConfidenceDiff += confidenceDiff;
      shadowStats.avgRealLatency = 
        (shadowStats.avgRealLatency * (shadowStats.totalComparisons - 1) + realLatencyMs) / 
        shadowStats.totalComparisons;
      shadowStats.lastUpdate = new Date();
    } else if (realResult?.error) {
      event.error = realResult.error;
    }
    
    // Log the event
    addToShadowLog(event);
    
    // Console log for important events
    if (event.delta?.labelMismatch) {
      console.log(`[ML1 Shadow] MISMATCH: mock=${event.mock.label}, real=${event.real?.label}, text="${text.substring(0, 50)}..."`);
    }
    
    return event;
  }
  
  private hashText(text: string): string {
    // Simple hash for deduplication
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
  
  /**
   * Convert score to confidence (for CNN which returns score but not numeric confidence)
   * For POSITIVE (score > 0.5): confidence = how far from neutral (0.5)
   * For NEGATIVE (score < 0.5): confidence = how far from neutral (0.5)
   * 
   * Adjusted formula to give higher confidence for clearer signals
   */
  private scoreToConfidence(score: number): number {
    // Score 0.5 = 0% confidence (neutral)
    // Score 0.65+ = high confidence POSITIVE
    // Score 0.35- = high confidence NEGATIVE
    
    const distance = Math.abs(score - 0.5);
    // Scale: 0.15 distance (score 0.65 or 0.35) = 100% confidence
    const confidence = Math.min(1, distance / 0.15);
    return Math.round(confidence * 1000) / 1000;
  }
  
  /**
   * Get shadow stats
   */
  getStats(): {
    enabled: boolean;
    stats: ShadowStats;
    metrics: {
      labelMatchRate: number;
      avgScoreDiff: number;
      avgConfidenceDiff: number;
      avgLatencyMs: number;
      errorRate: number;
    };
  } {
    const total = shadowStats.totalComparisons;
    
    return {
      enabled: this.enabled,
      stats: { ...shadowStats },
      metrics: {
        labelMatchRate: total > 0 ? shadowStats.labelMatches / total : 0,
        avgScoreDiff: total > 0 ? shadowStats.totalScoreDiff / total : 0,
        avgConfidenceDiff: total > 0 ? shadowStats.totalConfidenceDiff / total : 0,
        avgLatencyMs: shadowStats.avgRealLatency,
        errorRate: total > 0 ? shadowStats.realErrors / total : 0,
      },
    };
  }
  
  /**
   * Get recent log entries
   */
  getLog(limit: number = 50): ShadowComparisonEvent[] {
    return shadowLog.slice(-limit);
  }
  
  /**
   * Reset stats (admin only)
   */
  resetStats() {
    shadowStats.totalComparisons = 0;
    shadowStats.labelMatches = 0;
    shadowStats.labelMismatches = 0;
    shadowStats.totalScoreDiff = 0;
    shadowStats.totalConfidenceDiff = 0;
    shadowStats.realErrors = 0;
    shadowStats.avgRealLatency = 0;
    shadowStats.lastUpdate = new Date();
    shadowStats.recentMismatches = [];
    shadowLog.length = 0;
    console.log('[ML1 Shadow] Stats reset');
  }
}

// Singleton
export const realMLShadowClient = new RealMLShadowClient();

export default realMLShadowClient;
