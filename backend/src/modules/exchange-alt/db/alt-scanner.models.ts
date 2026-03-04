/**
 * ALT SCANNER MONGODB MODELS
 * ==========================
 * 
 * Persistence for ML samples, pattern memory, shadow trades, and snapshots.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// CLUSTER LEARNING SAMPLE
// ═══════════════════════════════════════════════════════════════

export interface IClusterLearningSample extends Document {
  clusterId: string;
  venue: string;
  
  // Features
  avgRsi: number;
  avgFunding: number;
  avgOiDelta: number;
  avgMomentum1h: number;
  avgMomentum4h: number;
  avgMomentum24h: number;
  avgVolatility: number;
  avgLiquidity: number;
  memberCount: number;
  rsiStd: number;
  fundingStd: number;
  
  // Market context
  btcVolatility: number;
  marketRegime: string;
  fundingGlobal: number;
  
  // Outcome
  outcomeClass: 'UP' | 'FLAT' | 'DOWN';
  returnPct: number;
  horizon: string;
  
  // Meta
  timestamp: Date;
  createdAt: Date;
}

const ClusterLearningSampleSchema = new Schema<IClusterLearningSample>({
  clusterId: { type: String, required: true, index: true },
  venue: { type: String, required: true },
  
  avgRsi: { type: Number, default: 0 },
  avgFunding: { type: Number, default: 0 },
  avgOiDelta: { type: Number, default: 0 },
  avgMomentum1h: { type: Number, default: 0 },
  avgMomentum4h: { type: Number, default: 0 },
  avgMomentum24h: { type: Number, default: 0 },
  avgVolatility: { type: Number, default: 0 },
  avgLiquidity: { type: Number, default: 0 },
  memberCount: { type: Number, default: 0 },
  rsiStd: { type: Number, default: 0 },
  fundingStd: { type: Number, default: 0 },
  
  btcVolatility: { type: Number, default: 0 },
  marketRegime: { type: String, default: 'RANGE' },
  fundingGlobal: { type: Number, default: 0 },
  
  outcomeClass: { type: String, enum: ['UP', 'FLAT', 'DOWN'], default: 'FLAT' },
  returnPct: { type: Number, default: 0 },
  horizon: { type: String, default: '4h' },
  
  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, { 
  collection: 'alt_cluster_learning_samples',
  timestamps: false 
});

ClusterLearningSampleSchema.index({ timestamp: -1 });
ClusterLearningSampleSchema.index({ clusterId: 1, timestamp: -1 });

export const ClusterLearningSampleModel = mongoose.model<IClusterLearningSample>(
  'ClusterLearningSample', 
  ClusterLearningSampleSchema
);

// ═══════════════════════════════════════════════════════════════
// PATTERN PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export interface IPatternPerformance extends Document {
  patternId: string;
  patternLabel: string;
  venue: string;
  
  // Core metrics
  hitRate: number;
  avgReturn: number;
  medianReturn: number;
  maxReturn: number;
  maxLoss: number;
  
  totalTrades: number;
  wins: number;
  losses: number;
  neutral: number;
  
  expectancy: number;
  sharpe: number;
  
  // By horizon
  byHorizon: {
    '1h': { hitRate: number; avgReturn: number; samples: number };
    '4h': { hitRate: number; avgReturn: number; samples: number };
    '24h': { hitRate: number; avgReturn: number; samples: number };
  };
  
  // Recent
  recent7d: { hitRate: number; avgReturn: number; trades: number };
  
  // By regime/sector
  byRegime: Map<string, { hitRate: number; avgReturn: number; samples: number }>;
  bySector: Map<string, { hitRate: number; avgReturn: number; samples: number }>;
  
  // Timestamps
  firstSeen: Date;
  lastSeen: Date;
  lastUpdated: Date;
}

const PatternPerformanceSchema = new Schema<IPatternPerformance>({
  patternId: { type: String, required: true, unique: true },
  patternLabel: { type: String, default: 'Unknown' },
  venue: { type: String, default: 'BYBIT' },
  
  hitRate: { type: Number, default: 0 },
  avgReturn: { type: Number, default: 0 },
  medianReturn: { type: Number, default: 0 },
  maxReturn: { type: Number, default: 0 },
  maxLoss: { type: Number, default: 0 },
  
  totalTrades: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  neutral: { type: Number, default: 0 },
  
  expectancy: { type: Number, default: 0 },
  sharpe: { type: Number, default: 0 },
  
  byHorizon: {
    '1h': { hitRate: Number, avgReturn: Number, samples: Number },
    '4h': { hitRate: Number, avgReturn: Number, samples: Number },
    '24h': { hitRate: Number, avgReturn: Number, samples: Number },
  },
  
  recent7d: { hitRate: Number, avgReturn: Number, trades: Number },
  
  byRegime: { type: Map, of: Object, default: {} },
  bySector: { type: Map, of: Object, default: {} },
  
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },
}, { 
  collection: 'alt_pattern_performance',
  timestamps: false 
});

PatternPerformanceSchema.index({ lastSeen: -1 });
PatternPerformanceSchema.index({ hitRate: -1 });

export const PatternPerformanceModel = mongoose.model<IPatternPerformance>(
  'PatternPerformance', 
  PatternPerformanceSchema
);

// ═══════════════════════════════════════════════════════════════
// SHADOW TRADE
// ═══════════════════════════════════════════════════════════════

export interface IShadowTrade extends Document {
  tradeId: string;
  symbol: string;
  venue: string;
  
  // Entry
  direction: 'UP' | 'DOWN';
  entryPrice: number;
  entryTime: Date;
  clusterId: string;
  patternLabel: string;
  confidence: number;
  
  // Context
  regime: string;
  sector: string;
  
  // Exit (filled when closed)
  exitPrice: number | null;
  exitTime: Date | null;
  horizon: string;
  
  // Result
  returnPct: number | null;
  outcome: 'TP' | 'FP' | 'FN' | 'WEAK' | null;
  
  // Status
  status: 'OPEN' | 'CLOSED';
  
  createdAt: Date;
}

const ShadowTradeSchema = new Schema<IShadowTrade>({
  tradeId: { type: String, required: true, unique: true },
  symbol: { type: String, required: true, index: true },
  venue: { type: String, default: 'BYBIT' },
  
  direction: { type: String, enum: ['UP', 'DOWN'], required: true },
  entryPrice: { type: Number, required: true },
  entryTime: { type: Date, default: Date.now },
  clusterId: { type: String, index: true },
  patternLabel: { type: String, default: '' },
  confidence: { type: Number, default: 0 },
  
  regime: { type: String, default: 'RANGE' },
  sector: { type: String, default: 'OTHER' },
  
  exitPrice: { type: Number, default: null },
  exitTime: { type: Date, default: null },
  horizon: { type: String, default: '4h' },
  
  returnPct: { type: Number, default: null },
  outcome: { type: String, enum: ['TP', 'FP', 'FN', 'WEAK', null], default: null },
  
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
  
  createdAt: { type: Date, default: Date.now },
}, { 
  collection: 'alt_shadow_trades',
  timestamps: false 
});

ShadowTradeSchema.index({ status: 1, entryTime: -1 });
ShadowTradeSchema.index({ clusterId: 1, status: 1 });

export const ShadowTradeModel = mongoose.model<IShadowTrade>(
  'ShadowTrade', 
  ShadowTradeSchema
);

// ═══════════════════════════════════════════════════════════════
// DAILY SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export interface IDailySnapshot extends Document {
  date: Date;
  venue: string;
  
  // Scan results
  totalAssets: number;
  totalClusters: number;
  topLongsCount: number;
  topShortsCount: number;
  
  // Market context
  marketRegime: string;
  btcVolatility: number;
  
  // Top opportunities (summary)
  topOpportunities: Array<{
    symbol: string;
    direction: string;
    score: number;
    clusterId: string;
  }>;
  
  // Pattern summary
  activeClusters: Array<{
    clusterId: string;
    label: string;
    memberCount: number;
    avgScore: number;
  }>;
  
  // ML stats
  mlSamples: number;
  mlAccuracy: number;
  
  createdAt: Date;
}

const DailySnapshotSchema = new Schema<IDailySnapshot>({
  date: { type: Date, required: true, index: true },
  venue: { type: String, default: 'BYBIT' },
  
  totalAssets: { type: Number, default: 0 },
  totalClusters: { type: Number, default: 0 },
  topLongsCount: { type: Number, default: 0 },
  topShortsCount: { type: Number, default: 0 },
  
  marketRegime: { type: String, default: 'RANGE' },
  btcVolatility: { type: Number, default: 0 },
  
  topOpportunities: [{ 
    symbol: String, 
    direction: String, 
    score: Number, 
    clusterId: String 
  }],
  
  activeClusters: [{
    clusterId: String,
    label: String,
    memberCount: Number,
    avgScore: Number,
  }],
  
  mlSamples: { type: Number, default: 0 },
  mlAccuracy: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
}, { 
  collection: 'alt_daily_snapshots',
  timestamps: false 
});

DailySnapshotSchema.index({ date: -1, venue: 1 }, { unique: true });

export const DailySnapshotModel = mongoose.model<IDailySnapshot>(
  'DailySnapshot', 
  DailySnapshotSchema
);

// ═══════════════════════════════════════════════════════════════
// STRATEGY RECORD
// ═══════════════════════════════════════════════════════════════

export interface IStrategyRecord extends Document {
  strategyId: string;
  name: string;
  description: string;
  
  // Components
  patternIds: string[];
  sectors: string[];
  regimes: string[];
  
  // Status
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'RETIRED';
  pauseReason: string | null;
  
  // Performance
  totalTrades: number;
  wins: number;
  losses: number;
  hitRate: number;
  expectancy: number;
  
  // Timestamps
  createdAt: Date;
  lastActivatedAt: Date;
  lastDisabledAt: Date | null;
}

const StrategyRecordSchema = new Schema<IStrategyRecord>({
  strategyId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  
  patternIds: [{ type: String }],
  sectors: [{ type: String }],
  regimes: [{ type: String }],
  
  status: { type: String, enum: ['ACTIVE', 'PAUSED', 'DISABLED', 'RETIRED'], default: 'ACTIVE' },
  pauseReason: { type: String, default: null },
  
  totalTrades: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  hitRate: { type: Number, default: 0 },
  expectancy: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  lastActivatedAt: { type: Date, default: Date.now },
  lastDisabledAt: { type: Date, default: null },
}, { 
  collection: 'alt_strategies',
  timestamps: false 
});

StrategyRecordSchema.index({ status: 1 });

export const StrategyRecordModel = mongoose.model<IStrategyRecord>(
  'StrategyRecord', 
  StrategyRecordSchema
);

console.log('[AltScanner] MongoDB models loaded');
