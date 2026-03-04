/**
 * PATTERN CLUSTERING SERVICE
 * ===========================
 * 
 * DBSCAN clustering for grouping altcoins by similar technical patterns.
 */

import type {
  IndicatorVector,
  PatternCluster,
  PatternSignature,
  ClusterMembership,
  Venue,
  Timeframe,
} from '../types.js';
import {
  ALT_FEATURE_KEYS,
  DBSCAN_EPS,
  DBSCAN_MIN_PTS,
} from '../constants.js';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ClusteringConfig {
  eps: number;           // DBSCAN epsilon (max distance)
  minPts: number;        // DBSCAN min points per cluster
  featureKeys: readonly string[];
  normalizeFeatures: boolean;
}

export interface ClusteringResult {
  clusters: PatternCluster[];
  memberships: ClusterMembership[];
  noise: string[];       // Symbols not assigned to any cluster
  stats: {
    totalVectors: number;
    clusteredCount: number;
    noiseCount: number;
    clusterCount: number;
    avgClusterSize: number;
    avgDispersion: number;
    durationMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// PATTERN CLUSTERING SERVICE
// ═══════════════════════════════════════════════════════════════

export class PatternClusteringService {
  private config: ClusteringConfig;

  constructor(config?: Partial<ClusteringConfig>) {
    this.config = {
      eps: DBSCAN_EPS,
      minPts: DBSCAN_MIN_PTS,
      featureKeys: ALT_FEATURE_KEYS,
      normalizeFeatures: true,
      ...config,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN CLUSTERING METHOD
  // ═══════════════════════════════════════════════════════════════

  cluster(
    vectors: IndicatorVector[],
    venue: Venue,
    timeframe: Timeframe
  ): ClusteringResult {
    const startTime = Date.now();
    
    if (vectors.length < this.config.minPts) {
      return this.emptyResult(startTime);
    }

    // Extract feature matrix
    const { matrix, symbols, featureStats } = this.extractFeatureMatrix(vectors);

    // Normalize if configured
    const normalizedMatrix = this.config.normalizeFeatures
      ? this.normalizeMatrix(matrix, featureStats)
      : matrix;

    // Run DBSCAN
    const labels = this.dbscan(normalizedMatrix);

    // Build clusters
    const { clusters, memberships, noise } = this.buildClusters(
      vectors,
      symbols,
      labels,
      normalizedMatrix,
      venue,
      timeframe
    );

    // Calculate stats
    const clusteredCount = vectors.length - noise.length;
    const avgClusterSize = clusters.length > 0
      ? clusteredCount / clusters.length
      : 0;
    const avgDispersion = clusters.length > 0
      ? clusters.reduce((sum, c) => sum + c.dispersion, 0) / clusters.length
      : 0;

    return {
      clusters,
      memberships,
      noise,
      stats: {
        totalVectors: vectors.length,
        clusteredCount,
        noiseCount: noise.length,
        clusterCount: clusters.length,
        avgClusterSize,
        avgDispersion,
        durationMs: Date.now() - startTime,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FEATURE EXTRACTION
  // ═══════════════════════════════════════════════════════════════

  private extractFeatureMatrix(vectors: IndicatorVector[]): {
    matrix: number[][];
    symbols: string[];
    featureStats: { means: number[]; stds: number[] };
  } {
    const matrix: number[][] = [];
    const symbols: string[] = [];

    for (const vector of vectors) {
      const features: number[] = [];
      
      for (const key of this.config.featureKeys) {
        const value = this.getFeatureValue(vector, key);
        features.push(value);
      }
      
      matrix.push(features);
      symbols.push(vector.symbol);
    }

    // Calculate feature statistics
    const means: number[] = [];
    const stds: number[] = [];

    for (let j = 0; j < this.config.featureKeys.length; j++) {
      const column = matrix.map(row => row[j]);
      const mean = column.reduce((a, b) => a + b, 0) / column.length;
      const std = Math.sqrt(
        column.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / column.length
      ) || 1;
      
      means.push(mean);
      stds.push(std);
    }

    return { matrix, symbols, featureStats: { means, stds } };
  }

  private getFeatureValue(vector: IndicatorVector, key: string): number {
    switch (key) {
      case 'rsi_z': return vector.rsi_z ?? 0;
      case 'momentum_1h': return vector.momentum_1h ?? 0;
      case 'momentum_4h': return vector.momentum_4h ?? 0;
      case 'volatility_z': return vector.volatility_z ?? 0;
      case 'funding_z': return vector.funding_z ?? 0;
      case 'oi_z': return vector.oi_z ?? 0;
      case 'long_bias': return vector.long_bias ?? 0;
      case 'liq_z': return vector.liq_z ?? 0;
      case 'trend_score': return vector.trend_score ?? 0;
      case 'breakout_score': return vector.breakout_score ?? 0;
      case 'meanrev_score': return vector.meanrev_score ?? 0;
      case 'squeeze_score': return vector.squeeze_score ?? 0;
      default: return 0;
    }
  }

  private normalizeMatrix(
    matrix: number[][],
    stats: { means: number[]; stds: number[] }
  ): number[][] {
    return matrix.map(row =>
      row.map((value, j) => (value - stats.means[j]) / stats.stds[j])
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // DBSCAN ALGORITHM
  // ═══════════════════════════════════════════════════════════════

  private dbscan(matrix: number[][]): number[] {
    const n = matrix.length;
    const labels = new Array(n).fill(-1); // -1 = unvisited/noise
    let clusterId = 0;

    for (let i = 0; i < n; i++) {
      if (labels[i] !== -1) continue; // Already processed

      const neighbors = this.regionQuery(matrix, i);

      if (neighbors.length < this.config.minPts) {
        labels[i] = 0; // Mark as noise (cluster 0)
      } else {
        clusterId++;
        this.expandCluster(matrix, labels, i, neighbors, clusterId);
      }
    }

    return labels;
  }

  private regionQuery(matrix: number[][], pointIdx: number): number[] {
    const neighbors: number[] = [];
    const point = matrix[pointIdx];

    for (let i = 0; i < matrix.length; i++) {
      if (this.euclideanDistance(point, matrix[i]) <= this.config.eps) {
        neighbors.push(i);
      }
    }

    return neighbors;
  }

  private expandCluster(
    matrix: number[][],
    labels: number[],
    pointIdx: number,
    neighbors: number[],
    clusterId: number
  ): void {
    labels[pointIdx] = clusterId;
    const queue = [...neighbors];
    const visited = new Set<number>([pointIdx]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      
      if (visited.has(current)) continue;
      visited.add(current);

      if (labels[current] === 0) {
        // Was noise, now border point
        labels[current] = clusterId;
      }

      if (labels[current] !== -1) continue;

      labels[current] = clusterId;

      const newNeighbors = this.regionQuery(matrix, current);
      if (newNeighbors.length >= this.config.minPts) {
        for (const neighbor of newNeighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD CLUSTERS
  // ═══════════════════════════════════════════════════════════════

  private buildClusters(
    _vectors: IndicatorVector[],
    symbols: string[],
    labels: number[],
    normalizedMatrix: number[][],
    venue: Venue,
    timeframe: Timeframe
  ): {
    clusters: PatternCluster[];
    memberships: ClusterMembership[];
    noise: string[];
  } {
    const clusters: PatternCluster[] = [];
    const memberships: ClusterMembership[] = [];
    const noise: string[] = [];

    // Group by cluster
    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (label === 0) {
        noise.push(symbols[i]);
        continue;
      }
      
      if (!clusterMap.has(label)) {
        clusterMap.set(label, []);
      }
      clusterMap.get(label)!.push(i);
    }

    const now = Date.now();

    // Build each cluster
    for (const [clusterId, memberIndices] of clusterMap) {
      const clusterSymbols = memberIndices.map(i => symbols[i]);
      const clusterVectors = memberIndices.map(i => normalizedMatrix[i]);

      // Calculate centroid
      const centroid = this.calculateCentroid(clusterVectors);

      // Calculate dispersion (avg distance to centroid)
      const distances = clusterVectors.map(v => this.euclideanDistance(v, centroid));
      const avgDispersion = distances.reduce((a, b) => a + b, 0) / distances.length;

      // Build signature
      const signature = this.buildSignature(centroid);

      // Top features
      const topFeatures = this.getTopFeatures(centroid);

      // Infer label
      const label = this.inferClusterLabel(centroid, topFeatures);

      const cluster: PatternCluster = {
        clusterId: `${venue}-${timeframe}-${clusterId}-${uuidv4().slice(0, 8)}`,
        ts: now,
        venue,
        tf: timeframe,
        signature,
        centroid: this.centroidToRecord(centroid),
        topFeatures,
        members: clusterSymbols,
        size: clusterSymbols.length,
        dispersion: avgDispersion,
        label,
      };

      clusters.push(cluster);

      // Build memberships
      for (let i = 0; i < memberIndices.length; i++) {
        const idx = memberIndices[i];
        const distance = distances[i];
        
        memberships.push({
          symbol: symbols[idx],
          clusterId: cluster.clusterId,
          ts: now,
          venue,
          tf: timeframe,
          distance,
          similarity: Math.max(0, 1 - distance / (this.config.eps * 2)),
        });
      }
    }

    // Sort clusters by size
    clusters.sort((a, b) => b.size - a.size);

    return { clusters, memberships, noise };
  }

  private calculateCentroid(vectors: number[][]): number[] {
    const dim = vectors[0].length;
    const centroid = new Array(dim).fill(0);

    for (const v of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += v[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length;
    }

    return centroid;
  }

  private buildSignature(centroid: number[]): PatternSignature {
    const bins: Record<string, string | number> = {};

    for (let i = 0; i < this.config.featureKeys.length; i++) {
      const key = this.config.featureKeys[i];
      const value = centroid[i];

      // Discretize into bins
      let bin: string;
      if (value < -1.5) bin = 'VERY_LOW';
      else if (value < -0.5) bin = 'LOW';
      else if (value < 0.5) bin = 'NEUTRAL';
      else if (value < 1.5) bin = 'HIGH';
      else bin = 'VERY_HIGH';

      bins[key] = bin;
    }

    // Create hash key from bins
    const key = Object.entries(bins)
      .map(([k, v]) => `${k}:${v}`)
      .join('|');

    return { key, bins };
  }

  private getTopFeatures(centroid: number[]): Array<{ k: string; v: number }> {
    const features: Array<{ k: string; v: number; absV: number }> = [];

    for (let i = 0; i < this.config.featureKeys.length; i++) {
      features.push({
        k: this.config.featureKeys[i] as string,
        v: centroid[i],
        absV: Math.abs(centroid[i]),
      });
    }

    // Sort by absolute value and take top 5
    return features
      .sort((a, b) => b.absV - a.absV)
      .slice(0, 5)
      .map(({ k, v }) => ({ k, v: Math.round(v * 100) / 100 }));
  }

  private centroidToRecord(centroid: number[]): Record<string, number> {
    const record: Record<string, number> = {};
    for (let i = 0; i < this.config.featureKeys.length; i++) {
      record[this.config.featureKeys[i] as string] = Math.round(centroid[i] * 1000) / 1000;
    }
    return record;
  }

  private inferClusterLabel(
    centroid: number[],
    _topFeatures: Array<{ k: string; v: number }>
  ): string {
    const featureMap = new Map<string, number>();
    for (let i = 0; i < this.config.featureKeys.length; i++) {
      featureMap.set(this.config.featureKeys[i] as string, centroid[i]);
    }

    const rsiZ = featureMap.get('rsi_z') ?? 0;
    const fundingZ = featureMap.get('funding_z') ?? 0;
    const squeezeScore = featureMap.get('squeeze_score') ?? 0;
    const breakoutScore = featureMap.get('breakout_score') ?? 0;
    const meanrevScore = featureMap.get('meanrev_score') ?? 0;
    const momentum = featureMap.get('momentum_1h') ?? 0;
    const trendScore = featureMap.get('trend_score') ?? 0;
    const oiZ = featureMap.get('oi_z') ?? 0;

    // Infer label based on dominant characteristics
    if (rsiZ < -1.5 && meanrevScore > 0.5) return 'OVERSOLD_BOUNCE';
    if (rsiZ > 1.5 && meanrevScore > 0.5) return 'OVERBOUGHT_REVERSAL';
    if (squeezeScore > 0.5) return 'VOLATILITY_SQUEEZE';
    if (breakoutScore > 0.8 && momentum > 0) return 'BULLISH_BREAKOUT';
    if (breakoutScore < 0.2 && momentum < 0) return 'BEARISH_BREAKDOWN';
    if (fundingZ < -1.5 && trendScore > 0) return 'FUNDING_FLIP_LONG';
    if (fundingZ > 1.5 && trendScore < 0) return 'FUNDING_FLIP_SHORT';
    if (oiZ > 1.5 && Math.abs(momentum) > 0.5) return 'OI_SURGE';
    if (trendScore > 0.5) return 'STRONG_UPTREND';
    if (trendScore < -0.5) return 'STRONG_DOWNTREND';
    if (Math.abs(momentum) < 0.3) return 'CONSOLIDATION';

    return 'MIXED_PATTERN';
  }

  private emptyResult(startTime: number): ClusteringResult {
    return {
      clusters: [],
      memberships: [],
      noise: [],
      stats: {
        totalVectors: 0,
        clusteredCount: 0,
        noiseCount: 0,
        clusterCount: 0,
        avgClusterSize: 0,
        avgDispersion: 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  updateConfig(config: Partial<ClusteringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ClusteringConfig {
    return { ...this.config };
  }
}

// Singleton instance
export const patternClusteringService = new PatternClusteringService();

console.log('[ExchangeAlt] Pattern Clustering Service loaded');
