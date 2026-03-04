/**
 * Negative Sample Labeler
 * 
 * EPIC 8: Classifies candidates into 4 negative types
 * 
 * Types:
 * (N1) STRUCTURAL - Pattern exists, no price reaction
 * (N2) NOISE - Flow spike with no continuation
 * (N3) EXHAUSTION - Late entry after run-up
 * (N4) REVERSAL - Accumulation then distribution
 */

import type { 
  NegativeCandidate, 
  NegativeSample, 
  NegativeType,
  LabelReason 
} from './negative.types.js';
import { classifySample } from './negative_rules.js';
import { v4 as uuidv4 } from 'uuid';

interface LabelResult {
  label: 0 | 1;
  labelReason: LabelReason;
  negativeType?: NegativeType;
  priceMetrics: NegativeSample['priceMetrics'];
  temporalContext: NegativeSample['temporalContext'];
}

/**
 * Label a single candidate
 */
export function labelCandidate(
  candidate: NegativeCandidate,
  horizon: '7d' | '14d'
): LabelResult | null {
  // Check required data
  if (!candidate.priceData || !candidate.temporalFeatures) {
    return null; // Insufficient data
  }
  
  const { priceData, temporalFeatures } = candidate;
  
  // Calculate price metrics
  const priceAtSignal = priceData.priceAtSignal;
  const futureReturn24h = (priceData.price24h - priceAtSignal) / priceAtSignal;
  const futureReturn7d = (priceData.price7d - priceAtSignal) / priceAtSignal;
  
  // MAE and MFE
  const mae = (priceData.minPrice - priceAtSignal) / priceAtSignal;
  const mfe = (priceData.maxPrice - priceAtSignal) / priceAtSignal;
  
  // TODO: Calculate past return from historical price
  const pastReturn7d = 0; // Placeholder
  
  // Extract temporal features
  const deltaNetFlow24h = Number(temporalFeatures['net_flow_24h_delta'] || 0);
  const deltaNetFlow3d = Number(temporalFeatures['net_flow_3d_delta'] || 0);
  const deltaNetFlow7d = Number(temporalFeatures['net_flow_7d_delta'] || 0);
  const slope7d = Number(temporalFeatures['net_flow_7d_slope'] || 0);
  const acceleration7d = Number(temporalFeatures['net_flow_7d_acceleration'] || 0);
  const consistency = Number(temporalFeatures['net_flow_7d_consistency'] || 0.5);
  const regime = String(temporalFeatures['net_flow_7d_regime'] || 'NOISE');
  
  // Classify using rules
  const classification = classifySample({
    futureReturn24h,
    futureReturn7d,
    pastReturn7d,
    deltaNetFlow24h,
    deltaNetFlow3d,
    consistency,
    acceleration: acceleration7d,
    regime,
    signalStrength: candidate.signalStrength,
    mae,
    mfe,
  });
  
  return {
    label: classification.label,
    labelReason: classification.reason as LabelReason,
    negativeType: classification.negativeType,
    priceMetrics: {
      futureReturn24h,
      futureReturn7d,
      pastReturn7d,
      maxAdverseExcursion: mae,
      maxFavorableExcursion: mfe,
    },
    temporalContext: {
      deltaNetFlow24h,
      deltaNetFlow3d,
      deltaNetFlow7d,
      slope7d,
      acceleration7d,
      consistency,
      regime,
    },
  };
}

/**
 * Convert labeled candidate to full sample
 */
export function createSample(
  candidate: NegativeCandidate,
  labelResult: LabelResult,
  runId: string,
  horizon: '7d' | '14d'
): NegativeSample {
  return {
    sampleId: uuidv4(),
    tokenAddress: candidate.tokenAddress,
    signalId: candidate.signalId,
    
    label: labelResult.label,
    labelReason: labelResult.labelReason,
    negativeType: labelResult.negativeType,
    
    priceMetrics: labelResult.priceMetrics,
    temporalContext: labelResult.temporalContext,
    
    signalContext: {
      signalType: candidate.signalType,
      signalStrength: candidate.signalStrength,
      hasSmartMoney: false, // TODO: Extract from signal
      hasAccumulation: candidate.signalType === 'accumulation',
    },
    
    horizon,
    signalTimestamp: candidate.signalTimestamp,
    createdAt: new Date(),
    runId,
    gateVersion: 'EPIC_8',
  };
}

/**
 * Label batch of candidates
 */
export function labelCandidates(
  candidates: NegativeCandidate[],
  runId: string,
  horizon: '7d' | '14d'
): {
  samples: NegativeSample[];
  insufficientCount: number;
} {
  const samples: NegativeSample[] = [];
  let insufficientCount = 0;
  
  for (const candidate of candidates) {
    const labelResult = labelCandidate(candidate, horizon);
    
    if (labelResult === null) {
      insufficientCount++;
      continue;
    }
    
    const sample = createSample(candidate, labelResult, runId, horizon);
    samples.push(sample);
  }
  
  return { samples, insufficientCount };
}
