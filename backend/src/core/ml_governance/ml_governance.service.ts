/**
 * ML Governance Service
 * 
 * Human-in-the-loop approval workflow:
 * - List pending approvals
 * - Request approval (after PASS)
 * - Approve/Reject models
 * - Guard promotion
 * - Audit logging
 */

import { MlModelRegistryModel } from '../ml_retrain/ml_model_registry.model.js';
import { ApprovalAuditModel, type ApprovalAction } from './ml_approval_audit.model.js';
import { broadcastAdminEvent } from '../admin/admin.events.js';
import type { 
  ApprovalActor, 
  ApprovalStatus, 
  EvalVerdict,
  GovernedModel,
  PendingApprovalItem,
  ActiveModelSummary,
  MlTask
} from './ml_governance.types.js';

export class MlGovernanceService {
  
  /**
   * List models pending approval
   * Only SHADOW + PASS + PENDING models
   */
  async listPending(filters?: { task?: MlTask; network?: string }): Promise<PendingApprovalItem[]> {
    const query: any = { 
      status: 'SHADOW',
      approvalStatus: 'PENDING',
      'eval.verdict': 'PASS'
    };
    
    if (filters?.task) query.modelType = filters.task;
    if (filters?.network) query.network = filters.network;
    
    const models = await MlModelRegistryModel.find(query)
      .sort({ trainedAt: -1 })
      .limit(100)
      .lean();
    
    return models.map(m => this.toPendingItem(m));
  }

  /**
   * List all candidates (SHADOW + PASS, any approval status)
   */
  async listCandidates(filters?: { task?: MlTask; network?: string }): Promise<PendingApprovalItem[]> {
    const query: any = { 
      status: 'SHADOW',
      'eval.verdict': 'PASS'
    };
    
    if (filters?.task) query.modelType = filters.task;
    if (filters?.network) query.network = filters.network;
    
    const models = await MlModelRegistryModel.find(query)
      .sort({ trainedAt: -1 })
      .limit(100)
      .lean();
    
    return models.map(m => this.toPendingItem(m));
  }

  /**
   * Get active model for task/network
   */
  async getActiveModel(task: MlTask, network: string): Promise<ActiveModelSummary | null> {
    const model = await MlModelRegistryModel.findOne({
      modelType: task,
      network,
      status: 'ACTIVE'
    }).lean();
    
    if (!model) return null;
    
    return {
      modelId: model._id.toString(),
      task: model.modelType as MlTask,
      network: model.network,
      version: model.version,
      metrics: model.metrics || {},
      promotedAt: model.trainedAt,
      activatedAt: model.activatedAt,
    };
  }

  /**
   * Request approval for a model
   * Called automatically after shadow eval PASS
   */
  async requestApproval(
    modelId: string, 
    actor: ApprovalActor, 
    note?: string
  ): Promise<GovernedModel> {
    const model = await MlModelRegistryModel.findById(modelId);
    
    if (!model) {
      throw new Error('MODEL_NOT_FOUND');
    }
    
    if (model.status !== 'SHADOW') {
      throw new Error('MODEL_NOT_SHADOW');
    }
    
    if (model.eval?.verdict !== 'PASS') {
      throw new Error('MODEL_NOT_PASS');
    }
    
    if (model.approvalStatus === 'PENDING') {
      throw new Error('MODEL_ALREADY_PENDING');
    }

    model.approvalStatus = 'PENDING';
    model.approval = {
      ...(model.approval || {}),
      requestedAt: new Date(),
      requestedBy: actor,
      note: note || 'Shadow PASS, ready for review',
    };
    
    await model.save();

    // Emit event
    broadcastAdminEvent({
      type: 'MODEL_APPROVAL_REQUESTED',
      meta: {
        modelId: model._id.toString(),
        task: model.modelType,
        network: model.network,
        version: model.version,
      },
      timestamp: Date.now(),
    });

    console.log(`[Governance] Approval requested: ${model.version}`);
    
    return model.toObject() as GovernedModel;
  }

