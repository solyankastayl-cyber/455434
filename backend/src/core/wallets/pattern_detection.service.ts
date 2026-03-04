/**
 * Bot/Farm Pattern Detection Service
 * 
 * Rule-based detection of automated wallet behavior.
 * Philosophy: Classification, not accusation.
 * 
 * Pattern Types:
 * - bot_like: Automated trading/interaction patterns
 * - farm_like: Coordinated multi-wallet activity
 * - organic: Normal human behavior
 */
import { TransferModel } from '../transfers/transfers.model.js';

// ============ TYPES ============

export interface PatternFeature {
  feature: string;
  score: number;
  evidence: string;
}

export interface WalletPatternResult {
  patternType: 'bot_like' | 'farm_like' | 'organic' | 'insufficient_data';
  confidence: number; // Internal only
  matchedWallets: number;
  matchedFeatures: string[];
  features: PatternFeature[];
  interpretation: {
    headline: string;
    description: string;
  };
}

// ============ THRESHOLDS ============

const THRESHOLDS = {
  MIN_TX_COUNT: 10,
  TEMPORAL_INTERVAL_VARIANCE: 0.15, // Low variance = bot-like
  BURST_TX_COUNT: 5,
  BURST_WINDOW_SECONDS: 60,
  AMOUNT_REPETITION_RATIO: 0.5, // >50% same amounts = suspicious
  CONTRACT_OVERLAP_RATIO: 0.7, // >70% same contracts = pattern
  BOT_SCORE_THRESHOLD: 0.6,
  FARM_SCORE_THRESHOLD: 0.5,
};

// ============ MAIN FUNCTION ============

/**
 * Analyze wallet for bot/farm patterns
 */
export async function analyzeWalletPatterns(walletAddress: string): Promise<WalletPatternResult> {
  const address = walletAddress.toLowerCase();
  
  // Get wallet transactions
  const transfers = await TransferModel.find({
    $or: [{ from: address }, { to: address }]
  })
    .sort({ timestamp: 1 })
    .limit(1000)
    .lean();
  
  if (transfers.length < THRESHOLDS.MIN_TX_COUNT) {
    return {
      patternType: 'insufficient_data',
      confidence: 0,
      matchedWallets: 0,
      matchedFeatures: [],
      features: [],
      interpretation: {
        headline: 'Insufficient transaction history',
        description: `Wallet has ${transfers.length} transactions. Minimum ${THRESHOLDS.MIN_TX_COUNT} required for pattern analysis.`
      }
    };
  }
  
  // Analyze features
  const features: PatternFeature[] = [];
  
  // 1. Temporal Analysis
  const temporalFeature = analyzeTemporalPatterns(transfers);
  features.push(temporalFeature);
  
  // 2. Amount Analysis
  const amountFeature = analyzeAmountPatterns(transfers);
  features.push(amountFeature);
  
  // 3. Contract/Asset Analysis
  const contractFeature = analyzeContractPatterns(transfers);
  features.push(contractFeature);
  
  // 4. Burst Detection
  const burstFeature = analyzeBurstPatterns(transfers);
  features.push(burstFeature);
  
  // 5. Counterparty Analysis
  const counterpartyFeature = analyzeCounterpartyPatterns(transfers, address);
  features.push(counterpartyFeature);
  
  // Calculate overall scores
  const botScore = calculateBotScore(features);
  const farmScore = calculateFarmScore(features);
  
  // Find similar wallets (simplified - count wallets with same top counterparty)
  const matchedWallets = await findSimilarWallets(address, transfers);
  
  // Determine pattern type
  let patternType: 'bot_like' | 'farm_like' | 'organic' = 'organic';
  let confidence = 0;
  
  if (botScore >= THRESHOLDS.BOT_SCORE_THRESHOLD) {
    patternType = 'bot_like';
    confidence = botScore;
  } else if (farmScore >= THRESHOLDS.FARM_SCORE_THRESHOLD && matchedWallets > 10) {
    patternType = 'farm_like';
    confidence = farmScore;
  } else {
    confidence = 1 - Math.max(botScore, farmScore);
  }
  
  // Get matched features
  const matchedFeatures = features
    .filter(f => f.score > 0.5)
    .map(f => f.feature);
  
  // Generate interpretation
  const interpretation = generateInterpretation(patternType, features, matchedWallets);
  
  return {
    patternType,
    confidence,
    matchedWallets,
    matchedFeatures,
    features,
    interpretation
  };
}

// ============ FEATURE ANALYZERS ============

/**
 * Analyze timing patterns between transactions
 */
