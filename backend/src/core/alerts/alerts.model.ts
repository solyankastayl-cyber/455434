/**
 * Alerts MongoDB Model (L8 - Alerts 2.0)
 * 
 * Alert = a triggered notification based on an alert rule
 * These are RARE, VALUABLE events that deserve user attention
 */
import mongoose, { Schema, Document, Types } from 'mongoose';
import type { AlertScope } from './alert_rules.model.js';

/**
 * Alert source types
 */
export type AlertSourceType = 'strategy_signal';

/**
 * Alert Source
 */
export interface AlertSource {
  type: AlertSourceType;
  signalId: string;
}

/**
 * Alert Document Interface
 */
export interface IAlert extends Document {
  _id: Types.ObjectId;
  
  // User
  userId: string;
  
  // Source reference
  source: AlertSource;
  
  // Target info
  scope: AlertScope;
  targetId: string;
  
  // Signal info
  signalType: string;
  strategyType?: string;
  
  // Scores snapshot
  severity: number;
  confidence: number;
  stability?: number;
  
  // Display content
  title: string;
  message: string;
  
  // Rule reference
  ruleId: string;
  
  // Acknowledgment
  acknowledgedAt: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Alert Source Schema
 */
const AlertSourceSchema = new Schema<AlertSource>(
  {
    type: {
      type: String,
      enum: ['strategy_signal'],
      required: true,
    },
    signalId: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

/**
 * Alert Schema
 */
const AlertSchema = new Schema<IAlert>(
  {
    // User
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Source
    source: {
      type: AlertSourceSchema,
      required: true,
    },
    
    // Target
    scope: {
      type: String,
      enum: ['strategy', 'actor', 'entity', 'token'],
      required: true,
    },
    targetId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Signal info
    signalType: {
      type: String,
      required: true,
      index: true,
    },
    strategyType: {
      type: String,
    },
    
    // Scores
    severity: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    stability: {
      type: Number,
      min: 0,
      max: 1,
    },
    
    // Display
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    
    // Rule reference
    ruleId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Acknowledgment
    acknowledgedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'alerts',
  }
);

// ========== INDEXES ==========

// User's alert feed (latest first)
AlertSchema.index({ userId: 1, createdAt: -1 });

// Unacknowledged alerts
AlertSchema.index({ userId: 1, acknowledgedAt: 1, createdAt: -1 });

// For throttle checking
AlertSchema.index({ userId: 1, ruleId: 1, signalType: 1, createdAt: -1 });

// For dedup
AlertSchema.index(
  { userId: 1, 'source.signalId': 1, ruleId: 1 },
  { unique: true }
);

// By target for analytics
AlertSchema.index({ targetId: 1, signalType: 1, createdAt: -1 });

export const AlertModel = mongoose.model<IAlert>('Alert', AlertSchema);

/**
 * Generate alert title based on signal type
 */
export function generateAlertTitle(
  signalType: string,
  strategyType?: string
): string {
  const strategyName = strategyType
    ? strategyType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Unknown';
  
  const titles: Record<string, string> = {
    // Strategy alerts
    'strategy_detected': `${strategyName} Strategy Detected`,
    'strategy_confirmed': `${strategyName} Strategy Confirmed`,
    'strategy_shift': 'Strategy Shift Detected',
    'strategy_phase_change': 'Phase Change Detected',
    'strategy_intensity_spike': 'Intensity Spike Alert',
    'strategy_risk_spike': '⚠️ Risk Spike Alert',
    'strategy_influence_jump': 'Influence Jump Detected',
    // Token alerts
    'accumulation': '📥 Accumulation Detected',
    'distribution': '📤 Distribution Detected',
    'large_move': '💰 Large Move Detected',
    'smart_money_entry': '🐋 Smart Money Entry',
    'smart_money_exit': '🏃 Smart Money Exit',
    'net_flow_spike': '📊 Net Flow Spike',
    'activity_spike': '⚡ Activity Spike',
  };
  
  return titles[signalType] || `Alert: ${signalType}`;
}

/**
 * Generate alert message based on signal type
 */
export function generateAlertMessage(
  signalType: string,
  strategyType?: string,
  previousStrategyType?: string,
  confidence?: number,
  stability?: number
): string {
  const confPct = confidence ? Math.round(confidence * 100) : 0;
  const stabPct = stability ? Math.round(stability * 100) : 0;
  
  const strategyName = strategyType
    ? strategyType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Unknown';
  const prevName = previousStrategyType
    ? previousStrategyType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : null;
  
  const messages: Record<string, string> = {
    // Strategy alerts
    'strategy_detected': `${strategyName} strategy detected with ${confPct}% confidence. Actor shows consistent behavioral patterns.`,
    'strategy_confirmed': `${strategyName} strategy confirmed (confidence ${confPct}%, stability ${stabPct}%). Actor continues established pattern.`,
    'strategy_shift': prevName
      ? `Strategy shift detected: ${prevName} → ${strategyName}. Possible exit phase starting.`
      : `Strategy shift to ${strategyName} detected.`,
    'strategy_phase_change': `Phase change detected within ${strategyName} strategy. Transitioning between accumulation and distribution.`,
    'strategy_intensity_spike': `Intensity spike detected on ${strategyName}. Sudden increase in activity volume.`,
    'strategy_risk_spike': `Risk spike detected on ${strategyName}. Wash ratio or variance increased above safe threshold.`,
    'strategy_influence_jump': `Influence jump detected on ${strategyName}. Market influence has increased significantly.`,
    // Token alerts
    'accumulation': `Accumulation activity detected with ${confPct}% confidence. Smart money wallets are increasing positions.`,
    'distribution': `Distribution activity detected with ${confPct}% confidence. Smart money wallets are reducing positions.`,
    'large_move': `Large transfer detected. Significant token movement observed on-chain.`,
    'smart_money_entry': `Smart money entry detected with ${confPct}% confidence. Attributed wallets are entering this token.`,
    'smart_money_exit': `Smart money exit detected with ${confPct}% confidence. Attributed wallets are leaving this token.`,
    'net_flow_spike': `Net flow spike detected. Unusual inflow/outflow activity observed.`,
    'activity_spike': `Activity spike detected. Transfer volume has increased significantly above normal levels.`,
  };
  
  return messages[signalType] || `Alert triggered for ${signalType}`;
}
