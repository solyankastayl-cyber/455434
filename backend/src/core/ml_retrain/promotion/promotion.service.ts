/**
 * BATCH 4: Promotion Service
 * 
 * Безопасный перевод SHADOW → ACTIVE и откат.
 * 
 * Promotion разрешён ТОЛЬКО если:
 * - есть verdict = PASS для этой модели
 * - модель сейчас в статусе SHADOW
 * - GOVERNANCE: approvalStatus = APPROVED
 * 
 * Rollback возможен к:
 * - предыдущей ACTIVE (последней ARCHIVED)
 * - или конкретной версии
 */

import { MlModelRegistryModel } from '../ml_model_registry.model.js';
import { ShadowComparisonModel } from '../shadow/ml_shadow_comparison.model.js';
import { broadcastAdminEvent } from '../../admin/admin.events.js';

export type PromotionResult = {
  ok: boolean;
  active?: string;
  previous?: string;
  error?: string;
};

export class PromotionService {
  
  /**
   * Promote SHADOW model to ACTIVE
   * Requires: verdict = PASS AND approvalStatus = APPROVED
   */
  static async promote(
    task: 'market' | 'actor',
    modelVersion: string
  ): Promise<PromotionResult> {
    console.log(`[Promotion] Attempting to promote ${task}/${modelVersion}`);
    
    // 1) Check for PASS verdict
    const verdict = await ShadowComparisonModel.findOne({
      task,
      shadowModelVersion: modelVersion,
      'verdict.status': 'PASS',
    }).sort({ createdAtTs: -1 });

    if (!verdict) {
      console.warn(`[Promotion] No PASS verdict found for ${modelVersion}`);
      return {
        ok: false,
        error: 'NO_PASS_VERDICT',
      };
    }

    // 2) Find the model to promote
    const shadowModel = await MlModelRegistryModel.findOne({
      modelType: task,
      version: modelVersion,
    });

    if (!shadowModel) {
      return {
        ok: false,
        error: 'MODEL_NOT_FOUND',
      };
    }

    if (shadowModel.status !== 'SHADOW') {
      return {
        ok: false,
        error: `MODEL_NOT_SHADOW: current status is ${shadowModel.status}`,
      };
    }

    // GOVERNANCE: Check approval status
    if (shadowModel.approvalStatus !== 'APPROVED') {
      console.warn(`[Promotion] Model not approved: ${modelVersion} (status: ${shadowModel.approvalStatus})`);
      return {
        ok: false,
        error: `MODEL_NOT_APPROVED: approval status is ${shadowModel.approvalStatus || 'NONE'}`,
      };
    }

    // 3) Archive current ACTIVE (if exists)
    const currentActive = await MlModelRegistryModel.findOne({
      modelType: task,
      status: 'ACTIVE',
    });

    const previousVersion = currentActive?.version;

    if (currentActive) {
      currentActive.status = 'ARCHIVED';
      currentActive.deactivatedAt = Date.now();
      await currentActive.save();
      console.log(`[Promotion] Archived previous ACTIVE: ${currentActive.version}`);
    }

    // 4) Promote SHADOW to ACTIVE
    shadowModel.status = 'ACTIVE';
    shadowModel.activatedAt = Date.now();
    shadowModel.promotedFrom = previousVersion;
    await shadowModel.save();

    console.log(`[Promotion] Promoted ${modelVersion} to ACTIVE`);

    // 5) Emit WS event
    broadcastAdminEvent({
      type: 'MODEL_PROMOTED',
      meta: {
        task,
        modelVersion,
        previousVersion,
        verdictId: verdict._id.toString(),
      },
      timestamp: Date.now(),
    });

    return {
      ok: true,
      active: modelVersion,
      previous: previousVersion,
    };
  }

