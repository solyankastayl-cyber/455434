/**
 * Attribution Engine (P2.2)
 * 
 * Rule-based classification system for entities/wallets
 * 
 * Philosophy:
 * - ❌ NOT ML
 * - ❌ NOT confidence score (это не "уверенность")
 * - ❌ NOT verdict (это не "приговор")
 * - ✅ Rule-based
 * - ✅ Evidence-first
 * - ✅ Explainable
 * 
 * Attribution Types:
 * - exchange_like: биржи
 * - fund_like: фонды/VC
 * - market_maker_like: маркетмейкеры
 * - custody_like: custody сервисы
 * - unknown: не классифицировано
 */

import { IWalletProfile } from '../wallets/wallet_profile.model.js';

// Attribution types
export type AttributionType = 
  | 'exchange_like' 
  | 'fund_like' 
  | 'market_maker_like' 
  | 'custody_like'
  | 'unknown';

// Evidence item
export interface AttributionEvidence {
  rule: string;
  description: string;
  weight: number; // 0-1
  matched: boolean;
}

// Attribution result
export interface AttributionResult {
  attributionType: AttributionType;
  coverage: number; // 0-100, completeness of data (not confidence!)
  evidence: string[]; // Human-readable evidence list
  evidenceDetails: AttributionEvidence[]; // Detailed evidence with weights
  scores: {
    exchange: number;
    fund: number;
    marketMaker: number;
    custody: number;
  };
  notes: string;
}

// Input metrics for attribution
export interface AttributionMetrics {
  // From wallet profile / transfers
  counterpartyCount: number;
  counterpartyDiversity: number; // 0-1
  assetCount: number;
  assetDiversity: number; // 0-1
  
  // Flow metrics
  flowSymmetry: number; // 0-1 (0 = only in, 1 = balanced, 0.5 = only out)
  inflowDominance: number; // 0-1
  outflowDominance: number; // 0-1
  avgTxSize: number;
  maxTxSize: number;
  
  // Activity patterns
  txFrequency: number; // tx per day
  burstScore: number; // 0-1
  activeDays: number;
  
  // Cohort composition (from P1)
  earlyCohortPct: number; // 0-100
  midCohortPct: number;
  newCohortPct: number;
  
  // Advanced
  bridgeUsage: number; // 0-1
  hotColdRotation: boolean;
  contractInteractionPct: number; // 0-100
  depositClustering: boolean; // deposit-sized tx clustering
  
  // Data completeness
  dataQuality: number; // 0-1
}

/**
 * Calculate coverage (data completeness, NOT confidence)
 */
function calculateCoverage(metrics: AttributionMetrics): number {
  let coverage = 0;
  let total = 0;
  
  // Check which metrics are available
  if (metrics.counterpartyCount > 0) coverage += 20;
  total += 20;
  
  if (metrics.txFrequency > 0) coverage += 15;
  total += 15;
  
  if (metrics.assetCount > 0) coverage += 15;
  total += 15;
  
  if (metrics.avgTxSize > 0) coverage += 10;
  total += 10;
  
  if (metrics.activeDays > 0) coverage += 10;
  total += 10;
  
  // Cohort data
  if (metrics.earlyCohortPct + metrics.midCohortPct + metrics.newCohortPct > 0) coverage += 15;
  total += 15;
  
  // Advanced metrics
  if (metrics.dataQuality > 0) coverage += 15;
  total += 15;
  
  return Math.round((coverage / total) * 100);
}

/**
 * Exchange-like detection rules
 */
