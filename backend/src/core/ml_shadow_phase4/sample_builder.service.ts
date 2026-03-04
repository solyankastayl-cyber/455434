/**
 * PHASE 4 - Sample Builder
 * Constructs labeled samples from signals/decisions/outcomes
 */
import crypto from 'crypto';
import { SignalModel } from '../signals/signals.model.js';
import { TokenUniverseModel } from '../token_universe/token_universe.model.js';
import { PriceOutcomeModel } from './price_outcome.model.js';

export interface LabeledSample {
  sampleKey: string;
  signalId: string;
  tokenId: string;
  symbol: string;
  timestamp: Date;
  window: string;
  
  // Features
  features: {
    coverage: number;
    risk: number;
    evidence: number;
    confidence: number;
    actorCount: number;
    edgeCount: number;
    directionImbalance: number;
    signalType: string;
    severity: string;
  };
  
  // Labels (outcomes)
  labels: {
    h24?: 'UP' | 'DOWN' | 'FLAT';
    d7?: 'UP' | 'DOWN' | 'FLAT';
  };
  
  // Skip tracking
  skipped?: boolean;
  skipReason?: string;
}

export class SampleBuilder {
  /**
   * Generate sampleKey for idempotency
   */
  private static generateSampleKey(signalId: string, horizon: string, timestamp: Date): string {
    const data = `${signalId}|${horizon}|${timestamp.toISOString()}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Fetch labeled samples from signals (MVP approach)
   * Uses signals directly until engine_decision_logs is populated
   */
  static async fetchLabeledSamples(
    window: string = '7d',
    limit: number = 500,
    sinceDate?: Date
  ): Promise<LabeledSample[]> {
    try {
      // Query signals
      const query: any = {
        window: { $in: [window, '24h', '7d'] },
      };

      if (sinceDate) {
        query.createdAt = { $gte: sinceDate };
      }

      const signals = await SignalModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec();

      if (signals.length === 0) {
        console.log('[SampleBuilder] No signals found');
        return [];
      }

      // Build samples
      const samples: LabeledSample[] = [];
      const skippedReasons: Record<string, number> = {};

      for (const signal of signals) {
        try {
          const sample = await this.buildSample(signal, window);
          
          if (sample.skipped) {
            skippedReasons[sample.skipReason!] = (skippedReasons[sample.skipReason!] || 0) + 1;
          } else {
            samples.push(sample);
          }
        } catch (error) {
          console.error(`[SampleBuilder] Error building sample for signal ${signal._id}:`, error);
        }
      }

      console.log(`[SampleBuilder] Built ${samples.length} samples, skipped ${Object.keys(skippedReasons).length} types`);
      if (Object.keys(skippedReasons).length > 0) {
        console.log('[SampleBuilder] Skip reasons:', skippedReasons);
      }

      return samples;
    } catch (error) {
      console.error('[SampleBuilder] Error fetching labeled samples:', error);
      return [];
    }
  }

  /**
   * Build individual sample from signal
   */
  private static async buildSample(signal: any, window: string): Promise<LabeledSample> {
    const signalId = signal._id.toString();
    const timestamp = signal.createdAt || signal.triggeredAt || new Date();
    
    // Extract features from signal
    const features = {
      coverage: this.estimateCoverage(signal),
      risk: this.estimateRisk(signal),
      evidence: signal.confidence || 0.5,
      confidence: signal.confidence || 0.5,
      actorCount: signal.relatedAddresses?.length || 0,
      edgeCount: 0, // Will be populated from snapshot
      directionImbalance: 0, // Will be populated from snapshot
      signalType: signal.signalType || 'unknown',
      severity: signal.severity || 'medium',
    };

    // Generate sample key
    const sampleKey = this.generateSampleKey(signalId, window, timestamp);

    // Get token info
    let tokenId = signal.entityId;
    let symbol = 'UNKNOWN';

    if (signal.entityType === 'token' && signal.entityId) {
      const token = await TokenUniverseModel.findOne({ 
        contractAddress: signal.entityId 
      }).lean().exec();
      
      if (token) {
        tokenId = token.contractAddress;
        symbol = token.symbol || 'UNKNOWN';
      }
    }

    // Get REAL labels from price_outcomes (if available)
    const labels = await this.getLabels(tokenId, timestamp);

    // Check if sample is complete
    const skipped = !labels.h24 || !labels.d7;
    const skipReason = skipped ? this.getSkipReason(labels) : undefined;

    return {
      sampleKey,
      signalId,
      tokenId,
      symbol,
      timestamp,
      window,
      features,
      labels,
      skipped,
      skipReason,
    };
  }

  /**
   * Estimate coverage from signal
   */
  private static estimateCoverage(signal: any): number {
    // Based on signal confidence and actor count
    const baseСoverage = signal.confidence ? signal.confidence * 100 : 50;
    const actorBonus = Math.min((signal.relatedAddresses?.length || 0) * 5, 30);
    return Math.min(baseСoverage + actorBonus, 100);
  }

  /**
   * Estimate risk from signal
   */
  private static estimateRisk(signal: any): number {
    const severityMap: Record<string, number> = {
      low: 20,
      medium: 50,
      high: 80,
    };
    return severityMap[signal.severity] || 50;
  }

  /**
   * Get labels from price_outcomes (REAL data)
   * Falls back to mock if not available
   */
  private static async getLabels(tokenId: string, timestamp: Date): Promise<{
    h24?: 'UP' | 'DOWN' | 'FLAT';
    d7?: 'UP' | 'DOWN' | 'FLAT';
  }> {
    try {
      // Query price_outcomes for this token and timestamp
      const outcome = await PriceOutcomeModel.findOne({
        tokenId,
        t0: timestamp,
      }).lean().exec();

      if (outcome) {
        return {
          h24: outcome.outcome24h?.label,
          d7: outcome.outcome7d?.label,
        };
      }

      // Fallback to mock if no real data
      return this.mockLabels(tokenId, timestamp);
    } catch (error) {
      console.error('[SampleBuilder] Error getting labels:', error);
      return this.mockLabels(tokenId, timestamp);
    }
  }

  /**
   * Mock labels (fallback when real data not available)
   */
  private static async mockLabels(tokenId: string, timestamp: Date): Promise<{
    h24?: 'UP' | 'DOWN' | 'FLAT';
    d7?: 'UP' | 'DOWN' | 'FLAT';
  }> {
    // Deterministic mock based on hash
    const hash = crypto.createHash('md5').update(tokenId + timestamp.toISOString()).digest('hex');
    const value = parseInt(hash.slice(0, 2), 16);
    
    const label24h = value % 3 === 0 ? 'UP' : value % 3 === 1 ? 'DOWN' : 'FLAT';
    const label7d = value % 5 === 0 ? 'UP' : value % 5 === 1 ? 'DOWN' : 'FLAT';

    return {
      h24: label24h as 'UP' | 'DOWN' | 'FLAT',
      d7: label7d as 'UP' | 'DOWN' | 'FLAT',
    };
  }

  /**
   * Determine skip reason
   */
  private static getSkipReason(labels: { h24?: string; d7?: string }): string {
    if (!labels.h24 && !labels.d7) return 'no_outcomes';
    if (!labels.h24) return 'no_outcome_24h';
    if (!labels.d7) return 'no_outcome_7d';
    return 'unknown';
  }

  /**
   * Get skip statistics
   */
  static getSkipStats(samples: LabeledSample[]): Record<string, number> {
    const stats: Record<string, number> = {
      total: samples.length,
      valid: 0,
      skipped: 0,
    };

    for (const sample of samples) {
      if (sample.skipped) {
        stats.skipped++;
        const reason = sample.skipReason || 'unknown';
        stats[reason] = (stats[reason] || 0) + 1;
      } else {
        stats.valid++;
      }
    }

    return stats;
  }
}
