/**
 * Playbooks Service (Phase 13.1)
 */
import { PlaybookModel, IPlaybook, PlaybookConditions, DEFAULT_PLAYBOOK_TEMPLATES } from './playbooks.model.js';

/**
 * Create a new playbook
 */
export async function createPlaybook(
  userId: string,
  data: Partial<IPlaybook>
): Promise<IPlaybook> {
  const playbook = new PlaybookModel({
    ...data,
    userId,
    enabled: true,
    triggerCount: 0,
  });
  
  await playbook.save();
  return playbook;
}

/**
 * Get user's playbooks
 */
export async function getPlaybooks(
  userId: string,
  options?: { enabled?: boolean; scope?: string }
): Promise<IPlaybook[]> {
  const query: any = { userId };
  
  if (options?.enabled !== undefined) {
    query.enabled = options.enabled;
  }
  if (options?.scope) {
    query.scope = options.scope;
  }
  
  return PlaybookModel.find(query).sort({ createdAt: -1 });
}

/**
 * Get playbook by ID
 */
export async function getPlaybookById(
  playbookId: string,
  userId?: string
): Promise<IPlaybook | null> {
  const query: any = { _id: playbookId };
  if (userId) query.userId = userId;
  
  return PlaybookModel.findOne(query);
}

/**
 * Update playbook
 */
export async function updatePlaybook(
  playbookId: string,
  userId: string,
  updates: Partial<IPlaybook>
): Promise<IPlaybook | null> {
  // Remove protected fields
  delete (updates as any)._id;
  delete (updates as any).userId;
  delete (updates as any).triggerCount;
  delete (updates as any).createdAt;
  
  return PlaybookModel.findOneAndUpdate(
    { _id: playbookId, userId },
    { $set: updates },
    { new: true }
  );
}

/**
 * Delete playbook
 */
export async function deletePlaybook(
  playbookId: string,
  userId: string
): Promise<boolean> {
  const result = await PlaybookModel.deleteOne({ _id: playbookId, userId });
  return result.deletedCount > 0;
}

/**
 * Toggle playbook enabled state
 */
export async function togglePlaybook(
  playbookId: string,
  userId: string
): Promise<IPlaybook | null> {
  const playbook = await PlaybookModel.findOne({ _id: playbookId, userId });
  if (!playbook) return null;
  
  playbook.enabled = !playbook.enabled;
  await playbook.save();
  return playbook;
}

/**
 * Find matching playbooks for a signal
 */
export async function findMatchingPlaybooks(
  userId: string,
  signal: {
    type: string;
    severity: number;
    confidence: number;
    stability?: number;
    strategyType?: string;
    risk?: number;
    influence?: number;
    score?: number;
    actorAddress?: string;
    tokenAddress?: string;
  }
): Promise<IPlaybook[]> {
  // Get enabled playbooks that match trigger type
  const playbooks = await PlaybookModel.find({
    userId,
    enabled: true,
    triggerTypes: signal.type,
  });
  
  // Filter by conditions
  return playbooks.filter(pb => {
    const c = pb.conditions;
    
    // Check cooldown
    if (pb.lastTriggeredAt && pb.cooldownMinutes > 0) {
      const cooldownMs = pb.cooldownMinutes * 60 * 1000;
      if (Date.now() - pb.lastTriggeredAt.getTime() < cooldownMs) {
        return false;
      }
    }
    
    // Check severity
    if (c.minSeverity !== undefined && signal.severity < c.minSeverity) return false;
    if (c.maxSeverity !== undefined && signal.severity > c.maxSeverity) return false;
    
    // Check confidence
    if (c.minConfidence !== undefined && signal.confidence < c.minConfidence) return false;
    
    // Check stability
    if (c.minStability !== undefined && signal.stability !== undefined && signal.stability < c.minStability) return false;
    
    // Check strategy
    if (c.allowedStrategies?.length && signal.strategyType) {
      if (!c.allowedStrategies.includes(signal.strategyType)) return false;
    }
    if (c.blockedStrategies?.length && signal.strategyType) {
      if (c.blockedStrategies.includes(signal.strategyType)) return false;
    }
    
    // Check risk
    if (c.riskMax !== undefined && signal.risk !== undefined && signal.risk > c.riskMax) return false;
    
    // Check influence
    if (c.influenceMin !== undefined && signal.influence !== undefined && signal.influence < c.influenceMin) return false;
    
    // Check score
    if (c.minScore !== undefined && signal.score !== undefined && signal.score < c.minScore) return false;
    
    // Check scope targets
    if (pb.scopeTargets?.length) {
      const targets = pb.scopeTargets.map(t => t.toLowerCase());
      if (pb.scope === 'actor' && signal.actorAddress) {
        if (!targets.includes(signal.actorAddress.toLowerCase())) return false;
      }
      if (pb.scope === 'token' && signal.tokenAddress) {
        if (!targets.includes(signal.tokenAddress.toLowerCase())) return false;
      }
      if (pb.scope === 'strategy' && signal.strategyType) {
        if (!targets.includes(signal.strategyType.toLowerCase())) return false;
      }
    }
    
    return true;
  });
}

/**
 * Record playbook trigger
 */
export async function recordPlaybookTrigger(
  playbookId: string
): Promise<void> {
  await PlaybookModel.updateOne(
    { _id: playbookId },
    {
      $set: { lastTriggeredAt: new Date() },
      $inc: { triggerCount: 1 },
    }
  );
}

/**
 * Get playbook templates
 */
export function getPlaybookTemplates() {
  return DEFAULT_PLAYBOOK_TEMPLATES;
}

/**
 * Create playbook from template
 */
export async function createFromTemplate(
  userId: string,
  templateIndex: number,
  overrides?: Partial<IPlaybook>
): Promise<IPlaybook | null> {
  const template = DEFAULT_PLAYBOOK_TEMPLATES[templateIndex];
  if (!template) return null;
  
  return createPlaybook(userId, {
    ...template,
    ...overrides,
  });
}

/**
 * Get playbook stats
 */
export async function getPlaybookStats(userId?: string) {
  const match = userId ? { userId } : {};
  
  const [total, byScope, byTrigger] = await Promise.all([
    PlaybookModel.countDocuments(match),
    PlaybookModel.aggregate([
      { $match: match },
      { $group: { _id: '$scope', count: { $sum: 1 }, enabled: { $sum: { $cond: ['$enabled', 1, 0] } } } },
    ]),
    PlaybookModel.aggregate([
      { $match: match },
      { $unwind: '$triggerTypes' },
      { $group: { _id: '$triggerTypes', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  
  return {
    total,
    byScope: Object.fromEntries(byScope.map(s => [s._id, { count: s.count, enabled: s.enabled }])),
    topTriggerTypes: byTrigger.map(t => ({ type: t._id, count: t.count })),
  };
}
