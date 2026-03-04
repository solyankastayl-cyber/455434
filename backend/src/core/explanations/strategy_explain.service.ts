/**
 * Strategy Explanation Service (L10.3 - WHY Engine)
 * 
 * Explains WHY a strategy was detected.
 * Shows what behaviors led to classification.
 * 
 * IMPORTANT: References actual bundle/signal IDs for traceability.
 */
import { StrategyProfileModel, IStrategyProfile } from '../strategies/strategy_profiles.model.js';
import { BundleModel } from '../bundles/bundles.model.js';
import { RelationModel } from '../relations/relations.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { SCORE_FORMULA_VERSION, STRATEGY_THRESHOLDS } from '../scores/score_formula.constants.js';

/**
 * Evidence source reference
 */
export interface EvidenceSource {
  type: 'bundle' | 'signal' | 'relation';
  id: string;
  summary: string;
}

/**
 * Strategy explanation result
 */
export interface StrategyExplanation {
  address: string;
  
  strategy: string;
  strategyDisplayName: string;
  confidence: number;
  stability: number;
  
  detectedBecause: string[];
  supportingEvidence: {
    metric: string;
    value: number | string;
    significance: 'high' | 'medium' | 'low';
  }[];
  
  // Source references for traceability
  evidenceSources: EvidenceSource[];
  
  risks: string[];
  opportunities: string[];
  
  phase: string;
  phaseExplanation: string;
  
  summary: string;
  
  // Version tracking
  formulaVersion: string;
  explainVersion: string;
}

/**
 * Strategy display names
 */
const STRATEGY_NAMES: Record<string, string> = {
  'accumulation_sniper': 'Accumulation Sniper',
  'distribution_whale': 'Distribution Whale',
  'momentum_rider': 'Momentum Rider',
  'rotation_trader': 'Rotation Trader',
  'wash_operator': 'Wash Operator',
  'liquidity_farmer': 'Liquidity Farmer',
  'mixed': 'Mixed Strategy',
};

/**
 * Explain strategy for an address
 */
