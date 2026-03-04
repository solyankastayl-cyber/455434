/**
 * P2.2 Phase 1: Confidence Calibration - Type Definitions
 * 
 * These types are IMMUTABLE contracts.
 * Changes require architecture review.
 * 
 * Purpose: Lock down all inputs/outputs so formulas can't be "quietly" changed.
 */

// ═══════════════════════════════════════════════════════════════════════════
// INPUT TYPES - Raw Signals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw edge signal from the graph
 * Contains all factors needed for calibration
 */
export interface RawEdgeSignal {
  /** Source address */
  from: string;
  
  /** Destination address */
  to: string;
  
  /** Direction relative to analysis target */
  direction: 'IN' | 'OUT';
  
  /** Number of transactions */
  txCount: number;
  
  /** Total volume in USD */
  volumeUsd: number;
  
  /** Confidence from Route Intelligence (P0.5/P1.6) [0..1] */
  routeConfidence: number;
  
  /** Market context modifier from P1.6 [0..2] */
  marketModifier: number;
  
  /** Data quality score from P0.7 [0..1] */
  dataQuality: number;
  
  /** Actor reliability score [0..1] */
  actorReliability: number;
  
  /** Optional: timestamp for temporal analysis */
  timestamp?: number;
  
  /** Optional: route type for context */
  routeType?: string;
}

/**
 * Raw node signal from the graph
 * Used for node size calibration
 */
export interface RawNodeSignal {
  /** Node address/ID */
  id: string;
  
  /** Node type (CEX/DEX/Bridge/Wallet) */
  type: 'CEX' | 'DEX' | 'Bridge' | 'Wallet';
  
  /** Display label (if available) */
  label?: string;
  
  /** Total incoming volume USD */
  totalIncomingVolumeUsd: number;
  
  /** Total outgoing volume USD */
  totalOutgoingVolumeUsd: number;
  
  /** Number of unique connections */
  connectionCount: number;
  
  /** Historical reliability [0..1] */
  reliability: number;
}

/**
 * Raw graph snapshot (uncalibrated)
 */
export interface RawGraphSnapshot {
  /** List of raw edges */
  edges: RawEdgeSignal[];
  
  /** List of raw nodes */
  nodes: RawNodeSignal[];
  
  /** Optional metadata */
  metadata?: {
    address?: string;
    timeRange?: { start: number; end: number };
    source?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT TYPES - Calibrated Results
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calibrated edge with final weight and confidence
 * Ready for visualization
 */
export interface CalibratedEdge {
  /** Source address */
  from: string;
  
  /** Destination address */
  to: string;
  
  /** Direction */
  direction: 'IN' | 'OUT';
  
  /** CALIBRATED weight (final, normalized) */
  weight: number;
  
  /** Overall confidence [0..1] */
  confidence: number;
  
  /** Original transaction count (for reference) */
  rawTxCount?: number;
  
  /** Original volume (for reference) */
  rawVolumeUsd?: number;
  
  /** Edge ID for tracking */
  id?: string;
}

/**
 * Calibrated node with final size weight
 */
export interface CalibratedNode {
  /** Node address/ID */
  id: string;
  
  /** Node type */
  type: 'CEX' | 'DEX' | 'Bridge' | 'Wallet';
  
  /** Display label */
  label?: string;
  
  /** CALIBRATED size weight (for visual sizing) */
  sizeWeight: number;
  
  /** Node confidence (avg of edge confidences) [0..1] */
  confidence: number;
  
  /** Role clarity score [0..1] - how clearly defined is the role */
  roleScore: number;
  
  /** Metadata for UI */
  metadata?: {
    totalVolumeUsd?: number;
    connectionCount?: number;
  };
}

/**
 * Corridor - aggregated edges for visual bundling
 */
export interface Corridor {
  /** Unique corridor key */
  key: string;
  
  /** Aggregated weight (sum of edge weights) */
  weight: number;
  
  /** Weighted average confidence */
  confidence: number;
  
  /** Direction */
  direction: 'IN' | 'OUT';
  
  /** Node type pair */
  fromType: string;
  toType: string;
  
  /** IDs of edges that were aggregated */
  edgeIds: string[];
  
  /** Count of edges */
  edgeCount: number;
}

/**
 * Calibrated graph snapshot
 * This is what the UI receives
 */
export interface CalibratedGraphSnapshot {
  /** Calibrated edges */
  edges: CalibratedEdge[];
  
  /** Calibrated nodes */
  nodes: CalibratedNode[];
  
  /** Aggregated corridors for bundling */
  corridors: Corridor[];
  
  /** Calibration metadata (for debugging/audit) */
  calibrationMeta: CalibrationMetadata;
}

/**
 * Calibration metadata
 * Tracks parameters and version for reproducibility
 */
export interface CalibrationMetadata {
  /** When calibration was performed */
  timestamp: number;
  
  /** Calibration version */
  version: string;
  
  /** Parameters used */
  parameters: {
    /** Normalization strategy */
    normalizationStrategy: 'quantile' | 'minmax' | 'log';
    
    /** Weight range */
    weightRange: { min: number; max: number };
    
    /** Confidence threshold for filtering */
    confidenceThreshold?: number;
    
    /** Any other parameters */
    [key: string]: any;
  };
  
  /** Statistics for validation */
  stats?: {
    totalEdges: number;
    totalNodes: number;
    avgEdgeWeight: number;
    avgConfidence: number;
    topPercentileWeight: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERMEDIATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intermediate edge weight calculation result
 * Before normalization
 */
export interface EdgeWeightCalculation {
  /** Edge identifier */
  edgeId: string;
  
  /** Base flow weight (volume + tx count) */
  baseFlowWeight: number;
  
  /** Route confidence component */
  routeConfidence: number;
  
  /** Market modifier component */
  marketModifier: number;
  
  /** Data quality component */
  dataQuality: number;
  
  /** Actor reliability component */
  actorReliability: number;
  
  /** Final raw weight (before normalization) */
  rawWeight: number;
  
  /** Overall confidence [0..1] */
  confidence: number;
}

/**
 * Intermediate node weight calculation
 */
export interface NodeWeightCalculation {
  /** Node ID */
  nodeId: string;
  
  /** Sum of incoming edge weights */
  incomingWeight: number;
  
  /** Sum of outgoing edge weights */
  outgoingWeight: number;
  
  /** Type multiplier applied */
  typeMultiplier: number;
  
  /** Final raw weight (before normalization) */
  rawWeight: number;
  
  /** Average edge confidence */
  avgConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calibration configuration
 */
export interface CalibrationConfig {
  /** Normalization strategy */
  normalizationStrategy: 'quantile' | 'minmax' | 'log';
  
  /** Target weight range after normalization */
  weightRange: {
    min: number;
    max: number;
  };
  
  /** Node type multipliers */
  nodeTypeMultipliers: {
    CEX: number;
    DEX: number;
    Bridge: number;
    Wallet: number;
  };
  
  /** Minimum confidence to include edge */
  minConfidenceThreshold?: number;
  
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Default calibration configuration
 */
export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  normalizationStrategy: 'quantile',
  weightRange: {
    min: 0.1,
    max: 1.0,
  },
  nodeTypeMultipliers: {
    CEX: 1.5,      // CEX nodes are structurally important
    DEX: 1.2,      // DEX nodes have significance
    Bridge: 1.1,   // Bridges are notable
    Wallet: 1.0,   // Base case
  },
  minConfidenceThreshold: 0.01, // Very low bar - we want to see everything
  debug: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION & ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Calibration error
 */
export class CalibrationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'CalibrationError';
  }
}
