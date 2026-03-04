/**
 * Strategy Timeline MongoDB Model (L10.2 - Timelines)
 * 
 * Shows evolution of strategy over time.
 * Human-readable explanations of WHY strategy changed.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Timeline event types
 */
export type StrategyTimelineEventType =
  | 'strategy_detected'
  | 'strategy_confirmed'
  | 'strategy_shift'
  | 'phase_change'
  | 'confidence_change'
  | 'stability_change';

/**
 * Strategy Timeline Event Document
 */
export interface IStrategyTimelineEvent extends Document {
  _id: Types.ObjectId;
  
  address: string;
  chain: string;
  
  eventType: StrategyTimelineEventType;
  timestamp: Date;
  
  // Strategy state at this point
  strategy: string;
  phase?: string;  // accumulation | distribution | rotation
  confidence: number;
  stability: number;
  
  // Change details
  previousStrategy?: string;
  previousConfidence?: number;
  previousStability?: number;
  
  // Human-readable explanation
  reason: string;
  
  // Source reference
  sourceType?: string;  // bundle | signal | score
  sourceId?: string;
  
  createdAt: Date;
}

const StrategyTimelineEventSchema = new Schema<IStrategyTimelineEvent>(
  {
    address: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    chain: {
      type: String,
      default: 'ethereum',
    },
    eventType: {
      type: String,
      enum: [
        'strategy_detected',
        'strategy_confirmed',
        'strategy_shift',
        'phase_change',
        'confidence_change',
        'stability_change',
      ],
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    strategy: {
      type: String,
      required: true,
    },
    phase: {
      type: String,
    },
    confidence: {
      type: Number,
      required: true,
    },
    stability: {
      type: Number,
      required: true,
    },
    previousStrategy: String,
    previousConfidence: Number,
    previousStability: Number,
    reason: {
      type: String,
      required: true,
    },
    sourceType: String,
    sourceId: String,
  },
  {
    timestamps: true,
    collection: 'strategy_timeline',
  }
);

// Indexes
StrategyTimelineEventSchema.index({ address: 1, timestamp: -1 });
StrategyTimelineEventSchema.index({ address: 1, eventType: 1, timestamp: -1 });

export const StrategyTimelineModel = mongoose.model<IStrategyTimelineEvent>(
  'StrategyTimelineEvent',
  StrategyTimelineEventSchema
);

/**
 * Generate human-readable reason for timeline event
 */
export function generateTimelineReason(
  eventType: StrategyTimelineEventType,
  strategy: string,
  previousStrategy?: string,
  confidence?: number,
  stability?: number,
  additionalContext?: string
): string {
  const strategyName = strategy.replace(/_/g, ' ');
  const prevName = previousStrategy?.replace(/_/g, ' ');
  const confPct = confidence ? Math.round(confidence * 100) : 0;
  const stabPct = stability ? Math.round(stability * 100) : 0;
  
  switch (eventType) {
    case 'strategy_detected':
      return `Strategy identified as ${strategyName} with ${confPct}% confidence. ${additionalContext || 'Initial pattern recognition based on transfer behavior.'}`;
    
    case 'strategy_confirmed':
      return `${strategyName} strategy confirmed with ${stabPct}% stability. Pattern has remained consistent over multiple analysis windows.`;
    
    case 'strategy_shift':
      return `Strategy shifted from ${prevName || 'unknown'} to ${strategyName}. ${additionalContext || 'Significant change in behavioral patterns detected.'}`;
    
    case 'phase_change':
      return `Phase transition detected within ${strategyName} strategy. ${additionalContext || 'Actor is shifting between accumulation and distribution activities.'}`;
    
    case 'confidence_change':
      return `Confidence in ${strategyName} strategy changed to ${confPct}%. ${additionalContext || 'Pattern clarity has been updated based on recent activity.'}`;
    
    case 'stability_change':
      return `Stability of ${strategyName} strategy changed to ${stabPct}%. ${additionalContext || 'Behavioral consistency has been recalculated.'}`;
    
    default:
      return `Timeline event: ${eventType} for ${strategyName}`;
  }
}
