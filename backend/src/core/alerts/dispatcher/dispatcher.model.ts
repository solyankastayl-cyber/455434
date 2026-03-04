/**
 * Dispatcher Mongoose Models (A4)
 * 
 * Persistence for user preferences, rate limits, and notification history
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { 
  UserAlertPreferences, 
  RateLimitEntry, 
  NotificationHistory 
} from './dispatcher.schema.js';

// ============================================
// User Alert Preferences Model
// ============================================

export interface IUserAlertPreferences extends UserAlertPreferences, Document {}

const UserAlertPreferencesMongoSchema = new Schema<IUserAlertPreferences>(
  {
    userId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    
    minPriority: { 
      type: String, 
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    
    channels: [{
      type: String,
      enum: ['ui', 'telegram'],
    }],
    
    notifyOn: {
      new: { type: Boolean, default: true },
      escalation: { type: Boolean, default: true },
      cooling: { type: Boolean, default: false },
      resolution: { type: Boolean, default: false },
    },
    
    telegram: {
      chatId: { type: String },
      enabled: { type: Boolean, default: false },
    },
    
    rateLimits: {
      maxPerHour: { type: Number, default: 10 },
      minIntervalMinutes: { type: Number, default: 15 },
    },
  },
  {
    timestamps: true,
    collection: 'user_alert_preferences',
  }
);

// ============================================
// Rate Limit Model
// ============================================

export interface IRateLimitEntry extends RateLimitEntry, Document {}

const RateLimitMongoSchema = new Schema<IRateLimitEntry>(
  {
    userId: { 
      type: String, 
      required: true,
      index: true,
    },
    groupId: { type: String },
    
    notificationsThisHour: { type: Number, default: 0 },
    hourStartedAt: { type: Date, required: true },
    
    lastNotificationAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'rate_limits',
  }
);

// Compound index for lookup
RateLimitMongoSchema.index({ userId: 1, groupId: 1 }, { name: 'rate_limit_lookup' });

// ============================================
// Notification History Model
// ============================================

export interface INotificationHistory extends NotificationHistory, Document {}

const NotificationHistoryMongoSchema = new Schema<INotificationHistory>(
  {
    notificationId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    userId: { 
      type: String, 
      required: true,
      index: true,
    },
    groupId: { 
      type: String, 
      required: true,
      index: true,
    },
    
    type: { 
      type: String, 
      enum: ['new', 'escalation', 'cooling', 'resolved'],
      required: true,
    },
    priority: { 
      type: String, 
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    
    channels: [{
      type: String,
      enum: ['ui', 'telegram'],
    }],
    
    payload: { type: Schema.Types.Mixed },
    
    createdAt: { type: Date, default: Date.now },
    
    deliveredAt: { type: Map, of: Date },
    errors: { type: Map, of: String },
  },
  {
    timestamps: true,
    collection: 'notification_history',
  }
);

// Index for finding recent notifications
NotificationHistoryMongoSchema.index(
  { userId: 1, createdAt: -1 },
  { name: 'user_notifications' }
);

// ============================================
// Model Initialization
// ============================================

let UserAlertPreferencesModel: Model<IUserAlertPreferences>;
let RateLimitModel: Model<IRateLimitEntry>;
let NotificationHistoryModel: Model<INotificationHistory>;

try {
  UserAlertPreferencesModel = mongoose.model<IUserAlertPreferences>('UserAlertPreferences');
} catch {
  UserAlertPreferencesModel = mongoose.model<IUserAlertPreferences>(
    'UserAlertPreferences', 
    UserAlertPreferencesMongoSchema
  );
}

try {
  RateLimitModel = mongoose.model<IRateLimitEntry>('RateLimit');
} catch {
  RateLimitModel = mongoose.model<IRateLimitEntry>('RateLimit', RateLimitMongoSchema);
}

try {
  NotificationHistoryModel = mongoose.model<INotificationHistory>('NotificationHistory');
} catch {
  NotificationHistoryModel = mongoose.model<INotificationHistory>(
    'NotificationHistory', 
    NotificationHistoryMongoSchema
  );
}

export { 
  UserAlertPreferencesModel, 
  RateLimitModel, 
  NotificationHistoryModel 
};
