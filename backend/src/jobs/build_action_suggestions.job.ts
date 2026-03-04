/**
 * Build Action Suggestions Job (Phase 13.2)
 * 
 * Runs every 60-90 seconds to generate suggestions from signals/decisions.
 */
import { ActionSuggestionModel, SUGGESTION_RULES, SuggestionReason } from '../core/action_suggestions/action_suggestions.model.js';
import { SignalModel } from '../core/signals/signals.model.js';

let lastRunAt: Date | null = null;
let lastResult = {
  signalsProcessed: 0,
  suggestionsCreated: 0,
  duration: 0,
};

/**
 * Map signal type to suggestion reason
 */
function mapSignalToReason(signalType: string): SuggestionReason | null {
  const mapping: Record<string, SuggestionReason> = {
    'wash_detected': 'wash_detected',
    'strategy_shift': 'strategy_shift',
    'strategy_change': 'strategy_shift',
    'influence_jump': 'influence_jump',
    'influence_spike': 'influence_jump',
    'intensity_spike': 'intensity_spike',
    'activity_spike': 'intensity_spike',
    'risk_spike': 'risk_spike',
    'risk_increase': 'risk_spike',
    'accumulation': 'accumulation_pattern',
    'accumulation_pattern': 'accumulation_pattern',
    'distribution': 'distribution_pattern',
    'distribution_pattern': 'distribution_pattern',
    'whale_activity': 'whale_activity',
    'large_transfer': 'whale_activity',
  };
  
  return mapping[signalType.toLowerCase()] || null;
}

export async function buildActionSuggestions(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Find recent signals that haven't been processed for suggestions
  const recentSignals = await SignalModel.find({
    createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 mins
    severity: { $gte: 50 }, // Only significant signals
  }).limit(50);
  
  let suggestionsCreated = 0;
  
  for (const signal of recentSignals) {
    const reason = mapSignalToReason(signal.signalType);
    if (!reason) continue;
    
    const rules = SUGGESTION_RULES[reason];
    if (!rules) continue;
    
    // Check if suggestion already exists
    const existing = await ActionSuggestionModel.findOne({
      sourceId: signal._id.toString(),
      status: 'pending',
    });
    
    if (existing) continue;
    
    // Create suggestion (for 'global' user - would be per-user in production)
    const suggestion = new ActionSuggestionModel({
      userId: 'global', // In production, would create per interested user
      sourceType: 'signal',
      sourceId: signal._id.toString(),
      reason: rules.reason,
      reasonDetails: `${signal.signalType} detected with severity ${signal.severity}`,
      suggestedActions: rules.actions.map(a => ({
        type: a.type,
        priority: a.priority,
        params: {},
        explanation: a.explanation,
      })),
      targetType: 'actor',
      targetId: signal.actorAddress,
      confidenceScore: signal.confidence || 0.7,
      relevanceScore: signal.severity / 100,
      urgencyScore: Math.min(1, signal.severity / 80),
    });
    
    await suggestion.save();
    suggestionsCreated++;
  }
  
  lastRunAt = new Date();
  lastResult = {
    signalsProcessed: recentSignals.length,
    suggestionsCreated,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getBuildActionSuggestionsStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
