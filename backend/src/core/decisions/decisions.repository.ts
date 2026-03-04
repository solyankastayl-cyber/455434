/**
 * Decisions Repository
 */
import {
  DecisionModel,
  IDecision,
  DecisionScope,
  DecisionType,
  RiskLevel,
  Timeframe,
  DECISION_VALIDITY_HOURS,
} from './decisions.model.js';

export interface CreateDecisionInput {
  scope: DecisionScope;
  refId: string;
  decisionType: DecisionType;
  confidence: number;
  rationale: string[];
  riskLevel: RiskLevel;
  suggestedAllocation?: number;
  timeframe: Timeframe;
  context?: IDecision['context'];
}

/**
 * Create decision
 */
export async function createDecision(input: CreateDecisionInput): Promise<IDecision> {
  const validityHours = DECISION_VALIDITY_HOURS[input.decisionType];
  const validUntil = new Date(Date.now() + validityHours * 60 * 60 * 1000);
  
  // Supersede previous decisions for same target
  const previous = await DecisionModel.findOne({
    scope: input.scope,
    refId: input.refId.toLowerCase(),
    validUntil: { $gt: new Date() },
    supersededBy: { $exists: false },
  }).sort({ createdAt: -1 });
  
  const decision = new DecisionModel({
    ...input,
    refId: input.refId.toLowerCase(),
    validUntil,
  });
  
  const saved = await decision.save();
  
  // Mark previous as superseded
  if (previous) {
    await DecisionModel.updateOne(
      { _id: previous._id },
      { $set: { supersededBy: saved._id.toString() } }
    );
  }
  
  return saved;
}

/**
 * Get latest decision for target
 */
export async function getLatestDecision(
  scope: DecisionScope,
  refId: string
): Promise<IDecision | null> {
  return DecisionModel.findOne({
    scope,
    refId: refId.toLowerCase(),
    validUntil: { $gt: new Date() },
    supersededBy: { $exists: false },
  }).sort({ createdAt: -1 }).lean();
}

/**
 * Get decision history for target
 */
export async function getDecisionHistory(
  scope: DecisionScope,
  refId: string,
  limit: number = 20
): Promise<IDecision[]> {
  return DecisionModel.find({
    scope,
    refId: refId.toLowerCase(),
  }).sort({ createdAt: -1 }).limit(limit).lean();
}

/**
 * Get decisions by type
 */
export async function getDecisionsByType(
  decisionType: DecisionType,
  limit: number = 50
): Promise<IDecision[]> {
  return DecisionModel.find({
    decisionType,
    validUntil: { $gt: new Date() },
    supersededBy: { $exists: false },
  }).sort({ confidence: -1 }).limit(limit).lean();
}

/**
 * Get all active decisions
 */
export async function getActiveDecisions(
  limit: number = 100
): Promise<IDecision[]> {
  return DecisionModel.find({
    validUntil: { $gt: new Date() },
    supersededBy: { $exists: false },
  }).sort({ createdAt: -1 }).limit(limit).lean();
}

/**
 * Get decisions stats
 */
export async function getDecisionsStats(): Promise<{
  total: number;
  active: number;
  byType: Record<string, number>;
  byRisk: Record<string, number>;
}> {
  const now = new Date();
  
  const [total, active, byTypeAgg, byRiskAgg] = await Promise.all([
    DecisionModel.countDocuments(),
    DecisionModel.countDocuments({ validUntil: { $gt: now }, supersededBy: { $exists: false } }),
    DecisionModel.aggregate([
      { $match: { validUntil: { $gt: now }, supersededBy: { $exists: false } } },
      { $group: { _id: '$decisionType', count: { $sum: 1 } } },
    ]),
    DecisionModel.aggregate([
      { $match: { validUntil: { $gt: now }, supersededBy: { $exists: false } } },
      { $group: { _id: '$riskLevel', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) byType[item._id] = item.count;
  
  const byRisk: Record<string, number> = {};
  for (const item of byRiskAgg) byRisk[item._id] = item.count;
  
  return { total, active, byType, byRisk };
}