function evaluateExchangeLike(metrics: AttributionMetrics): { score: number; evidence: AttributionEvidence[] } {
  const evidence: AttributionEvidence[] = [];
  let score = 0;
  
  // Rule 1: Very high counterparty count
  const highCounterparties = metrics.counterpartyCount > 100;
  evidence.push({
    rule: 'high_counterparties',
    description: highCounterparties 
      ? `Very high counterparty diversity (${metrics.counterpartyCount} unique addresses)`
      : `Low counterparty count (${metrics.counterpartyCount})`,
    weight: 0.25,
    matched: highCounterparties
  });
  if (highCounterparties) score += 0.25;
  
  // Rule 2: Deposit-sized tx clustering
  const depositClustering = metrics.depositClustering;
  evidence.push({
    rule: 'deposit_clustering',
    description: depositClustering
      ? 'Deposit-size transaction clustering detected'
      : 'No clear deposit clustering pattern',
    weight: 0.20,
    matched: depositClustering
  });
  if (depositClustering) score += 0.20;
  
  // Rule 3: Symmetric flows (inflow ≈ outflow)
  const isSymmetric = Math.abs(metrics.flowSymmetry - 0.5) < 0.15; // близко к балансу
  evidence.push({
    rule: 'symmetric_flows',
    description: isSymmetric
      ? 'Balanced inflow/outflow patterns (exchange-like)'
      : `Imbalanced flows (${metrics.flowSymmetry > 0.5 ? 'inflow' : 'outflow'} dominant)`,
    weight: 0.20,
    matched: isSymmetric
  });
  if (isSymmetric) score += 0.20;
  
  // Rule 4: Hot/cold wallet rotation
  const hotColdRotation = metrics.hotColdRotation;
  evidence.push({
    rule: 'hot_cold_rotation',
    description: hotColdRotation
      ? 'Hot/cold wallet rotation pattern detected'
      : 'No hot/cold rotation pattern',
    weight: 0.15,
    matched: hotColdRotation
  });
  if (hotColdRotation) score += 0.15;
  
  // Rule 5: High asset diversity
  const highAssets = metrics.assetDiversity > 0.5 && metrics.assetCount > 20;
  evidence.push({
    rule: 'asset_diversity',
    description: highAssets
      ? `High asset diversity (${metrics.assetCount} different tokens)`
      : `Limited asset diversity (${metrics.assetCount} tokens)`,
    weight: 0.10,
    matched: highAssets
  });
  if (highAssets) score += 0.10;
  
  // Rule 6: Moderate bridge usage
  const moderateBridge = metrics.bridgeUsage > 0.1 && metrics.bridgeUsage < 0.5;
  evidence.push({
    rule: 'bridge_usage',
    description: moderateBridge
      ? 'Moderate bridge activity (exchange-like)'
      : metrics.bridgeUsage > 0.5 ? 'High bridge activity' : 'Low bridge activity',
    weight: 0.10,
    matched: moderateBridge
  });
  if (moderateBridge) score += 0.10;
  
  return { score, evidence };
}

/**
 * Fund-like detection rules
 */
function evaluateFundLike(metrics: AttributionMetrics): { score: number; evidence: AttributionEvidence[] } {
  const evidence: AttributionEvidence[] = [];
  let score = 0;
  
  // Rule 1: Low counterparty count (selective investments)
  const lowCounterparties = metrics.counterpartyCount < 50 && metrics.counterpartyCount > 5;
  evidence.push({
    rule: 'selective_counterparties',
    description: lowCounterparties
      ? `Selective counterparty interaction (${metrics.counterpartyCount} addresses)`
      : `High counterparty count (${metrics.counterpartyCount})`,
    weight: 0.25,
    matched: lowCounterparties
  });
  if (lowCounterparties) score += 0.25;
  
  // Rule 2: Large transaction sizes
  const largeTx = metrics.avgTxSize > 50000 || metrics.maxTxSize > 500000; // $50K avg or $500K max
  evidence.push({
    rule: 'large_transactions',
    description: largeTx
      ? 'Large transaction sizes (fund-like investment patterns)'
      : 'Small to medium transaction sizes',
    weight: 0.20,
    matched: largeTx
  });
  if (largeTx) score += 0.20;
  
  // Rule 3: Cohort bias toward Early/Mid (long-term holdings)
  const earlyMidBias = (metrics.earlyCohortPct + metrics.midCohortPct) > 60;
  evidence.push({
    rule: 'early_mid_bias',
    description: earlyMidBias
      ? `Long-term holding bias (${Math.round(metrics.earlyCohortPct + metrics.midCohortPct)}% Early/Mid cohorts)`
      : 'No clear long-term holding bias',
    weight: 0.20,
    matched: earlyMidBias
  });
  if (earlyMidBias) score += 0.20;
  
  // Rule 4: Low burst activity (steady, not reactive)
  const lowBurst = metrics.burstScore < 0.4;
  evidence.push({
    rule: 'low_burst',
    description: lowBurst
      ? 'Steady activity pattern (fund-like discipline)'
      : 'High burst activity',
    weight: 0.15,
    matched: lowBurst
  });
  if (lowBurst) score += 0.15;
  
  // Rule 5: Low contract interaction (direct holdings)
  const lowContract = metrics.contractInteractionPct < 30;
  evidence.push({
    rule: 'direct_holdings',
    description: lowContract
      ? 'Primarily direct token holdings (fund-like)'
      : 'High DeFi/contract interaction',
    weight: 0.10,
    matched: lowContract
  });
  if (lowContract) score += 0.10;
  
  // Rule 6: Outflow dominance (distributions to LPs)
  const outflowDominance = metrics.outflowDominance > 0.6;
  evidence.push({
    rule: 'distribution_pattern',
    description: outflowDominance
      ? 'Outflow-dominant pattern (potential distributions)'
      : 'Balanced or inflow-dominant',
    weight: 0.10,
    matched: outflowDominance
  });
  if (outflowDominance) score += 0.10;
  
  return { score, evidence };
}