export async function explainStrategy(
  address: string
): Promise<StrategyExplanation | null> {
  const addr = address.toLowerCase();
  
  // Get strategy profile
  const profile = await StrategyProfileModel
    .findOne({ address: addr })
    .sort({ updatedAt: -1 })
    .lean();
  
  if (!profile) {
    return null;
  }
  
  // Get supporting data with IDs for traceability
  const [bundles, relations, recentSignals] = await Promise.all([
    BundleModel.find({ actors: addr })
      .sort({ volumeUsd: -1 })
      .limit(10)
      .lean(),
    RelationModel.find({ $or: [{ from: addr }, { to: addr }] })
      .sort({ volumeUsd: -1 })
      .limit(10)
      .lean(),
    SignalModel.find({ subjectId: addr })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);
  
  // Build evidence sources for traceability
  const evidenceSources: EvidenceSource[] = [];
  
  // Add top bundles as evidence
  for (const bundle of bundles.slice(0, 3)) {
    evidenceSources.push({
      type: 'bundle',
      id: bundle._id.toString(),
      summary: `${bundle.bundleType} bundle: $${(bundle.volumeUsd || 0).toLocaleString()} volume`,
    });
  }
  
  // Add recent signals as evidence
  for (const signal of recentSignals.slice(0, 2)) {
    evidenceSources.push({
      type: 'signal',
      id: signal._id.toString(),
      summary: `${signal.type}: severity ${signal.severity || 50}`,
    });
  }
  
  // Add top relations as evidence
  for (const relation of relations.slice(0, 2)) {
    evidenceSources.push({
      type: 'relation',
      id: relation._id.toString(),
      summary: `Relation with ${relation.from === addr ? relation.to : relation.from}: ${relation.transferCount} transfers`,
    });
  }
  
  // Analyze bundle breakdown
  const { accumulationRatio, distributionRatio, washRatio, rotationRatio } = profile.bundleBreakdown;
  
  // Build "detected because" reasons
  const detectedBecause: string[] = [];
  const supportingEvidence: StrategyExplanation['supportingEvidence'] = [];
  
  // Strategy-specific reasoning
  switch (profile.strategyType) {
    case 'accumulation_sniper':
      detectedBecause.push(`${Math.round(accumulationRatio * 100)}% of activity is accumulation-type`);
      detectedBecause.push('Consistent inbound flow patterns detected');
      if (washRatio < 0.1) detectedBecause.push('Low wash trading activity (clean accumulation)');
      supportingEvidence.push(
        { metric: 'Accumulation Ratio', value: `${Math.round(accumulationRatio * 100)}%`, significance: 'high' },
        { metric: 'Distribution Ratio', value: `${Math.round(distributionRatio * 100)}%`, significance: 'medium' },
        { metric: 'Confidence', value: `${Math.round(profile.confidence * 100)}%`, significance: 'high' }
      );
      break;
    
    case 'distribution_whale':
      detectedBecause.push(`${Math.round(distributionRatio * 100)}% of activity is distribution-type`);
      detectedBecause.push('Large outbound transfers to multiple counterparties');
      if (relations.length >= 5) detectedBecause.push(`Active relationships with ${relations.length}+ addresses`);
      supportingEvidence.push(
        { metric: 'Distribution Ratio', value: `${Math.round(distributionRatio * 100)}%`, significance: 'high' },
        { metric: 'Counterparties', value: relations.length, significance: 'medium' }
      );
      break;
    
    case 'rotation_trader':
      detectedBecause.push(`${Math.round(rotationRatio * 100)}% rotation activity detected`);
      detectedBecause.push('Frequent asset swaps between positions');
      detectedBecause.push('Balanced inbound/outbound flow');
      supportingEvidence.push(
        { metric: 'Rotation Ratio', value: `${Math.round(rotationRatio * 100)}%`, significance: 'high' },
        { metric: 'Transfer Frequency', value: bundles.length, significance: 'medium' }
      );
      break;
    
    case 'wash_operator':
      detectedBecause.push(`${Math.round(washRatio * 100)}% wash trading patterns detected`);
      detectedBecause.push('Circular transfer patterns identified');
      detectedBecause.push('Self-referential or coordinated activity');
      supportingEvidence.push(
        { metric: 'Wash Ratio', value: `${Math.round(washRatio * 100)}%`, significance: 'high' },
        { metric: 'Risk Level', value: 'Elevated', significance: 'high' }
      );
      break;
    
    case 'momentum_rider':
      detectedBecause.push('Activity correlates with market momentum');
      detectedBecause.push('Trend-following behavior patterns');
      supportingEvidence.push(
        { metric: 'Behavior Pattern', value: 'Momentum-aligned', significance: 'high' }
      );
      break;
    
    case 'liquidity_farmer':
      detectedBecause.push('DeFi protocol interaction patterns');
      detectedBecause.push('Yield-seeking transfer behavior');
      supportingEvidence.push(
        { metric: 'Protocol Interactions', value: 'Multiple', significance: 'medium' }
      );
      break;
    
    default:
      detectedBecause.push('Mixed behavioral signals');
      detectedBecause.push('No dominant strategy pattern identified');
  }
  
  // Determine phase
  let phase: string;
  let phaseExplanation: string;
  
  if (accumulationRatio > distributionRatio + 0.2) {
    phase = 'accumulation';
    phaseExplanation = 'Currently in accumulation phase - net inflows exceed outflows significantly.';
  } else if (distributionRatio > accumulationRatio + 0.2) {
    phase = 'distribution';
    phaseExplanation = 'Currently in distribution phase - net outflows suggest exit or rebalancing.';
  } else {
    phase = 'neutral';
    phaseExplanation = 'Balanced phase - no clear accumulation or distribution dominance.';
  }
  
  // Identify risks
  const risks: string[] = [];
  if (washRatio > 0.2) risks.push('Elevated wash trading risk');
  if (profile.stability < 0.5) risks.push('Strategy may shift - low stability');
  if (profile.confidence < 0.6) risks.push('Classification confidence is moderate');
  if (distributionRatio > 0.7) risks.push('Potential exit phase - watch for continued outflows');
  
  // Identify opportunities
  const opportunities: string[] = [];
  if (profile.strategyType === 'accumulation_sniper' && profile.confidence > 0.7) {
    opportunities.push('High-confidence accumulator - may signal bullish intent');
  }
  if (profile.stability > 0.7) {
    opportunities.push('Stable strategy - reliable for following');
  }
  if (profile.strategyType === 'distribution_whale' && profile.confidence > 0.7) {
    opportunities.push('Confirmed distribution - watch for market impact');
  }
  
  // Generate summary
  const confPct = Math.round(profile.confidence * 100);
  const stabPct = Math.round(profile.stability * 100);
  const strategyName = STRATEGY_NAMES[profile.strategyType] || profile.strategyType;
  
  const summary = `${strategyName} strategy detected with ${confPct}% confidence and ${stabPct}% stability. ` +
    `${detectedBecause[0]}. ` +
    `${risks.length > 0 ? `Key risk: ${risks[0]}.` : 'No major risks identified.'}`;
  
  return {
    address: addr,
    strategy: profile.strategyType,
    strategyDisplayName: strategyName,
    confidence: profile.confidence,
    stability: profile.stability,
    detectedBecause,
    supportingEvidence,
    risks,
    opportunities,
    phase,
    phaseExplanation,
    summary,
    evidenceSources,
    // Version tracking
    formulaVersion: SCORE_FORMULA_VERSION,
    explainVersion: '1.0.0',
  };
}