  /**
   * Approve a model for promotion
   */
  async approve(
    modelId: string,
    actor: ApprovalActor,
    note?: string
  ): Promise<GovernedModel> {
    const model = await MlModelRegistryModel.findById(modelId);
    
    if (!model) {
      throw new Error('MODEL_NOT_FOUND');
    }
    
    if (model.approvalStatus !== 'PENDING') {
      throw new Error('MODEL_NOT_PENDING');
    }

    model.approvalStatus = 'APPROVED';
    model.approval = {
      ...(model.approval || {}),
      approvedAt: new Date(),
      approvedBy: actor,
      note: note || undefined,
    };
    
    await model.save();

    // Log to audit
    await this.logAudit({
      action: 'APPROVED',
      modelId: model._id.toString(),
      modelVersion: model.version,
      task: model.modelType as 'market' | 'actor',
      network: model.network,
      actor: { id: actor.id, username: actor.email || actor.id, role: actor.role },
      reason: note,
      metadata: {
        metrics: model.metrics,
        verdict: model.eval?.verdict,
      },
    });

    // Emit event
    broadcastAdminEvent({
      type: 'MODEL_APPROVED',
      meta: {
        modelId: model._id.toString(),
        task: model.modelType,
        network: model.network,
        version: model.version,
        approvedBy: actor.id,
      },
      timestamp: Date.now(),
    });

    console.log(`[Governance] Model approved: ${model.version} by ${actor.id}`);
    
    return model.toObject() as GovernedModel;
  }

  /**
   * Reject a model
   */
  async reject(
    modelId: string,
    actor: ApprovalActor,
    note?: string
  ): Promise<GovernedModel> {
    const model = await MlModelRegistryModel.findById(modelId);
    
    if (!model) {
      throw new Error('MODEL_NOT_FOUND');
    }
    
    if (model.approvalStatus !== 'PENDING' && model.approvalStatus !== 'NONE') {
      // Can reject from PENDING or NONE (before approval requested)
    }

    model.approvalStatus = 'REJECTED';
    model.approval = {
      ...(model.approval || {}),
      rejectedAt: new Date(),
      rejectedBy: actor,
      note: note || undefined,
    };
    
    await model.save();

    // Log to audit
    await this.logAudit({
      action: 'REJECTED',
      modelId: model._id.toString(),
      modelVersion: model.version,
      task: model.modelType as 'market' | 'actor',
      network: model.network,
      actor: { id: actor.id, username: actor.email || actor.id, role: actor.role },
      reason: note,
      metadata: {
        metrics: model.metrics,
        verdict: model.eval?.verdict,
      },
    });

    // Emit event
    broadcastAdminEvent({
      type: 'MODEL_REJECTED',
      meta: {
        modelId: model._id.toString(),
        task: model.modelType,
        network: model.network,
        version: model.version,
        rejectedBy: actor.id,
        reason: note,
      },
      timestamp: Date.now(),
    });

    console.log(`[Governance] Model rejected: ${model.version} by ${actor.id}`);
    
    return model.toObject() as GovernedModel;
  }

  /**
   * Check if model can be promoted
   */
  async canPromote(modelId: string): Promise<{ ok: boolean; reason?: string }> {
    // Validate ObjectId format
    if (!modelId || !modelId.match(/^[0-9a-fA-F]{24}$/)) {
      return { ok: false, reason: 'MODEL_NOT_FOUND' };
    }
    
    const model = await MlModelRegistryModel.findById(modelId).lean();
    
    if (!model) {
      return { ok: false, reason: 'MODEL_NOT_FOUND' };
    }
    
    if (model.status !== 'SHADOW') {
      return { ok: false, reason: 'MODEL_NOT_SHADOW' };
    }
    
    if (model.eval?.verdict !== 'PASS') {
      return { ok: false, reason: 'MODEL_NOT_PASS' };
    }
    
    if (model.approvalStatus !== 'APPROVED') {
      return { ok: false, reason: 'MODEL_NOT_APPROVED' };
    }
    
    return { ok: true };
  }

  /**
   * Get model by ID
   */
  async getModel(modelId: string): Promise<GovernedModel | null> {
    // Validate ObjectId format
    if (!modelId || !modelId.match(/^[0-9a-fA-F]{24}$/)) {
      return null;
    }
    const model = await MlModelRegistryModel.findById(modelId).lean();
    return model as GovernedModel | null;
  }