function analyzeTemporalPatterns(transfers: any[]): PatternFeature {
  if (transfers.length < 3) {
    return { feature: 'temporal_similarity', score: 0, evidence: 'Not enough transactions' };
  }
  
  // Calculate intervals between consecutive transactions
  const intervals: number[] = [];
  for (let i = 1; i < transfers.length; i++) {
    const t1 = new Date(transfers[i - 1].timestamp).getTime();
    const t2 = new Date(transfers[i].timestamp).getTime();
    intervals.push((t2 - t1) / 1000); // seconds
  }
  
  // Calculate variance coefficient
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;
  
  // Low variance = regular intervals = bot-like
  const score = coefficientOfVariation < THRESHOLDS.TEMPORAL_INTERVAL_VARIANCE ? 0.9 :
                coefficientOfVariation < 0.3 ? 0.7 :
                coefficientOfVariation < 0.5 ? 0.4 : 0.1;
  
  const evidence = score > 0.5 
    ? `Regular intervals detected (CV: ${coefficientOfVariation.toFixed(2)})`
    : `Variable timing patterns (CV: ${coefficientOfVariation.toFixed(2)})`;
  
  return { feature: 'temporal_similarity', score, evidence };
}

/**
 * Analyze transaction amount patterns
 */
function analyzeAmountPatterns(transfers: any[]): PatternFeature {
  // Count repeated amounts
  const amountCounts = new Map<string, number>();
  
  for (const t of transfers) {
    const amount = t.amountRaw?.toString() || '0';
    amountCounts.set(amount, (amountCounts.get(amount) || 0) + 1);
  }
  
  // Find most common amount
  let maxCount = 0;
  for (const count of amountCounts.values()) {
    if (count > maxCount) maxCount = count;
  }
  
  const repetitionRatio = maxCount / transfers.length;
  
  // High repetition = bot-like
  const score = repetitionRatio >= THRESHOLDS.AMOUNT_REPETITION_RATIO ? 0.85 :
                repetitionRatio >= 0.3 ? 0.5 :
                repetitionRatio >= 0.2 ? 0.3 : 0.1;
  
  const evidence = score > 0.5
    ? `${(repetitionRatio * 100).toFixed(0)}% transactions use same amount`
    : `Varied transaction amounts`;
  
  return { feature: 'amount_repetition', score, evidence };
}

/**
 * Analyze contract/asset interaction patterns
 */
function analyzeContractPatterns(transfers: any[]): PatternFeature {
  // Count unique assets
  const assetCounts = new Map<string, number>();
  
  for (const t of transfers) {
    const asset = t.assetAddress?.toLowerCase() || 'eth';
    assetCounts.set(asset, (assetCounts.get(asset) || 0) + 1);
  }
  
  // Find concentration
  let maxCount = 0;
  for (const count of assetCounts.values()) {
    if (count > maxCount) maxCount = count;
  }
  
  const concentrationRatio = maxCount / transfers.length;
  const uniqueAssets = assetCounts.size;
  
  // High concentration on few assets + low variety = pattern
  const score = concentrationRatio >= THRESHOLDS.CONTRACT_OVERLAP_RATIO && uniqueAssets <= 3 ? 0.8 :
                concentrationRatio >= 0.5 && uniqueAssets <= 5 ? 0.5 : 0.2;
  
  const evidence = score > 0.5
    ? `${uniqueAssets} unique assets, ${(concentrationRatio * 100).toFixed(0)}% on primary`
    : `Diverse asset interactions (${uniqueAssets} assets)`;
  
  return { feature: 'contract_overlap', score, evidence };
}

/**
 * Detect burst activity patterns
 */
function analyzeBurstPatterns(transfers: any[]): PatternFeature {
  let burstCount = 0;
  let maxBurstSize = 0;
  
  // Sliding window for burst detection
  for (let i = 0; i < transfers.length; i++) {
    let windowCount = 1;
    const startTime = new Date(transfers[i].timestamp).getTime();
    
    for (let j = i + 1; j < transfers.length; j++) {
      const txTime = new Date(transfers[j].timestamp).getTime();
      if ((txTime - startTime) / 1000 <= THRESHOLDS.BURST_WINDOW_SECONDS) {
        windowCount++;
      } else {
        break;
      }
    }
    
    if (windowCount >= THRESHOLDS.BURST_TX_COUNT) {
      burstCount++;
      if (windowCount > maxBurstSize) maxBurstSize = windowCount;
    }
  }
  
  const burstRatio = burstCount / Math.max(1, transfers.length - THRESHOLDS.BURST_TX_COUNT);
  
  const score = burstRatio > 0.3 ? 0.9 :
                burstRatio > 0.1 ? 0.6 :
                maxBurstSize >= THRESHOLDS.BURST_TX_COUNT ? 0.4 : 0.1;
  
  const evidence = score > 0.5
    ? `${burstCount} burst periods detected (max ${maxBurstSize} tx in ${THRESHOLDS.BURST_WINDOW_SECONDS}s)`
    : `No significant burst activity`;
  
  return { feature: 'burst_activity', score, evidence };
}