/**
 * Market-maker-like detection rules
 */
function evaluateMarketMakerLike(metrics: AttributionMetrics): { score: number; evidence: AttributionEvidence[] } {
  const evidence: AttributionEvidence[] = [];
  let score = 0;
  
  // Rule 1: High frequency trading
  const highFreq = metrics.txFrequency > 10; // >10 tx/day
  evidence.push({
    rule: 'high_frequency',
    description: highFreq
      ? `High transaction frequency (${metrics.txFrequency.toFixed(1)} tx/day)`
      : `Low frequency (${metrics.txFrequency.toFixed(1)} tx/day)`,
    weight: 0.25,
    matched: highFreq
  });
  if (highFreq) score += 0.25;
  
  // Rule 2: Two-sided flows (constantly buying AND selling)
  const twoSided = Math.abs(metrics.flowSymmetry - 0.5) < 0.1; // очень близко к балансу
  evidence.push({
    rule: 'two_sided_flows',
    description: twoSided
      ? 'Tight two-sided flow balance (market maker pattern)'
      : 'One-sided flow pattern',
    weight: 0.25,
    matched: twoSided
  });
  if (twoSided) score += 0.25;
  
  // Rule 3: High burst score (reactive to market)
  const highBurst = metrics.burstScore > 0.7;
  evidence.push({
    rule: 'burst_reactivity',
    description: highBurst
      ? 'High burst activity (reactive market making)'
      : 'Low burst activity',
    weight: 0.15,
    matched: highBurst
  });
  if (highBurst) score += 0.15;
  
  // Rule 4: High contract interaction (DEX protocols)
  const highContract = metrics.contractInteractionPct > 60;
  evidence.push({
    rule: 'contract_heavy',
    description: highContract
      ? `Heavy contract interaction (${metrics.contractInteractionPct}% via contracts)`
      : 'Low contract interaction',
    weight: 0.20,
    matched: highContract
  });
  if (highContract) score += 0.20;
  
  // Rule 5: High asset diversity (providing liquidity across many pairs)
  const highAssetDiversity = metrics.assetCount > 30 && metrics.assetDiversity > 0.6;
  evidence.push({
    rule: 'multi_asset',
    description: highAssetDiversity
      ? `Multi-asset activity (${metrics.assetCount} tokens)`
      : 'Limited asset scope',
    weight: 0.15,
    matched: highAssetDiversity
  });
  if (highAssetDiversity) score += 0.15;
  
  return { score, evidence };
}

/**
 * Custody-like detection rules
 */
function evaluateCustodyLike(metrics: AttributionMetrics): { score: number; evidence: AttributionEvidence[] } {
  const evidence: AttributionEvidence[] = [];
  let score = 0;
  
  // Rule 1: Inflow dominance (receiving deposits)
  const inflowDominant = metrics.inflowDominance > 0.7;
  evidence.push({
    rule: 'inflow_dominance',
    description: inflowDominant
      ? 'Strong inflow dominance (custody/deposit pattern)'
      : 'Not inflow-dominant',
    weight: 0.30,
    matched: inflowDominant
  });
  if (inflowDominant) score += 0.30;
  
  // Rule 2: Low interaction diversity (holding, not trading)
  const lowInteraction = metrics.counterpartyDiversity < 0.3;
  evidence.push({
    rule: 'low_interaction',
    description: lowInteraction
      ? 'Low interaction diversity (custody-like holding)'
      : 'High interaction diversity',
    weight: 0.25,
    matched: lowInteraction
  });
  if (lowInteraction) score += 0.25;
  
  // Rule 3: Minimal trading patterns (low frequency)
  const lowTrading = metrics.txFrequency < 2 && metrics.burstScore < 0.3;
  evidence.push({
    rule: 'minimal_trading',
    description: lowTrading
      ? 'Minimal trading activity (custody pattern)'
      : 'Active trading detected',
    weight: 0.20,
    matched: lowTrading
  });
  if (lowTrading) score += 0.20;
  
  // Rule 4: High Early cohort (long-term storage)
  const earlyBias = metrics.earlyCohortPct > 60;
  evidence.push({
    rule: 'long_term_storage',
    description: earlyBias
      ? `Long-term storage pattern (${Math.round(metrics.earlyCohortPct)}% Early cohort)`
      : 'No long-term storage bias',
    weight: 0.15,
    matched: earlyBias
  });
  if (earlyBias) score += 0.15;
  
  // Rule 5: Low contract interaction (simple custody)
  const simpleHolding = metrics.contractInteractionPct < 20;
  evidence.push({
    rule: 'simple_holding',
    description: simpleHolding
      ? 'Simple holding pattern (custody-like)'
      : 'Complex DeFi interaction',
    weight: 0.10,
    matched: simpleHolding
  });
  if (simpleHolding) score += 0.10;
  
  return { score, evidence };
}

