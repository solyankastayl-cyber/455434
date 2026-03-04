/**
 * Phase AF: Discovery Engine
 * 
 * Main orchestrator for pattern discovery.
 * Coordinates segment extraction, embedding, clustering, and validation.
 */

import { v4 as uuid } from 'uuid';
import { Db, Collection } from 'mongodb';
import {
  DiscoveredPattern,
  DiscoverySession,
  MarketStructure,
  ShapeEmbedding,
  DiscoveredCluster,
  DEFAULT_DISCOVERY_CONFIG,
} from './discovery_types.js';
import {
  Candle,
  buildMarketStructure,
  extractStructureWindows,
} from './segment_engine.js';
import { buildShapeEmbedding, extractShapeFeatures } from './shape_embedding.js';
import {
  runKMeansClustering,
  estimateOptimalK,
  ClusteringConfig,
} from './clustering.js';

const PATTERNS_COLLECTION = 'ta_discovered_patterns';
const SESSIONS_COLLECTION = 'ta_discovery_sessions';

// ═══════════════════════════════════════════════════════════════
// DISCOVERY ENGINE CLASS
// ═══════════════════════════════════════════════════════════════

export class DiscoveryEngine {
  private patternsCollection: Collection<DiscoveredPattern>;
  private sessionsCollection: Collection<DiscoverySession>;

  constructor(db: Db) {
    this.patternsCollection = db.collection(PATTERNS_COLLECTION);
    this.sessionsCollection = db.collection(SESSIONS_COLLECTION);
  }

  /**
   * Initialize collections and indexes
   */
  async initialize(): Promise<void> {
    await this.patternsCollection.createIndex({ patternId: 1 }, { unique: true });
    await this.patternsCollection.createIndex({ clusterId: 1 });
    await this.patternsCollection.createIndex({ 'stats.winRate': -1 });
    
    await this.sessionsCollection.createIndex({ sessionId: 1 }, { unique: true });
    await this.sessionsCollection.createIndex({ startedAt: -1 });
    
    console.log('[DiscoveryEngine] Indexes created');
  }

  /**
   * Run full discovery session
   */
  async runDiscovery(
    candles: Candle[],
    config: Partial<typeof DEFAULT_DISCOVERY_CONFIG> = {}
  ): Promise<DiscoverySession> {
    const fullConfig = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
    const sessionId = uuid();
    const startedAt = new Date();

    console.log(`[Discovery] Starting session ${sessionId} with ${candles.length} candles`);

    // Step 1: Build market structure
    const structure = buildMarketStructure(candles, fullConfig.zigzagThreshold);
    console.log(`[Discovery] Found ${structure.pivots.length} pivots`);

    // Step 2: Extract structure windows
    const windows = extractStructureWindows(
      structure.pivots,
      fullConfig.minStructureSize,
      fullConfig.maxStructureSize
    );
    console.log(`[Discovery] Extracted ${windows.length} structure windows`);

    // Step 3: Build embeddings
    const embeddings = windows.map(w => buildShapeEmbedding(w));
    console.log(`[Discovery] Built ${embeddings.length} embeddings`);

    // Step 4: Estimate optimal K
    const optimalK = estimateOptimalK(embeddings);
    console.log(`[Discovery] Estimated optimal K: ${optimalK}`);

    // Step 5: Run clustering
    const clusterConfig: ClusteringConfig = {
      k: optimalK,
      maxIterations: 100,
      minClusterSize: fullConfig.minClusterSize,
    };
    const clusters = runKMeansClustering(embeddings, clusterConfig);
    console.log(`[Discovery] Found ${clusters.length} clusters`);

    // Step 6: Validate and save patterns
    const patterns: DiscoveredPattern[] = [];
    for (const cluster of clusters) {
      const pattern = await this.validateAndSavePattern(cluster, embeddings, fullConfig);
      if (pattern) {
        patterns.push(pattern);
      }
    }

    // Save session
    const session: DiscoverySession = {
      sessionId,
      config: fullConfig,
      results: {
        structuresExtracted: windows.length,
        clustersFound: clusters.length,
        patternsDiscovered: patterns.length,
        validPatterns: patterns.filter(p => p.validity.isValid).length,
      },
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    };

    await this.sessionsCollection.insertOne(session);
    console.log(`[Discovery] Session ${sessionId} completed in ${session.durationMs}ms`);

    return session;
  }

