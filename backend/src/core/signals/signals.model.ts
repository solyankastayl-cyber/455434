/**
 * Signals MongoDB Model (L5 - Event Layer)
 * 
 * Built FROM bundles (L4)
 * Detects CHANGES in state, not state itself
 * 
 * Key concept:
 * - Bundle = state (accumulation, distribution, etc.)
 * - Signal = change event (when something changed)
 * 
 * Signal = moment when state changed
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Entity types that can emit signals
 */
export type SignalEntityType = 'address' | 'corridor' | 'asset';

/**
 * Signal types - what kind of change occurred
 */
export type SignalType =
  | 'accumulation_start'    // Started accumulating
  | 'accumulation_end'      // Stopped accumulating
  | 'distribution_start'    // Started distributing
  | 'distribution_end'      // Stopped distributing
  | 'wash_detected'         // Wash trading detected
  | 'wash_cleared'          // Wash trading stopped
  | 'rotation_shift'        // Rotation pattern changed
  | 'intensity_spike'       // Sudden intensity increase
  | 'intensity_drop'        // Sudden intensity decrease
  | 'bundle_change'         // General bundle type change
  | 'new_corridor'          // New corridor appeared
  | 'corridor_dormant';     // Corridor became inactive

/**
 * Severity levels
 */
export type SignalSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Signal Document Interface
 */
export interface ISignal extends Document {
  _id: Types.ObjectId;
  
  // Entity identification
  entityType: SignalEntityType;
  entityId: string;  // Address or corridor key (from:to)
  
  // Signal classification
  signalType: SignalType;
  
  // State change
  prevBundleType: string | null;
  newBundleType: string | null;
  prevIntensity: number | null;
  newIntensity: number | null;
  
  // Scores
  confidence: number;     // 0-1 confidence in the signal
  severityScore: number;  // 0-100 importance
  severity: SignalSeverity;
  
  // Context
  window: string;  // '1d' | '7d' | '30d'
  chain: string;
  
  // Timing
  triggeredAt: Date;
  
  // Human-readable explanation
  explanation: string;
  
  // Related entities
  relatedAddresses: string[];
  
  // Processing
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Signal Schema
 */
const SignalSchema = new Schema<ISignal>(
  {
    // Entity identification
    entityType: {
      type: String,
      enum: ['address', 'corridor', 'asset'],
      required: true,
      index: true,
    },
    entityId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Signal classification
    signalType: {
      type: String,
      enum: [
        'accumulation_start', 'accumulation_end',
        'distribution_start', 'distribution_end',
        'wash_detected', 'wash_cleared',
        'rotation_shift',
        'intensity_spike', 'intensity_drop',
        'bundle_change',
        'new_corridor', 'corridor_dormant'
      ],
      required: true,
      index: true,
    },
    
    // State change
    prevBundleType: {
      type: String,
      default: null,
    },
    newBundleType: {
      type: String,
      default: null,
    },
    prevIntensity: {
      type: Number,
      default: null,
    },
    newIntensity: {
      type: Number,
      default: null,
    },
    
    // Scores
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
    },
    severityScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
      index: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true,
      index: true,
    },
    
    // Context
    window: {
      type: String,
      required: true,
      index: true,
    },
    chain: {
      type: String,
      required: true,
      default: 'ethereum',
    },
    
    // Timing
    triggeredAt: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Explanation
    explanation: {
      type: String,
      required: true,
    },
    
    // Related entities
    relatedAddresses: {
      type: [String],
      default: [],
      index: true,
    },
    
    // Acknowledgment
    acknowledged: {
      type: Boolean,
      default: false,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'signals',
  }
);

// ========== INDEXES ==========

// For latest signals
SignalSchema.index({ triggeredAt: -1 });
SignalSchema.index({ triggeredAt: -1, signalType: 1 });

// For entity queries
SignalSchema.index({ entityType: 1, entityId: 1, triggeredAt: -1 });

// For severity filtering
SignalSchema.index({ severity: 1, triggeredAt: -1 });
SignalSchema.index({ severityScore: -1, triggeredAt: -1 });

// For unacknowledged signals
SignalSchema.index({ acknowledged: 1, triggeredAt: -1 });

// Prevent duplicate signals (same entity, type, window within short time)
SignalSchema.index(
  { entityId: 1, signalType: 1, window: 1, triggeredAt: 1 },
  { unique: false } // Allow multiple but use for dedup logic
);

export const SignalModel = mongoose.model<ISignal>('Signal', SignalSchema);

/**
 * Calculate severity from score
 */
export function getSeverityFromScore(score: number): SignalSeverity {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Calculate severity score based on signal type and metrics
 */
export function calculateSeverityScore(
  signalType: SignalType,
  confidence: number,
  intensityDelta: number = 0
): number {
  // Base scores by signal type
  const baseScores: Record<SignalType, number> = {
    'wash_detected': 85,
    'intensity_spike': 70,
    'accumulation_start': 65,
    'distribution_start': 65,
    'rotation_shift': 55,
    'bundle_change': 50,
    'intensity_drop': 45,
    'new_corridor': 40,
    'accumulation_end': 35,
    'distribution_end': 35,
    'wash_cleared': 30,
    'corridor_dormant': 25,
  };

  const base = baseScores[signalType] || 50;
  
  // Adjust by confidence
  const confidenceBoost = (confidence - 0.5) * 20; // -10 to +10
  
  // Adjust by intensity delta
  const intensityBoost = Math.min(15, Math.abs(intensityDelta) * 5);
  
  return Math.max(0, Math.min(100, base + confidenceBoost + intensityBoost));
}

/**
 * Generate explanation text
 */
export function generateExplanation(
  signalType: SignalType,
  entityType: SignalEntityType,
  prevBundleType: string | null,
  newBundleType: string | null,
  confidence: number
): string {
  const confPct = Math.round(confidence * 100);
  
  const explanations: Record<SignalType, string> = {
    'accumulation_start': `Accumulation pattern started (${confPct}% confidence). ${entityType === 'corridor' ? 'Corridor' : 'Address'} is now receiving more than sending.`,
    'accumulation_end': `Accumulation pattern ended. Previously accumulating, now ${newBundleType || 'unknown'}.`,
    'distribution_start': `Distribution pattern started (${confPct}% confidence). ${entityType === 'corridor' ? 'Corridor' : 'Address'} is now sending more than receiving.`,
    'distribution_end': `Distribution pattern ended. Previously distributing, now ${newBundleType || 'unknown'}.`,
    'wash_detected': `⚠️ Wash trading pattern detected (${confPct}% confidence). Symmetric volume with short time lag - potentially suspicious activity.`,
    'wash_cleared': `Wash trading pattern no longer detected. Activity appears normalized.`,
    'rotation_shift': `Rotation pattern shift detected. Cyclic movement pattern has changed.`,
    'intensity_spike': `Intensity spike detected (${confPct}% confidence). Sudden increase in activity volume/frequency.`,
    'intensity_drop': `Intensity drop detected. Significant decrease in activity.`,
    'bundle_change': `Bundle type changed from ${prevBundleType || 'unknown'} to ${newBundleType || 'unknown'} (${confPct}% confidence).`,
    'new_corridor': `New corridor established. First significant activity detected between addresses.`,
    'corridor_dormant': `Corridor became dormant. No recent activity detected.`,
  };

  return explanations[signalType] || `Signal: ${signalType}`;
}
