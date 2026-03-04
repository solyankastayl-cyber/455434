/**
 * Alert Explanation Service (L10.3 - WHY Engine)
 * 
 * Explains WHY an alert was triggered.
 * Shows what changed and why it matters.
 */
import { AlertModel, IAlert } from '../alerts/alerts.model.js';
import { StrategySignalModel, IStrategySignal } from '../strategy_signals/strategy_signals.model.js';
import { AlertRuleModel, IAlertRule } from '../alerts/alert_rules.model.js';

/**
 * Alert explanation result
 */
export interface AlertExplanation {
  alertId: string;
  
  // What triggered
  whyTriggered: string[];
  whyNow: string;
  
  // What changed
  whatChanged: {
    before: string;
    after: string;
    delta?: string;
  };
  
  // Rule context
  ruleContext: {
    ruleName?: string;
    scope: string;
    targetId: string;
    thresholds: {
      minSeverity: number;
      minConfidence: number;
    };
  };
  
  // Signal details
  signalDetails: {
    type: string;
    severity: number;
    confidence: number;
    stability?: number;
  };
  
  // Action guidance
  suggestedActions: string[];
  
  // Summary
  summary: string;
}

/**
 * Explain alert by ID
 */
export async function explainAlert(
  alertId: string
): Promise<AlertExplanation | null> {
  // Get alert
  const alert = await AlertModel.findById(alertId).lean();
  
  if (!alert) {
    return null;
  }
  
  // Get source signal
  const signal = await StrategySignalModel.findById(alert.source.signalId).lean();
  
  // Get rule
  const rule = await AlertRuleModel.findById(alert.ruleId).lean();
  
  // Build "why triggered" reasons
  const whyTriggered: string[] = [];
  
  // Based on signal type
  switch (alert.signalType) {
    case 'strategy_detected':
      whyTriggered.push(`New strategy detected: ${alert.strategyType}`);
      whyTriggered.push(`Confidence ${Math.round(alert.confidence * 100)}% exceeds your threshold`);
      break;
    
    case 'strategy_confirmed':
      whyTriggered.push(`Strategy ${alert.strategyType} has been confirmed`);
      whyTriggered.push(`Stability reached ${Math.round((alert.stability || 0) * 100)}%`);
      break;
    
    case 'strategy_shift':
      whyTriggered.push('Strategy type has changed');
      if (signal?.previousStrategyType) {
        whyTriggered.push(`Shifted from ${signal.previousStrategyType} to ${signal.strategyType}`);
      }
      break;
    
    case 'strategy_phase_change':
      whyTriggered.push('Phase within strategy has changed');
      whyTriggered.push('Actor transitioning between accumulation and distribution');
      break;
    
    case 'strategy_intensity_spike':
      whyTriggered.push('Sudden spike in activity intensity');
      whyTriggered.push(`Severity ${alert.severity} indicates significant change`);
      break;
    
    case 'strategy_risk_spike':
      whyTriggered.push('Risk indicators have spiked');
      whyTriggered.push('Wash ratio or suspicious patterns increased');
      break;
    
    case 'strategy_influence_jump':
      whyTriggered.push('Market influence has increased significantly');
      whyTriggered.push('Actor now has greater market impact');
      break;
    
    default:
      whyTriggered.push(`Signal type: ${alert.signalType}`);
  }
  
  // Why now
  let whyNow: string;
  if (rule?.throttle) {
    whyNow = `First occurrence meeting your criteria in the ${rule.throttle} throttle window.`;
  } else {
    whyNow = 'Signal exceeded your configured thresholds.';
  }
  
  // What changed
  const whatChanged = {
    before: signal?.evidence?.compositeScore 
      ? `Previous composite score: ${Math.round(signal.evidence.compositeScore)}`
      : 'No previous state recorded',
    after: `Current severity: ${alert.severity}, confidence: ${Math.round(alert.confidence * 100)}%`,
    delta: signal?.evidence?.scoreDelta 
      ? `Change: ${signal.evidence.scoreDelta > 0 ? '+' : ''}${Math.round(signal.evidence.scoreDelta)}`
      : undefined,
  };
  
  // Rule context
  const ruleContext = {
    ruleName: rule?.name,
    scope: alert.scope,
    targetId: alert.targetId,
    thresholds: {
      minSeverity: rule?.minSeverity || 0,
      minConfidence: rule?.minConfidence || 0,
    },
  };
  
  // Signal details
  const signalDetails = {
    type: alert.signalType,
    severity: alert.severity,
    confidence: alert.confidence,
    stability: alert.stability,
  };
  
  // Suggested actions
  const suggestedActions: string[] = [];
  
  if (alert.signalType === 'strategy_shift') {
    suggestedActions.push('Review the new strategy classification');
    suggestedActions.push('Consider adjusting your follow settings');
  }
  
  if (alert.signalType === 'strategy_risk_spike') {
    suggestedActions.push('Investigate the source of risk increase');
    suggestedActions.push('Consider reducing exposure or unfollowing');
  }
  
  if (alert.severity >= 70) {
    suggestedActions.push('High severity - immediate review recommended');
  }
  
  if (alert.signalType === 'strategy_confirmed' && alert.confidence > 0.8) {
    suggestedActions.push('Confirmed strategy - safe to rely on classification');
  }
  
  if (suggestedActions.length === 0) {
    suggestedActions.push('Acknowledge alert and continue monitoring');
  }
  
  // Summary
  const summary = `Alert triggered because ${whyTriggered[0].toLowerCase()}. ` +
    `${whyNow} ` +
    `${suggestedActions[0]}.`;
  
  return {
    alertId,
    whyTriggered,
    whyNow,
    whatChanged,
    ruleContext,
    signalDetails,
    suggestedActions,
    summary,
  };
}
