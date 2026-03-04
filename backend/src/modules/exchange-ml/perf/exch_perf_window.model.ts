/**
 * Performance Window Model
 * ========================
 * 
 * Stores computed performance windows for historical analysis
 * and simulation comparison.
 */

import { Schema, model, models, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface IExchPerfWindow extends Document {
  runId: string;
  mode: string;                   // baseline/retrain_only/lifecycle
  
  symbol: string;
  horizon: string;
  
  windowDays: number;
  startT: number;
  endT: number;
  
  // Sample counts
  sampleCount: number;
  wins: number;
  losses: number;
  neutrals: number;
  
  // Core metrics
  tradeWinRate: number;
  avgReturn: number;
  stdReturn: number;
  sharpeLike: number;
  equityFinal: number;
  maxDrawdown: number;
  consecutiveLossMax: number;
  stabilityScore: number;
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const ExchPerfWindowSchema = new Schema<IExchPerfWindow>(
  {
    runId: { type: String, required: true, index: true },
    mode: { type: String, required: true, index: true },
    
    symbol: { type: String, required: true, index: true },
    horizon: { type: String, required: true, index: true },
    
    windowDays: { type: Number, required: true },
    startT: { type: Number, required: true },
    endT: { type: Number, required: true },
    
    sampleCount: { type: Number, required: true },
    wins: { type: Number, required: true },
    losses: { type: Number, required: true },
    neutrals: { type: Number, required: true },
    
    tradeWinRate: { type: Number, required: true },
    avgReturn: { type: Number, required: true },
    stdReturn: { type: Number, required: true },
    sharpeLike: { type: Number, required: true },
    equityFinal: { type: Number, required: true },
    maxDrawdown: { type: Number, required: true },
    consecutiveLossMax: { type: Number, required: true },
    stabilityScore: { type: Number, required: true },
  },
  { 
    collection: 'exch_perf_windows', 
    timestamps: true 
  }
);

// Compound indexes for efficient queries
ExchPerfWindowSchema.index({ runId: 1, symbol: 1, horizon: 1, endT: 1 });
ExchPerfWindowSchema.index({ mode: 1, horizon: 1, endT: -1 });

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export const ExchPerfWindowModel = models.ExchPerfWindow || model<IExchPerfWindow>('ExchPerfWindow', ExchPerfWindowSchema);

console.log('[Exchange ML] PerfWindow model loaded');
