/**
 * Personalized Intelligence Service (Phase 12B)
 * 
 * Calculates personalized scores and recommendations based on user preferences and bias.
 */
import { UserPreferencesModel, IUserPreferences, DEFAULT_PREFERENCES } from './user_preferences.model.js';
import { UserBiasModel, IUserBias, BiasVector, clampBias, calculateBiasConfidence, BIAS_BOUNDS } from './user_bias.model.js';
import { UserSignalOutcomeModel, IUserSignalOutcome, SignalDecision } from './user_signal_outcomes.model.js';
import { env, ADAPTIVE_VERSION } from '../../config/env.js';

// ========== PREFERENCES ==========

/**
 * Get or create user preferences
 */
export async function getOrCreatePreferences(userId: string): Promise<IUserPreferences> {
  let prefs = await UserPreferencesModel.findOne({ userId });
  
  if (!prefs) {
    prefs = new UserPreferencesModel({
      userId,
      ...DEFAULT_PREFERENCES,
    });
    await prefs.save();
  }
  
  return prefs;
}

/**
 * Update user preferences
 */
export async function updatePreferences(
  userId: string,
  updates: Partial<IUserPreferences>
): Promise<IUserPreferences | null> {
  // Remove protected fields
  delete (updates as any)._id;
  delete (updates as any).userId;
  delete (updates as any).createdAt;
  
  return UserPreferencesModel.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, upsert: true }
  );
}

// ========== BIAS ==========

/**
 * Get or create user bias
 */
export async function getOrCreateBias(userId: string): Promise<IUserBias> {
  let bias = await UserBiasModel.findOne({ userId });
  
  if (!bias) {
    bias = new UserBiasModel({
      userId,
      biasVector: {
        strategy: {},
        risk: 0,
        volatility: 0,
        influence: 0,
        momentum: 0,
      },
    });
    await bias.save();
  }
  
  return bias;
}

/**
 * Update user bias based on a decision
 * 
 * bias += learningRate * (outcome - expected)
 */
export async function updateBiasFromOutcome(
  userId: string,
  outcome: IUserSignalOutcome
): Promise<IUserBias | null> {
  const bias = await getOrCreateBias(userId);
  
  // Calculate outcome score: follow+positive=+1, follow+negative=-1, ignore+positive=-1, etc.
  let outcomeScore = 0;
  if (outcome.outcome === 'positive') {
    outcomeScore = outcome.decision === 'follow' ? 1 : -0.5;
  } else if (outcome.outcome === 'negative') {
    outcomeScore = outcome.decision === 'follow' ? -1 : 0.5;
  }
  
  if (outcomeScore === 0) return bias;
  
  const lr = bias.learningRate * outcome.learningWeight;
  
  // Update strategy bias
  if (outcome.strategyType) {
    const currentStrategyBias = (bias.biasVector.strategy as Map<string, number>).get(outcome.strategyType) || 0;
    const newStrategyBias = clampBias(currentStrategyBias + lr * outcomeScore);
    (bias.biasVector.strategy as Map<string, number>).set(outcome.strategyType, newStrategyBias);
  }
  
  // Update risk bias based on signal severity
  const riskSignal = (outcome.signalSeverity - 50) / 50; // Normalize to -1 to +1
  bias.biasVector.risk = clampBias(bias.biasVector.risk + lr * outcomeScore * riskSignal * 0.5);
  
  // Update evidence count and confidence
  bias.evidenceCount += 1;
  bias.confidenceLevel = calculateBiasConfidence(bias.evidenceCount);
  bias.lastUpdated = new Date();
  
  // Store history (keep last 20)
  bias.biasHistory.push({
    timestamp: new Date(),
    biasVector: JSON.parse(JSON.stringify(bias.biasVector)),
    trigger: `signal:${outcome.signalId}:${outcome.outcome}`,
  });
  if (bias.biasHistory.length > 20) {
    bias.biasHistory = bias.biasHistory.slice(-20);
  }
  
  await bias.save();
  return bias;
}

