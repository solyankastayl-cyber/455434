/**
 * Action Explanations Service (Phase 13.4)
 * 
 * Generates human-readable explanations for actions and suggestions.
 */
import { ActionQueueModel, IActionQueue } from '../action_queue/action_queue.model.js';
import { ActionSuggestionModel, IActionSuggestion } from '../action_suggestions/action_suggestions.model.js';
import { PaperPortfolioModel } from '../paper/paper_portfolio.model.js';
import { PaperPositionModel } from '../paper/paper_position.model.js';
import { ADAPTIVE_VERSION } from '../../config/env.js';

export interface ActionExplanation {
  actionId: string;
  why: string;                    // What changed
  whyNow: string;                 // The trigger
  evidence: {
    type: string;
    id: string;
    summary: string;
  }[];
  riskNotes: string[];
  expectedOutcome: string;
  alternatives: {
    action: string;
    reason: string;
  }[];
  adaptiveVersion: string;
}

/**
 * Generate explanation for a queued action
 */
export async function explainAction(actionId: string): Promise<ActionExplanation | null> {
  const action = await ActionQueueModel.findById(actionId);
  if (!action) return null;
  
  return {
    actionId,
    why: generateWhy(action),
    whyNow: generateWhyNow(action),
    evidence: generateEvidence(action),
    riskNotes: generateRiskNotes(action),
    expectedOutcome: generateExpectedOutcome(action),
    alternatives: generateAlternatives(action),
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

/**
 * Generate explanation for a suggestion
 */
export async function explainSuggestion(suggestionId: string): Promise<ActionExplanation | null> {
  const suggestion = await ActionSuggestionModel.findById(suggestionId);
  if (!suggestion) return null;
  
  return {
    actionId: suggestionId,
    why: `${suggestion.reason} detected for ${suggestion.targetType} ${suggestion.targetId}`,
    whyNow: suggestion.reasonDetails,
    evidence: [{
      type: suggestion.sourceType,
      id: suggestion.sourceId,
      summary: suggestion.reasonDetails,
    }],
    riskNotes: generateRiskNotesFromSuggestion(suggestion),
    expectedOutcome: `Taking action may help you ${getOutcomeFromReason(suggestion.reason)}`,
    alternatives: suggestion.suggestedActions.slice(1).map(a => ({
      action: a.type,
      reason: a.explanation,
    })),
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

/**
 * Generate explanation for portfolio performance
 */
export async function explainPortfolioPerformance(portfolioId: string) {
  const portfolio = await PaperPortfolioModel.findById(portfolioId);
  if (!portfolio) return null;
  
  const positions = await PaperPositionModel.find({
    portfolioId: portfolio._id,
  }).sort({ createdAt: -1 }).limit(20);
  
  const winningPositions = positions.filter(p => (p.realizedPnl || 0) > 0);
  const losingPositions = positions.filter(p => (p.realizedPnl || 0) < 0);
  
  return {
    portfolioId,
    summary: {
      performance: portfolio.stats.totalPnlUSD >= 0 ? 'profitable' : 'in loss',
      winRate: portfolio.stats.winRate,
      avgReturn: portfolio.stats.avgPnlPct,
    },
    insights: [
      portfolio.stats.winRate > 0.5 
        ? 'Strategy shows positive edge with >50% win rate'
        : 'Win rate below 50% - consider adjusting entry criteria',
      portfolio.stats.maxDrawdownPct > 20
        ? 'High drawdown detected - consider tighter stop losses'
        : 'Drawdown within acceptable limits',
      positions.length < 10
        ? 'Need more trades for statistical significance'
        : 'Sufficient trade history for analysis',
    ],
    topWinners: winningPositions.slice(0, 3).map(p => ({
      asset: p.assetSymbol || p.assetAddress.slice(0, 10),
      pnlPct: p.realizedPnlPct,
      reason: p.entryReason,
    })),
    topLosers: losingPositions.slice(0, 3).map(p => ({
      asset: p.assetSymbol || p.assetAddress.slice(0, 10),
      pnlPct: p.realizedPnlPct,
      reason: p.exitReason,
    })),
    recommendations: generatePortfolioRecommendations(portfolio, positions),
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

// Helper functions

function generateWhy(action: IActionQueue): string {
  const actionDescriptions: Record<string, string> = {
    follow: 'Following this target will keep you updated on their activity',
    add_to_watchlist: 'Adding to watchlist helps monitor future movements',
    notify: 'Notification ensures you don\'t miss important events',
    paper_entry: 'Paper entry allows risk-free strategy testing',
    paper_exit: 'Exiting paper position locks in simulated gains/losses',
    create_alert_rule: 'Custom alert rule for ongoing monitoring',
    simulate_copy: 'Copy simulation tests strategy performance',
  };
  
  return actionDescriptions[action.actionType] || `${action.actionType} action for ${action.target.type}`;
}

function generateWhyNow(action: IActionQueue): string {
  return action.explanation || `Triggered by ${action.source.type} ${action.source.id}`;
}

function generateEvidence(action: IActionQueue): { type: string; id: string; summary: string }[] {
  return [{
    type: action.source.type,
    id: action.source.id,
    summary: action.explanation,
  }];
}

function generateRiskNotes(action: IActionQueue): string[] {
  const notes: string[] = [];
  
  if (action.actionType === 'paper_entry') {
    notes.push('Paper trading carries no real financial risk');
    notes.push('Simulated results may differ from real execution');
  }
  
  if (action.priority <= 2) {
    notes.push('High priority action - consider acting quickly');
  }
  
  return notes;
}

function generateExpectedOutcome(action: IActionQueue): string {
  const outcomes: Record<string, string> = {
    follow: 'Receive updates on target activity',
    add_to_watchlist: 'Target added to monitoring list',
    notify: 'Alert delivered via configured channels',
    paper_entry: 'Virtual position opened for tracking',
    paper_exit: 'Virtual position closed, PnL calculated',
  };
  
  return outcomes[action.actionType] || 'Action completed successfully';
}

function generateAlternatives(action: IActionQueue): { action: string; reason: string }[] {
  const alts: Record<string, { action: string; reason: string }[]> = {
    follow: [
      { action: 'add_to_watchlist', reason: 'Less commitment, still tracked' },
      { action: 'create_alert_rule', reason: 'Only notify on specific events' },
    ],
    paper_entry: [
      { action: 'add_to_watchlist', reason: 'Monitor without position' },
      { action: 'simulate_copy', reason: 'Full copy-trading simulation' },
    ],
  };
  
  return alts[action.actionType] || [];
}

function generateRiskNotesFromSuggestion(suggestion: IActionSuggestion): string[] {
  const notes: string[] = [];
  
  if (suggestion.reason === 'risk_spike') {
    notes.push('Risk levels have increased significantly');
    notes.push('Consider reducing exposure');
  }
  
  if (suggestion.reason === 'wash_detected') {
    notes.push('Potential manipulation detected');
    notes.push('Exercise caution with this actor');
  }
  
  if (suggestion.urgencyScore > 0.8) {
    notes.push('Time-sensitive - act quickly for best results');
  }
  
  return notes;
}

function getOutcomeFromReason(reason: string): string {
  const outcomes: Record<string, string> = {
    wash_detected: 'avoid potential manipulation',
    strategy_shift: 'capitalize on behavior changes',
    influence_jump: 'follow newly influential actors',
    intensity_spike: 'catch momentum early',
    risk_spike: 'protect your positions',
    accumulation_pattern: 'identify buying opportunities',
    distribution_pattern: 'avoid selling pressure',
    whale_activity: 'follow smart money',
  };
  
  return outcomes[reason] || 'improve your results';
}

function generatePortfolioRecommendations(portfolio: any, positions: any[]): string[] {
  const recs: string[] = [];
  
  if (portfolio.stats.winRate < 0.4) {
    recs.push('Consider raising entry confidence threshold');
  }
  
  if (portfolio.stats.maxDrawdownPct > 30) {
    recs.push('Implement tighter stop-loss rules');
  }
  
  if (portfolio.stats.avgPnlPct < 0 && portfolio.stats.winRate > 0.5) {
    recs.push('Winners are too small - consider larger profit targets');
  }
  
  if (positions.length < 5) {
    recs.push('More trades needed for reliable statistics');
  }
  
  return recs;
}
