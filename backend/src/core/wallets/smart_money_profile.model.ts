/**
 * Smart Money Profile Mongoose Model (B4)
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { SmartMoneyProfile, AlertSmartMoneyContext } from './smart_money_profile.schema.js';

export interface ISmartMoneyProfile extends SmartMoneyProfile, Document {}
export interface IAlertSmartMoneyContext extends AlertSmartMoneyContext, Document {}

const PerformanceMetricsSubSchema = new Schema({
  winRate: { type: Number, required: true, min: 0, max: 1 },
  avgReturn: { type: Number, required: true },
  maxDrawdown: { type: Number, required: true, min: 0, max: 1 },
  medianHoldTime: { type: Number, required: true },
}, { _id: false });

const CorrelationMetricsSubSchema = new Schema({
  accumulationSuccess: { type: Number, required: true, min: 0, max: 1 },
  distributionTiming: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const ScoreComponentsSubSchema = new Schema({
  winRateContrib: { type: Number, required: true },
  accumulationContrib: { type: Number, required: true },
  timingContrib: { type: Number, required: true },
  drawdownPenalty: { type: Number, required: true },
}, { _id: false });

const AnalysisPeriodSubSchema = new Schema({
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  daysAnalyzed: { type: Number, required: true },
}, { _id: false });

const SmartMoneyProfileMongoSchema = new Schema<ISmartMoneyProfile>(
  {
    profileId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    subjectType: { 
      type: String, 
      required: true,
      enum: ['wallet', 'cluster'],
    },
    subjectId: { 
      type: String, 
      required: true,
      index: true,
    },
    sampleSize: { type: Number, required: true, min: 0 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    performance: PerformanceMetricsSubSchema,
    correlation: CorrelationMetricsSubSchema,
    score: { type: Number, required: true, min: 0, max: 100 },
    scoreComponents: ScoreComponentsSubSchema,
    label: { 
      type: String, 
      required: true,
      enum: ['emerging', 'proven', 'elite'],
    },
    labelExplanation: { type: String, required: true },
    analysisPeriod: AnalysisPeriodSubSchema,
    chain: { type: String, default: 'Ethereum' },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'smart_money_profiles',
  }
);

// Indexes
SmartMoneyProfileMongoSchema.index(
  { subjectType: 1, subjectId: 1 },
  { name: 'subject_lookup', unique: true }
);
SmartMoneyProfileMongoSchema.index(
  { label: 1, score: -1 },
  { name: 'top_performers' }
);

// Alert Smart Money Context
const AlertSmartMoneyContextMongoSchema = new Schema<IAlertSmartMoneyContext>(
  {
    groupId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    smartMoneyInvolved: { type: Boolean, required: true },
    smartMoneyCount: { type: Number, required: true },
    labelCounts: {
      elite: { type: Number, default: 0 },
      proven: { type: Number, default: 0 },
      emerging: { type: Number, default: 0 },
    },
    contextText: { type: String, required: true },
    confidenceBoost: { type: Number, required: true, min: 0, max: 0.2 },
    calculatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'alert_smart_money_context',
  }
);

// Get or create models
let SmartMoneyProfileModel: Model<ISmartMoneyProfile>;
let AlertSmartMoneyContextModel: Model<IAlertSmartMoneyContext>;

try {
  SmartMoneyProfileModel = mongoose.model<ISmartMoneyProfile>('SmartMoneyProfile');
} catch {
  SmartMoneyProfileModel = mongoose.model<ISmartMoneyProfile>(
    'SmartMoneyProfile', 
    SmartMoneyProfileMongoSchema
  );
}

try {
  AlertSmartMoneyContextModel = mongoose.model<IAlertSmartMoneyContext>('AlertSmartMoneyContext');
} catch {
  AlertSmartMoneyContextModel = mongoose.model<IAlertSmartMoneyContext>(
    'AlertSmartMoneyContext', 
    AlertSmartMoneyContextMongoSchema
  );
}

export { SmartMoneyProfileModel, AlertSmartMoneyContextModel };
