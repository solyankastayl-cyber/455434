/**
 * Engine Decision Logger (Sprint 4 - v1)
 * 
 * КРИТИЧНО: логируем каждое решение.
 * Это автоматически создаёт training dataset для ML.
 */
import mongoose from 'mongoose';
import { EngineDecision, EngineInput } from './engine.types.js';

const EngineDecisionLogSchema = new mongoose.Schema({
  // Asset info
  asset: {
    address: String,
    symbol: String,
  },
  
  // Window
  window: String,
  
  // Decision output
  decision: {
    label: { type: String, enum: ['BUY', 'SELL', 'NEUTRAL'] },
    strength: { type: String, enum: ['low', 'medium', 'high'] },
    mode: { type: String, default: 'rule_v1' },
    why: [{
      title: String,
      evidence: String,
      source: String,
    }],
    risks: [{
      title: String,
      evidence: String,
    }],
  },
  
  // Coverage at decision time
  coverage: {
    percent: Number,
    checked: [String],
  },
  
  // Inputs used (counts)
  inputsUsed: {
    signals: Number,
    contexts: Number,
    corridors: Number,
  },
  
  // Rules that triggered (for debugging)
  rulesTriggered: [String],
  
  // Feedback (future)
  feedback: {
    helpful: { type: Boolean, default: null },
    feedbackAt: Date,
  },
  
  // Outcome (for ML - filled later)
  outcome: {
    priceChange24h: Number,
    priceChange7d: Number,
    wasCorrect: Boolean,
    labeledAt: Date,
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now, index: true },
  
}, {
  collection: 'engine_decision_logs',
  timestamps: true,
});

// Indexes
EngineDecisionLogSchema.index({ 'decision.label': 1, createdAt: -1 });
EngineDecisionLogSchema.index({ 'asset.symbol': 1, createdAt: -1 });

export const EngineDecisionLogModel = mongoose.model('EngineDecisionLog', EngineDecisionLogSchema);

/**
 * Log engine decision
 */
export async function logEngineDecision(
  input: EngineInput,
  decision: EngineDecision
): Promise<void> {
  try {
    // Determine which rules triggered
    const rulesTriggered: string[] = [];
    
    if (decision.label === 'BUY') {
      if (input.flows.netFlowUsd < 0) rulesTriggered.push('net_outflow');
      if (input.contexts.length >= 1) rulesTriggered.push('has_context');
      if (input.contexts.some(c => c.overlapScore >= 3)) rulesTriggered.push('multi_signal_context');
    } else if (decision.label === 'SELL') {
      if (input.flows.netFlowUsd > 0) rulesTriggered.push('net_inflow');
      if (input.corridors.some(c => c.type === 'corridor_volume_spike')) rulesTriggered.push('corridor_spike');
    } else {
      if (input.coverage.percent < 60) rulesTriggered.push('low_coverage');
      rulesTriggered.push('no_directional_pattern');
    }

    await EngineDecisionLogModel.create({
      asset: input.asset,
      window: input.window,
      decision,
      coverage: input.coverage,
      inputsUsed: {
        signals: input.signals.length,
        contexts: input.contexts.length,
        corridors: input.corridors.length,
      },
      rulesTriggered,
    });
  } catch (err) {
    console.error('[Engine] Failed to log decision:', err);
    // Don't throw - logging should not break the flow
  }
}

/**
 * Get decision logs (for analytics/debugging)
 */
export async function getDecisionLogs(
  filter: { asset?: string; label?: string; limit?: number } = {}
): Promise<any[]> {
  const query: any = {};
  
  if (filter.asset) {
    query['asset.symbol'] = { $regex: filter.asset, $options: 'i' };
  }
  
  if (filter.label) {
    query['decision.label'] = filter.label;
  }
  
  return EngineDecisionLogModel.find(query)
    .sort({ createdAt: -1 })
    .limit(filter.limit || 50)
    .lean();
}

/**
 * Add feedback to decision
 */
export async function addFeedback(
  decisionId: string,
  helpful: boolean
): Promise<boolean> {
  const result = await EngineDecisionLogModel.updateOne(
    { _id: decisionId },
    {
      $set: {
        'feedback.helpful': helpful,
        'feedback.feedbackAt': new Date(),
      },
    }
  );
  return result.modifiedCount > 0;
}