// ========== PERSONALIZED SCORE ==========

export interface PersonalizedScoreInput {
  globalScore: number;
  strategyType?: string;
  riskLevel: number;        // 0-100
  volatility: number;       // 0-1
  actorInfluence: number;   // 0-100
  signalMomentum: number;   // -1 to +1 (negative = contrarian signal)
}

export interface PersonalizedScoreOutput {
  score: number;
  factors: {
    strategyBias: number;
    riskFit: number;
    volatilityFit: number;
    influenceFit: number;
    momentumFit: number;
    confidenceFit: number;
    timeHorizonFit: number;
  };
  explanation: string;
  adaptiveVersion: string;
}

/**
 * Calculate personalized score
 * 
 * Formula:
 * personalizedScore = globalScore * (1 + strategyBias) * (1 - riskPenalty) * confidenceFit * timeHorizonFit
 */
export async function calculatePersonalizedScore(
  userId: string,
  input: PersonalizedScoreInput
): Promise<PersonalizedScoreOutput> {
  const [prefs, bias] = await Promise.all([
    getOrCreatePreferences(userId),
    getOrCreateBias(userId),
  ]);
  
  // Strategy bias
  let strategyBias = 0;
  if (input.strategyType) {
    // Check if excluded
    if (prefs.excludedStrategies.includes(input.strategyType)) {
      return {
        score: 0,
        factors: { strategyBias: -1, riskFit: 0, volatilityFit: 0, influenceFit: 0, momentumFit: 0, confidenceFit: 0, timeHorizonFit: 0 },
        explanation: `Strategy '${input.strategyType}' is excluded by user preferences`,
        adaptiveVersion: ADAPTIVE_VERSION,
      };
    }
    
    // Preference boost
    if (prefs.preferredStrategies.includes(input.strategyType)) {
      strategyBias += 0.2;
    }
    
    // Learned bias
    const learnedBias = (bias.biasVector.strategy as Map<string, number>).get(input.strategyType) || 0;
    strategyBias += learnedBias * bias.confidenceLevel;
  }
  
  // Risk fit: how well signal risk matches user risk tolerance
  const normalizedRisk = input.riskLevel / 100;
  const riskDelta = Math.abs(normalizedRisk - prefs.riskTolerance);
  const riskPenalty = riskDelta * 0.3; // Max 30% penalty
  const riskFit = 1 - riskPenalty;
  
  // Volatility fit
  const volatilityDelta = Math.abs(input.volatility - prefs.aggressiveness);
  const volatilityFit = 1 - volatilityDelta * 0.2;
  
  // Influence fit (based on learned bias)
  const normalizedInfluence = input.actorInfluence / 100;
  const influenceBias = bias.biasVector.influence * bias.confidenceLevel;
  const influenceFit = 1 + influenceBias * (normalizedInfluence > 0.5 ? 1 : -1) * 0.1;
  
  // Momentum fit
  const momentumBias = bias.biasVector.momentum * bias.confidenceLevel;
  const momentumFit = 1 + momentumBias * input.signalMomentum * 0.1;
  
  // Confidence fit: penalize if below user minimum
  const confidenceFit = input.globalScore >= prefs.minConfidence * 100 ? 1 : 0.5;
  
  // Time horizon fit (simplified)
  let timeHorizonFit = 1;
  if (prefs.timeHorizon === 'short' && input.volatility < 0.3) {
    timeHorizonFit = 0.8; // Short-term traders need volatility
  } else if (prefs.timeHorizon === 'long' && input.volatility > 0.7) {
    timeHorizonFit = 0.8; // Long-term holders dislike high volatility
  }
  
  // Final score
  let personalizedScore = input.globalScore 
    * (1 + strategyBias)
    * riskFit
    * volatilityFit
    * influenceFit
    * momentumFit
    * confidenceFit
    * timeHorizonFit;
  
  // Clamp to 0-100
  personalizedScore = Math.max(0, Math.min(100, personalizedScore));
  
  // Build explanation
  const explanationParts: string[] = [];
  if (strategyBias > 0.1) explanationParts.push(`Strategy boost +${(strategyBias * 100).toFixed(0)}%`);
  if (strategyBias < -0.1) explanationParts.push(`Strategy penalty ${(strategyBias * 100).toFixed(0)}%`);
  if (riskPenalty > 0.1) explanationParts.push(`Risk mismatch -${(riskPenalty * 100).toFixed(0)}%`);
  if (confidenceFit < 1) explanationParts.push(`Below confidence threshold`);
  
  return {
    score: Math.round(personalizedScore),
    factors: {
      strategyBias,
      riskFit,
      volatilityFit,
      influenceFit,
      momentumFit,
      confidenceFit,
      timeHorizonFit,
    },
    explanation: explanationParts.length > 0 
      ? explanationParts.join('; ') 
      : 'Score matches user profile',
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}

// ========== SIGNAL OUTCOMES ==========

/**
 * Record user decision on a signal
 */
export async function recordSignalDecision(
  userId: string,
  signalId: string,
  decision: SignalDecision,
  context: {
    signalType: string;
    signalSeverity: number;
    actorAddress: string;
    strategyType?: string;
    confidenceAtTime: number;
    globalScoreAtTime: number;
    personalizedScoreAtTime?: number;
  }
): Promise<IUserSignalOutcome> {
  const outcome = await UserSignalOutcomeModel.findOneAndUpdate(
    { userId, signalId },
    {
      $set: {
        decision,
        decisionAt: new Date(),
        ...context,
      },
    },
    { upsert: true, new: true }
  );
  
  return outcome!;
}

/**
 * Evaluate outcome of a signal
 */
export async function evaluateSignalOutcome(
  signalId: string,
  outcome: 'positive' | 'negative' | 'neutral',
  virtualPnL?: number
): Promise<number> {
  const result = await UserSignalOutcomeModel.updateMany(
    { signalId, outcome: 'pending' },
    {
      $set: {
        outcome,
        virtualPnL,
        outcomeEvaluatedAt: new Date(),
        wasCorrectDecision: null, // Will be calculated
      },
    }
  );
  
  // Update wasCorrectDecision
  const outcomes = await UserSignalOutcomeModel.find({ signalId });
  for (const o of outcomes) {
    const wasCorrect = 
      (o.decision === 'follow' && outcome === 'positive') ||
      (o.decision === 'ignore' && outcome === 'negative') ||
      (o.decision === 'dismiss' && outcome === 'negative');
    
    o.wasCorrectDecision = wasCorrect;
    await o.save();
    
    // Update user bias
    await updateBiasFromOutcome(o.userId, o);
  }
  
  return result.modifiedCount;
}

// ========== STATS ==========

/**
 * Get personalization stats for user
 */
export async function getUserPersonalizationStats(userId: string) {
  const [prefs, bias, outcomes] = await Promise.all([
    getOrCreatePreferences(userId),
    getOrCreateBias(userId),
    UserSignalOutcomeModel.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$decision',
          count: { $sum: 1 },
          avgPnL: { $avg: '$virtualPnL' },
        },
      },
    ]),
  ]);
  
  const outcomesByDecision: Record<string, { count: number; avgPnL: number }> = {};
  for (const o of outcomes) {
    outcomesByDecision[o._id] = { count: o.count, avgPnL: o.avgPnL || 0 };
  }
  
  return {
    preferences: {
      riskTolerance: prefs.riskTolerance,
      timeHorizon: prefs.timeHorizon,
      preferredStrategies: prefs.preferredStrategies,
      excludedStrategies: prefs.excludedStrategies,
    },
    bias: {
      confidence: bias.confidenceLevel,
      evidenceCount: bias.evidenceCount,
      topStrategyBiases: Object.fromEntries(
        [...(bias.biasVector.strategy as Map<string, number>).entries()]
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 5)
      ),
      riskBias: bias.biasVector.risk,
      stability: bias.biasStability,
    },
    decisions: outcomesByDecision,
  };
}
