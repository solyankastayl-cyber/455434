/**
 * User Preferences Model (Phase 12B.1)
 * 
 * Stores explicit user preferences for personalized recommendations.
 * What user SAYS they want.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type TimeHorizon = 'short' | 'mid' | 'long';

export interface IUserPreferences extends Document {
  _id: Types.ObjectId;
  
  userId: string;
  
  // Risk and strategy preferences
  riskTolerance: number;          // 0-1 (0 = very conservative, 1 = aggressive)
  preferredStrategies: string[];  // strategy types user prefers
  excludedStrategies: string[];   // strategy types to never show
  
  // Confidence and timing
  minConfidence: number;          // 0-1, filter out signals below this
  timeHorizon: TimeHorizon;       // investment timeframe
  
  // Behavior modifiers
  aggressiveness: number;         // 0-1 (affects position sizing suggestions)
  
  // Notification preferences
  alertThreshold: number;         // minimum severity for alerts (0-100)
  quietHoursStart?: number;       // 0-23 hour
  quietHoursEnd?: number;
  
  // UI preferences
  defaultView: 'market' | 'actors' | 'signals' | 'watchlist';
  showExplanations: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

const UserPreferencesSchema = new Schema<IUserPreferences>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    riskTolerance: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
    preferredStrategies: {
      type: [String],
      default: [],
    },
    excludedStrategies: {
      type: [String],
      default: [],
    },
    
    minConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.3,
    },
    timeHorizon: {
      type: String,
      enum: ['short', 'mid', 'long'],
      default: 'mid',
    },
    
    aggressiveness: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
    
    alertThreshold: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    quietHoursStart: Number,
    quietHoursEnd: Number,
    
    defaultView: {
      type: String,
      enum: ['market', 'actors', 'signals', 'watchlist'],
      default: 'market',
    },
    showExplanations: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'user_preferences',
  }
);

export const UserPreferencesModel = mongoose.model<IUserPreferences>(
  'UserPreferences',
  UserPreferencesSchema
);

/**
 * Default preferences for new users
 */
export const DEFAULT_PREFERENCES: Omit<IUserPreferences, '_id' | 'userId' | 'createdAt' | 'updatedAt'> = {
  riskTolerance: 0.5,
  preferredStrategies: [],
  excludedStrategies: ['wash_operator'],
  minConfidence: 0.3,
  timeHorizon: 'mid',
  aggressiveness: 0.5,
  alertThreshold: 50,
  defaultView: 'market',
  showExplanations: true,
} as any;