/**
 * Main Attribution Engine
 * Analyze metrics and classify entity/wallet
 */
export function attributeEntity(metrics: AttributionMetrics): AttributionResult {
  // Evaluate all types
  const exchange = evaluateExchangeLike(metrics);
  const fund = evaluateFundLike(metrics);
  const marketMaker = evaluateMarketMakerLike(metrics);
  const custody = evaluateCustodyLike(metrics);
  
  // Find highest score
  const scores = {
    exchange: exchange.score,
    fund: fund.score,
    marketMaker: marketMaker.score,
    custody: custody.score,
  };
  
  const maxScore = Math.max(...Object.values(scores));
  let attributionType: AttributionType = 'unknown';
  let selectedEvidence: AttributionEvidence[] = [];
  
  // Determine attribution type (require minimum score threshold)
  if (maxScore >= 0.4) { // 40% threshold
    if (scores.exchange === maxScore) {
      attributionType = 'exchange_like';
      selectedEvidence = exchange.evidence;
    } else if (scores.fund === maxScore) {
      attributionType = 'fund_like';
      selectedEvidence = fund.evidence;
    } else if (scores.marketMaker === maxScore) {
      attributionType = 'market_maker_like';
      selectedEvidence = marketMaker.evidence;
    } else if (scores.custody === maxScore) {
      attributionType = 'custody_like';
      selectedEvidence = custody.evidence;
    }
  }
  
  // Extract human-readable evidence (only matched rules)
  const evidence = selectedEvidence
    .filter(e => e.matched)
    .map(e => e.description);
  
  // Calculate coverage
  const coverage = calculateCoverage(metrics);
  
  // Generate notes
  const notes = `Classification reflects observed operational structure, not identity. Coverage: ${coverage}%. Score: ${(maxScore * 100).toFixed(0)}%.`;
  
  return {
    attributionType,
    coverage,
    evidence,
    evidenceDetails: selectedEvidence,
    scores,
    notes,
  };
}

/**
 * Helper: Convert WalletProfile to AttributionMetrics
 */
export function walletProfileToMetrics(profile: IWalletProfile): AttributionMetrics {
  // Calculate flow symmetry (0 = only inflow, 1 = balanced, 0.5 = only outflow)
  const totalFlow = profile.flows.totalIn + profile.flows.totalOut;
  const flowSymmetry = totalFlow > 0 ? profile.flows.totalIn / totalFlow : 0.5;
  
  // Calculate dominance
  const inflowDominance = totalFlow > 0 ? profile.flows.totalIn / totalFlow : 0;
  const outflowDominance = totalFlow > 0 ? profile.flows.totalOut / totalFlow : 0;
  
  // Calculate tx frequency
  const daysSinceFirst = (Date.now() - new Date(profile.activity.firstSeen).getTime()) / (1000 * 60 * 60 * 24);
  const txFrequency = daysSinceFirst > 0 ? profile.activity.txCount / daysSinceFirst : 0;
  
  // Estimate data quality
  const hasActivity = profile.activity.txCount > 0 ? 0.3 : 0;
  const hasFlows = totalFlow > 0 ? 0.3 : 0;
  const hasTokens = profile.tokens.interactedCount > 0 ? 0.2 : 0;
  const hasTags = profile.tags.length > 0 ? 0.2 : 0;
  const dataQuality = hasActivity + hasFlows + hasTokens + hasTags;
  
  return {
    counterpartyCount: profile.tokens.interactedCount, // Approximation
    counterpartyDiversity: profile.behavior.diversificationScore || 0.5,
    assetCount: profile.tokens.interactedCount,
    assetDiversity: profile.behavior.diversificationScore || 0.5,
    
    flowSymmetry,
    inflowDominance,
    outflowDominance,
    avgTxSize: profile.flows.avgTxSize,
    maxTxSize: profile.flows.maxTxSize || profile.flows.avgTxSize * 2,
    
    txFrequency,
    burstScore: profile.behavior.burstinessScore,
    activeDays: profile.activity.activeDays,
    
    // Cohorts - will need to be calculated separately from cohort service
    earlyCohortPct: 0,
    midCohortPct: 0,
    newCohortPct: 0,
    
    // Advanced - estimated from tags
    bridgeUsage: profile.tags.includes('bridge-user') ? 0.3 : 0,
    hotColdRotation: false, // Complex pattern, needs separate detection
    contractInteractionPct: profile.tags.includes('contract') ? 70 : 30,
    depositClustering: profile.tags.includes('cex-like') ? true : false,
    
    dataQuality,
  };
}