  /**
   * Auto-request approval after shadow eval PASS
   * Called by shadow evaluation service
   */
  async autoRequestAfterPass(modelId: string): Promise<void> {
    try {
      await this.requestApproval(
        modelId,
        { id: 'SYSTEM', role: 'SYSTEM' },
        'Auto-requested after shadow PASS'
      );
    } catch (err: any) {
      if (err.message === 'MODEL_ALREADY_PENDING') {
        // Already pending, OK
        return;
      }
      console.error(`[Governance] Auto-request failed:`, err.message);
    }
  }

  /**
   * Transform model to pending item format
   */
  private toPendingItem(model: any): PendingApprovalItem {
    const featureMeta = model.featureMeta;
    const keptCount = featureMeta?.keptFeatures?.length || 0;
    const droppedCount = featureMeta?.droppedFeatures?.length || 0;
    
    return {
      modelId: model._id.toString(),
      task: model.modelType,
      network: model.network,
      version: model.version,
      stage: model.status,
      approvalStatus: model.approvalStatus || 'NONE',
      eval: model.eval || { verdict: 'NONE' },
      metrics: model.metrics || {},
      featureMeta: featureMeta ? {
        kept: keptCount,
        dropped: droppedCount,
        total: keptCount + droppedCount,
        pruningMode: featureMeta.pruning?.mode,
        weightingMode: featureMeta.weighting?.mode,
      } : undefined,
      createdAt: model.trainedAt || model.createdAt || new Date(),
      canPromote: model.approvalStatus === 'APPROVED' && model.eval?.verdict === 'PASS',
    };
  }

  /**
   * Log approval action to audit trail
   */
  async logAudit(params: {
    action: ApprovalAction;
    modelId: string;
    modelVersion: string;
    task: 'market' | 'actor';
    network: string;
    actor: { id: string; username: string; role: string };
    reason?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await ApprovalAuditModel.create({
        action: params.action,
        modelId: params.modelId,
        modelVersion: params.modelVersion,
        task: params.task,
        network: params.network,
        actor: params.actor,
        reason: params.reason,
        metadata: params.metadata,
      });
      console.log(`[Governance] Audit logged: ${params.action} for ${params.modelVersion}`);
    } catch (err: any) {
      console.error(`[Governance] Audit log failed:`, err.message);
    }
  }

  /**
   * Get approval history
   */
  async getHistory(filters?: { 
    task?: MlTask; 
    network?: string; 
    action?: ApprovalAction;
    limit?: number;
  }): Promise<any[]> {
    const query: any = {};
    
    if (filters?.task) query.task = filters.task;
    if (filters?.network) query.network = filters.network;
    if (filters?.action) query.action = filters.action;
    
    const limit = Math.min(filters?.limit || 50, 200);
    
    const history = await ApprovalAuditModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return history.map(h => ({
      id: h._id.toString(),
      createdAt: h.createdAt,
      action: h.action,
      modelVersion: h.modelVersion,
      task: h.task,
      network: h.network,
      actor: h.actor,
      reason: h.reason,
      metadata: h.metadata,
    }));
  }

  /**
   * Get all ACTIVE models
   */
  async listActiveModels(): Promise<ActiveModelSummary[]> {
    const models = await MlModelRegistryModel.find({ status: 'ACTIVE' })
      .sort({ activatedAt: -1 })
      .lean();
    
    return models.map(m => ({
      modelId: m._id.toString(),
      task: m.modelType as MlTask,
      network: m.network,
      version: m.version,
      metrics: m.metrics || {},
      promotedAt: m.trainedAt,
      activatedAt: m.activatedAt,
    }));
  }

  /**
   * Get rollback targets (ARCHIVED models)
   */
  async getRollbackTargets(task: MlTask, network?: string): Promise<any[]> {
    const query: any = { modelType: task, status: 'ARCHIVED' };
    if (network) query.network = network;
    
    const models = await MlModelRegistryModel.find(query)
      .sort({ deactivatedAt: -1 })
      .limit(20)
      .lean();
    
    return models.map(m => ({
      modelId: m._id.toString(),
      version: m.version,
      network: m.network,
      metrics: m.metrics || {},
      deactivatedAt: m.deactivatedAt,
    }));
  }
}

// Singleton instance
export const mlGovernanceService = new MlGovernanceService();