  /**
   * Rollback to previous ACTIVE model
   * If toVersion not specified, uses last ARCHIVED model
   */
  static async rollback(
    task: 'market' | 'actor',
    toVersion?: string
  ): Promise<PromotionResult> {
    console.log(`[Rollback] Attempting rollback for ${task}${toVersion ? ` to ${toVersion}` : ''}`);

    // 1) Find current ACTIVE
    const currentActive = await MlModelRegistryModel.findOne({
      modelType: task,
      status: 'ACTIVE',
    });

    if (!currentActive) {
      return {
        ok: false,
        error: 'NO_ACTIVE_MODEL',
      };
    }

    // 2) Find target model
    let targetModel;
    
    if (toVersion) {
      // Specific version requested
      targetModel = await MlModelRegistryModel.findOne({
        modelType: task,
        version: toVersion,
      });
      
      if (!targetModel) {
        return {
          ok: false,
          error: `TARGET_NOT_FOUND: ${toVersion}`,
        };
      }
    } else {
      // Use last ARCHIVED model
      targetModel = await MlModelRegistryModel.findOne({
        modelType: task,
        status: 'ARCHIVED',
      }).sort({ deactivatedAt: -1 });

      if (!targetModel) {
        return {
          ok: false,
          error: 'NO_ROLLBACK_TARGET',
        };
      }
    }

    const fromVersion = currentActive.version;
    const targetVersion = targetModel.version;

    // 3) Archive current ACTIVE
    currentActive.status = 'ARCHIVED';
    currentActive.deactivatedAt = Date.now();
    await currentActive.save();

    // 4) Restore target to ACTIVE
    targetModel.status = 'ACTIVE';
    targetModel.activatedAt = Date.now();
    targetModel.rollbackOf = fromVersion;
    await targetModel.save();

    console.log(`[Rollback] Rolled back from ${fromVersion} to ${targetVersion}`);

    // 5) Emit WS event
    broadcastAdminEvent({
      type: 'MODEL_ROLLBACK',
      meta: {
        task,
        fromVersion,
        toVersion: targetVersion,
      },
      timestamp: Date.now(),
    });

    return {
      ok: true,
      active: targetVersion,
      previous: fromVersion,
    };
  }

  /**
   * Get current ACTIVE model version
   */
  static async getActiveVersion(task: 'market' | 'actor'): Promise<string | null> {
    const active = await MlModelRegistryModel.findOne({
      modelType: task,
      status: 'ACTIVE',
    });
    return active?.version || null;
  }

  /**
   * Get promotion candidates (SHADOW models with PASS verdict)
   */
  static async getCandidates(task: 'market' | 'actor') {
    // Get all SHADOW models
    const shadowModels = await MlModelRegistryModel.find({
      modelType: task,
      status: 'SHADOW',
    }).lean();

    // Check which ones have PASS verdict
    const candidates = [];
    
    for (const model of shadowModels) {
      const verdict = await ShadowComparisonModel.findOne({
        task,
        shadowModelVersion: model.version,
        'verdict.status': 'PASS',
      }).sort({ createdAtTs: -1 }).lean();

      candidates.push({
        version: model.version,
        metrics: model.metrics,
        trainedAt: model.trainedAt,
        hasPassVerdict: !!verdict,
        verdictCreatedAt: verdict?.createdAtTs,
        canPromote: !!verdict,
      });
    }

    return {
      ok: true,
      task,
      candidates,
    };
  }

  /**
   * Get rollback targets (ARCHIVED models)
   */
  static async getRollbackTargets(task: 'market' | 'actor') {
    const archived = await MlModelRegistryModel.find({
      modelType: task,
      status: 'ARCHIVED',
    })
      .sort({ deactivatedAt: -1 })
      .limit(10)
      .lean();

    return {
      ok: true,
      task,
      targets: archived.map(m => ({
        version: m.version,
        metrics: m.metrics,
        activatedAt: m.activatedAt,
        deactivatedAt: m.deactivatedAt,
      })),
    };
  }
}