/**
 * Analyze counterparty patterns
 */
function analyzeCounterpartyPatterns(transfers: any[], walletAddress: string): PatternFeature {
  const counterpartyCounts = new Map<string, number>();
  
  for (const t of transfers) {
    const counterparty = t.from.toLowerCase() === walletAddress 
      ? t.to.toLowerCase() 
      : t.from.toLowerCase();
    counterpartyCounts.set(counterparty, (counterpartyCounts.get(counterparty) || 0) + 1);
  }
  
  // Find concentration on single counterparty
  let maxCount = 0;
  for (const count of counterpartyCounts.values()) {
    if (count > maxCount) maxCount = count;
  }
  
  const concentrationRatio = maxCount / transfers.length;
  const uniqueCounterparties = counterpartyCounts.size;
  
  // High concentration + few counterparties = farm pattern
  const score = concentrationRatio >= 0.8 && uniqueCounterparties <= 3 ? 0.9 :
                concentrationRatio >= 0.5 && uniqueCounterparties <= 10 ? 0.6 :
                uniqueCounterparties <= 5 ? 0.4 : 0.1;
  
  const evidence = score > 0.5
    ? `${uniqueCounterparties} counterparties, ${(concentrationRatio * 100).toFixed(0)}% to primary`
    : `Diverse counterparty interactions (${uniqueCounterparties} addresses)`;
  
  return { feature: 'counterparty_concentration', score, evidence };
}

// ============ SCORING ============

function calculateBotScore(features: PatternFeature[]): number {
  // Weights for bot detection
  const weights: Record<string, number> = {
    'temporal_similarity': 0.35,
    'amount_repetition': 0.25,
    'burst_activity': 0.25,
    'contract_overlap': 0.15,
  };
  
  let totalWeight = 0;
  let weightedScore = 0;
  
  for (const f of features) {
    const weight = weights[f.feature] || 0;
    weightedScore += f.score * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}

function calculateFarmScore(features: PatternFeature[]): number {
  // Weights for farm detection
  const weights: Record<string, number> = {
    'counterparty_concentration': 0.4,
    'amount_repetition': 0.3,
    'contract_overlap': 0.2,
    'temporal_similarity': 0.1,
  };
  
  let totalWeight = 0;
  let weightedScore = 0;
  
  for (const f of features) {
    const weight = weights[f.feature] || 0;
    weightedScore += f.score * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}

// ============ SIMILAR WALLETS ============

async function findSimilarWallets(address: string, transfers: any[]): Promise<number> {
  // Get primary counterparty
  const counterpartyCounts = new Map<string, number>();
  for (const t of transfers) {
    const cp = t.from.toLowerCase() === address ? t.to.toLowerCase() : t.from.toLowerCase();
    counterpartyCounts.set(cp, (counterpartyCounts.get(cp) || 0) + 1);
  }
  
  let primaryCounterparty = '';
  let maxCount = 0;
  for (const [cp, count] of counterpartyCounts) {
    if (count > maxCount) {
      maxCount = count;
      primaryCounterparty = cp;
    }
  }
  
  if (!primaryCounterparty) return 0;
  
  // Count other wallets interacting with same counterparty
  const similarCount = await TransferModel.aggregate([
    {
      $match: {
        $or: [{ to: primaryCounterparty }, { from: primaryCounterparty }],
        from: { $ne: address },
        to: { $ne: address }
      }
    },
    {
      $group: {
        _id: { $cond: [{ $eq: ['$from', primaryCounterparty] }, '$to', '$from'] }
      }
    },
    { $count: 'total' }
  ]);
  
  return similarCount[0]?.total || 0;
}

// ============ INTERPRETATION ============

function generateInterpretation(
  patternType: string,
  features: PatternFeature[],
  matchedWallets: number
): { headline: string; description: string } {
  const highScoreFeatures = features.filter(f => f.score > 0.5);
  
  switch (patternType) {
    case 'bot_like':
      return {
        headline: 'Highly repetitive transactional behavior observed',
        description: `Wallet shows automated patterns: ${highScoreFeatures.map(f => f.evidence).join('. ')}. This classification is based on transaction structure, not intent.`
      };
    
    case 'farm_like':
      return {
        headline: `Coordinated activity pattern detected with ${matchedWallets} similar wallets`,
        description: `Wallet shows similarity with other addresses: ${highScoreFeatures.map(f => f.evidence).join('. ')}. Pattern indicates coordinated behavior cluster.`
      };
    
    default:
      return {
        headline: 'Organic transaction behavior observed',
        description: 'Wallet shows varied timing, amounts, and counterparties consistent with individual human activity.'
      };
  }
}
