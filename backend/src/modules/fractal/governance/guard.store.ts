/**
 * BLOCK 47 — Guard MongoDB Model
 * Stores guard decisions and state
 */

import mongoose, { Document, Schema } from 'mongoose';
import { GovernanceMode, GuardDecision, GuardReasonCode } from './guard.types.js';

// ═══════════════════════════════════════════════════════════════
// GUARD STATE MODEL (singleton per symbol)
// ═══════════════════════════════════════════════════════════════

export interface IGuardState extends Document {
  symbol: string;
  mode: GovernanceMode;
  latchUntil: number | null;
  lastDecision: GuardDecision | null;
  lastUpdated: number;
  updatedBy: 'SYSTEM' | 'ADMIN';
  consecutiveHealthyDays: number;
}

const GuardStateSchema = new Schema<IGuardState>({
  symbol: { type: String, required: true, unique: true, index: true },
  mode: { 
    type: String, 
    enum: ['NORMAL', 'PROTECTION_MODE', 'FROZEN_ONLY', 'HALT_TRADING'],
    default: 'NORMAL',
  },
  latchUntil: { type: Number, default: null },
  lastDecision: { type: Schema.Types.Mixed, default: null },
  lastUpdated: { type: Number, default: Date.now },
  updatedBy: { type: String, enum: ['SYSTEM', 'ADMIN'], default: 'SYSTEM' },
  consecutiveHealthyDays: { type: Number, default: 0 },
}, { collection: 'fractal_guard_state' });

export const GuardStateModel = mongoose.model<IGuardState>('FractalGuardState', GuardStateSchema);

// ═══════════════════════════════════════════════════════════════
// GUARD DECISION LOG MODEL
// ═══════════════════════════════════════════════════════════════

export interface IGuardDecisionLog extends Document {
  symbol: string;
  ts: number;
  decision: GuardDecision;
  applied: boolean;
  appliedMode: GovernanceMode | null;
  actor: 'SYSTEM' | 'ADMIN';
  reason?: string;
  context?: Record<string, unknown>;
}

const GuardDecisionLogSchema = new Schema<IGuardDecisionLog>({
  symbol: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  decision: { type: Schema.Types.Mixed, required: true },
  applied: { type: Boolean, default: false },
  appliedMode: { type: String, default: null },
  actor: { type: String, enum: ['SYSTEM', 'ADMIN'], default: 'SYSTEM' },
  reason: { type: String },
  context: { type: Schema.Types.Mixed },
}, { collection: 'fractal_guard_decisions' });

GuardDecisionLogSchema.index({ symbol: 1, ts: -1 });

export const GuardDecisionLogModel = mongoose.model<IGuardDecisionLog>('FractalGuardDecisionLog', GuardDecisionLogSchema);

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export async function getGuardState(symbol: string): Promise<IGuardState> {
  let state = await GuardStateModel.findOne({ symbol });
  
  if (!state) {
    state = await GuardStateModel.create({
      symbol,
      mode: 'NORMAL',
      latchUntil: null,
      lastDecision: null,
      lastUpdated: Date.now(),
      updatedBy: 'SYSTEM',
      consecutiveHealthyDays: 0,
    });
  }
  
  return state;
}

export async function updateGuardState(
  symbol: string,
  updates: Partial<IGuardState>,
  actor: 'SYSTEM' | 'ADMIN' = 'SYSTEM'
): Promise<IGuardState> {
  const state = await GuardStateModel.findOneAndUpdate(
    { symbol },
    { 
      ...updates, 
      lastUpdated: Date.now(),
      updatedBy: actor,
    },
    { new: true, upsert: true }
  );
  
  return state!;
}

export async function logGuardDecision(
  symbol: string,
  decision: GuardDecision,
  applied: boolean,
  actor: 'SYSTEM' | 'ADMIN' = 'SYSTEM',
  reason?: string,
  context?: Record<string, unknown>
): Promise<void> {
  await GuardDecisionLogModel.create({
    symbol,
    ts: Date.now(),
    decision,
    applied,
    appliedMode: applied ? decision.recommendedMode : null,
    actor,
    reason,
    context,
  });
}

export async function getGuardHistory(
  symbol: string,
  options: { from?: number; to?: number; limit?: number } = {}
): Promise<IGuardDecisionLog[]> {
  const query: Record<string, unknown> = { symbol };
  
  if (options.from || options.to) {
    query.ts = {};
    if (options.from) (query.ts as Record<string, unknown>).$gte = options.from;
    if (options.to) (query.ts as Record<string, unknown>).$lte = options.to;
  }
  
  return GuardDecisionLogModel
    .find(query)
    .sort({ ts: -1 })
    .limit(options.limit || 100);
}
