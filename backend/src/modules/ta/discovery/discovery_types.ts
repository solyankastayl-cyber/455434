/**
 * Phase AF: Pattern Discovery Types
 * 
 * Types for the pattern discovery engine that finds
 * repeating structures not in the TA textbook.
 */

// ═══════════════════════════════════════════════════════════════
// STRUCTURE PRIMITIVES
// ═══════════════════════════════════════════════════════════════

export type PivotType = 'HIGH' | 'LOW';

export type StructurePivot = {
  type: PivotType;
  price: number;
  index: number;
  timestamp?: number;
};

export type PriceSegment = {
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  direction: 'UP' | 'DOWN';
  magnitude: number;       // Price change %
  bars: number;            // Duration in bars
};

// ═══════════════════════════════════════════════════════════════
// STRUCTURE
// ═══════════════════════════════════════════════════════════════

export type MarketStructure = {
  pivots: StructurePivot[];
  segments: PriceSegment[];
  
  // Derived metrics
  metrics: {
    volatility: number;    // Average segment magnitude
    symmetry: number;      // How balanced up/down moves are
    rhythm: number;        // Regularity of timing
    complexity: number;    // Number of reversals
  };
};

// ═══════════════════════════════════════════════════════════════
// SHAPE EMBEDDING (Feature Vector)
// ═══════════════════════════════════════════════════════════════

export type ShapeEmbedding = {
  structureId: string;
  
  // Normalized features (0-1 scale)
  features: {
    // Price features
    totalMove: number;           // Total price change %
    maxDrawdown: number;         // Max adverse move
    maxRunup: number;            // Max favorable move
    
    // Shape features
    pivotCount: number;          // Number of pivot points
    symmetry: number;            // Up/down balance
    compression: number;         // How tight is consolidation
    
    // Time features
    duration: number;            // Total bars
    avgSegmentLength: number;    // Avg bars per segment
    
    // Volatility features
    volatilityRatio: number;     // Segment vol vs overall
    
    // Pattern features
    retracementDepth: number;    // How much does it pull back
    trendStrength: number;       // Overall direction bias
  };
  
  // Raw vector for clustering
  vector: number[];
};

// ═══════════════════════════════════════════════════════════════
// CLUSTER
// ═══════════════════════════════════════════════════════════════

export type DiscoveredCluster = {
  clusterId: string;
  
  // Members
  members: string[];            // structureIds
  memberCount: number;
  
  // Centroid (average features)
  centroid: number[];
  
  // Variance
  variance: number;             // How tight is the cluster
  
  // Label (auto-generated)
  label: string;                // e.g., "DISCOVERY_C12"
};

// ═══════════════════════════════════════════════════════════════
// DISCOVERED PATTERN
// ═══════════════════════════════════════════════════════════════

export type DiscoveredPattern = {
  patternId: string;
  
  // Source
  clusterId: string;
  
  // Metadata
  name: string;                 // Auto-generated name
  description: string;
  
  // Shape signature
  shape: {
    pivotCount: number;
    avgSymmetry: number;
    avgCompression: number;
    dominantDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  };
  
  // Statistics
  stats: {
    samples: number;
    winRate: number;
    avgReturn: number;
    avgMFE: number;
    avgMAE: number;
    avgBarsToOutcome: number;
  };
  
  // Validity
  validity: {
    minSamples: number;
    statisticalSignificance: number;  // p-value proxy
    isValid: boolean;
  };
  
  // Timestamps
  discoveredAt: Date;
  lastUpdated: Date;
};

// ═══════════════════════════════════════════════════════════════
// DISCOVERY SESSION
// ═══════════════════════════════════════════════════════════════

export type DiscoverySession = {
  sessionId: string;
  
  // Config
  config: {
    minStructureSize: number;    // Min pivots
    maxStructureSize: number;    // Max pivots
    lookbackBars: number;
    clusteringMethod: 'KMEANS' | 'DBSCAN' | 'HDBSCAN';
    minClusterSize: number;
  };
  
  // Results
  results: {
    structuresExtracted: number;
    clustersFound: number;
    patternsDiscovered: number;
    validPatterns: number;
  };
  
  // Timing
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
};

// ═══════════════════════════════════════════════════════════════
// DISCOVERY CONFIG
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_DISCOVERY_CONFIG = {
  minStructureSize: 4,
  maxStructureSize: 12,
  lookbackBars: 500,
  clusteringMethod: 'KMEANS' as const,
  minClusterSize: 10,
  zigzagThreshold: 0.02,         // 2% minimum move
  minSamplesForPattern: 15,
  significanceThreshold: 0.05,
};