  /**
   * Validate cluster and save as pattern
   */
  private async validateAndSavePattern(
    cluster: DiscoveredCluster,
    embeddings: ShapeEmbedding[],
    config: typeof DEFAULT_DISCOVERY_CONFIG
  ): Promise<DiscoveredPattern | null> {
    if (cluster.memberCount < config.minSamplesForPattern) {
      return null;
    }

    // Get member embeddings
    const memberEmbeddings = embeddings.filter(e => cluster.members.includes(e.structureId));
    
    // Calculate average features
    const avgFeatures = this.calculateAverageFeatures(memberEmbeddings);

    // Determine dominant direction
    let dominantDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    const avgTotalMove = avgFeatures.totalMove;
    if (avgTotalMove > 0.02) dominantDirection = 'UP';
    else if (avgTotalMove < -0.02) dominantDirection = 'DOWN';

    // Calculate statistical significance (simplified)
    const significance = Math.min(1, cluster.memberCount / 50) * (1 - cluster.variance);

    const pattern: DiscoveredPattern = {
      patternId: uuid(),
      clusterId: cluster.clusterId,
      name: cluster.label,
      description: this.generateDescription(avgFeatures, dominantDirection),
      shape: {
        pivotCount: Math.round(avgFeatures.pivotCount * 20),
        avgSymmetry: avgFeatures.symmetry,
        avgCompression: avgFeatures.compression,
        dominantDirection,
      },
      stats: {
        samples: cluster.memberCount,
        winRate: 0.5, // Will be updated after backtesting
        avgReturn: 0,
        avgMFE: avgFeatures.maxRunup * 100,
        avgMAE: avgFeatures.maxDrawdown * 100,
        avgBarsToOutcome: Math.round(avgFeatures.duration * 200),
      },
      validity: {
        minSamples: config.minSamplesForPattern,
        statisticalSignificance: significance,
        isValid: significance > config.significanceThreshold,
      },
      discoveredAt: new Date(),
      lastUpdated: new Date(),
    };

    await this.patternsCollection.insertOne(pattern);
    return pattern;
  }

  /**
   * Calculate average features from embeddings
   */
  private calculateAverageFeatures(embeddings: ShapeEmbedding[]): ShapeEmbedding['features'] {
    if (embeddings.length === 0) {
      return {
        totalMove: 0,
        maxDrawdown: 0,
        maxRunup: 0,
        pivotCount: 0,
        symmetry: 0,
        compression: 0,
        duration: 0,
        avgSegmentLength: 0,
        volatilityRatio: 0,
        retracementDepth: 0,
        trendStrength: 0,
      };
    }

    const avg: any = {};
    const keys = Object.keys(embeddings[0].features);
    
    for (const key of keys) {
      avg[key] = embeddings.reduce((sum, e) => sum + (e.features as any)[key], 0) / embeddings.length;
    }

    return avg;
  }

  /**
   * Generate pattern description
   */
  private generateDescription(features: ShapeEmbedding['features'], direction: string): string {
    const parts: string[] = [];

    if (features.compression > 0.7) {
      parts.push('tight consolidation');
    } else if (features.compression < 0.3) {
      parts.push('wide range');
    }

    if (features.symmetry > 0.7) {
      parts.push('balanced movement');
    } else if (features.symmetry < 0.3) {
      parts.push('asymmetric');
    }

    if (direction === 'UP') {
      parts.push('with bullish bias');
    } else if (direction === 'DOWN') {
      parts.push('with bearish bias');
    }

    if (features.retracementDepth > 0.5) {
      parts.push('deep pullbacks');
    }

    return `Discovered structure: ${parts.join(', ')}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // QUERY METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get all discovered patterns
   */
  async getPatterns(limit: number = 50): Promise<DiscoveredPattern[]> {
    return this.patternsCollection
      .find()
      .sort({ 'stats.samples': -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get valid patterns only
   */
  async getValidPatterns(): Promise<DiscoveredPattern[]> {
    return this.patternsCollection
      .find({ 'validity.isValid': true })
      .sort({ 'stats.winRate': -1 })
      .toArray();
  }

  /**
   * Get pattern by ID
   */
  async getPattern(patternId: string): Promise<DiscoveredPattern | null> {
    return this.patternsCollection.findOne({ patternId });
  }

  /**
   * Get all sessions
   */
  async getSessions(limit: number = 20): Promise<DiscoverySession[]> {
    return this.sessionsCollection
      .find()
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get latest session
   */
  async getLatestSession(): Promise<DiscoverySession | null> {
    const results = await this.sessionsCollection
      .find()
      .sort({ startedAt: -1 })
      .limit(1)
      .toArray();
    return results[0] || null;
  }

  /**
   * Get discovery stats
   */
  async getStats(): Promise<{
    totalPatterns: number;
    validPatterns: number;
    totalSessions: number;
    lastSessionAt: Date | null;
  }> {
    const totalPatterns = await this.patternsCollection.countDocuments();
    const validPatterns = await this.patternsCollection.countDocuments({ 'validity.isValid': true });
    const totalSessions = await this.sessionsCollection.countDocuments();
    const lastSession = await this.getLatestSession();

    return {
      totalPatterns,
      validPatterns,
      totalSessions,
      lastSessionAt: lastSession?.startedAt || null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let engineInstance: DiscoveryEngine | null = null;

export function initDiscoveryEngine(db: Db): DiscoveryEngine {
  engineInstance = new DiscoveryEngine(db);
  return engineInstance;
}

export function getDiscoveryEngine(): DiscoveryEngine | null {
  return engineInstance;
}
