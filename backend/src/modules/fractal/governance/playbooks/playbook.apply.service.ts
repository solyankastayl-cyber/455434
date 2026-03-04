/**
 * BLOCK 48.4 — Playbook Apply Service
 * Execute playbook decisions
 */

import mongoose from 'mongoose';
import {
  PlaybookDecision,
  PlaybookApplyRequest,
  PlaybookApplyResult,
  PlaybookHistoryEntry,
} from './playbook.types.js';
import { GovernanceMode } from '../guard.types.js';
import { updateGuardState, logGuardDecision } from '../guard.store.js';

// ═══════════════════════════════════════════════════════════════
// PLAYBOOK HISTORY MODEL
// ═══════════════════════════════════════════════════════════════

const PlaybookHistorySchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  type: { type: String, required: true },
  severity: { type: String, required: true },
  applied: { type: Boolean, default: false },
  actor: { type: String, required: true },
  reason: { type: String },
  appliedMode: { type: String },
  decision: { type: mongoose.Schema.Types.Mixed },
}, { collection: 'fractal_playbook_history' });

PlaybookHistorySchema.index({ symbol: 1, ts: -1 });

const PlaybookHistoryModel = mongoose.model('FractalPlaybookHistory', PlaybookHistorySchema);

// ═══════════════════════════════════════════════════════════════
// APPLY PLAYBOOK
// ═══════════════════════════════════════════════════════════════

export async function applyPlaybook(
  symbol: string,
  decision: PlaybookDecision,
  request: PlaybookApplyRequest
): Promise<PlaybookApplyResult> {
  
  // Check confirmation
  if (decision.requiresConfirmation && !request.confirm) {
    return {
      ok: false,
      applied: false,
      actionsExecuted: [],
      message: 'Confirmation required to apply this playbook',
    };
  }
  
  const actionsExecuted: string[] = [];
  let appliedMode: GovernanceMode | undefined;
  
  // Execute each action
  for (const action of decision.recommendedActions) {
    switch (action.type) {
      case 'SET_MODE': {
        const mode = action.payload?.mode as GovernanceMode;
        if (mode) {
          await updateGuardState(symbol, { mode }, 'ADMIN');
          appliedMode = mode;
          actionsExecuted.push(`Mode changed to ${mode}`);
        }
        break;
      }
      
      case 'FREEZE_VERSION': {
        // TODO: Implement version freeze
        actionsExecuted.push('Version frozen (pending implementation)');
        break;
      }
      
      case 'RESET_CALIBRATION': {
        // TODO: Call calibration reset
        actionsExecuted.push('Calibration reset initiated (pending implementation)');
        break;
      }
      
      case 'RAISE_CONFIDENCE_THRESHOLD':
      case 'RAISE_RELIABILITY_THRESHOLD':
      case 'LIMIT_EXPOSURE':
      case 'ENABLE_PROTECTION': {
        // These are applied through guard policy automatically
        actionsExecuted.push(`${action.type} - applied via guard policy`);
        break;
      }
      
      case 'RUN_VALIDATION':
      case 'RUN_MONTE_CARLO':
      case 'COMPARE_SHADOW': {
        // These are manual actions - just log
        actionsExecuted.push(`${action.type} - recommended manual action`);
        break;
      }
      
      case 'NO_ACTION': {
        actionsExecuted.push('No action taken');
        break;
      }
    }
  }
  
  // Log to history
  await PlaybookHistoryModel.create({
    symbol,
    ts: Date.now(),
    type: decision.type,
    severity: decision.severity,
    applied: true,
    actor: request.actor,
    reason: request.reason,
    appliedMode,
    decision,
  });
  
  // Also log to guard decisions for unified audit
  if (appliedMode) {
    await logGuardDecision(
      symbol,
      {
        recommendedMode: appliedMode,
        currentMode: appliedMode, // After apply
        reasons: [],
        degenerationScore: 0,
        catastrophicTriggered: false,
        latchUntil: null,
        confidence: 1,
        timestamp: Date.now(),
        wouldChange: false,
      },
      true,
      'ADMIN',
      `Playbook: ${decision.type} - ${request.reason || 'No reason provided'}`
    );
  }
  
  return {
    ok: true,
    applied: true,
    appliedMode,
    actionsExecuted,
    message: `Playbook ${decision.type} applied successfully`,
    auditRef: `playbook-${Date.now()}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getPlaybookHistory(
  symbol: string,
  options: { from?: number; to?: number; limit?: number } = {}
): Promise<PlaybookHistoryEntry[]> {
  const query: Record<string, unknown> = { symbol };
  
  if (options.from || options.to) {
    query.ts = {};
    if (options.from) (query.ts as Record<string, unknown>).$gte = options.from;
    if (options.to) (query.ts as Record<string, unknown>).$lte = options.to;
  }
  
  const docs = await PlaybookHistoryModel
    .find(query)
    .sort({ ts: -1 })
    .limit(options.limit || 100)
    .lean();
  
  return docs.map(doc => ({
    ts: doc.ts as number,
    type: doc.type as PlaybookHistoryEntry['type'],
    severity: doc.severity as PlaybookHistoryEntry['severity'],
    applied: doc.applied as boolean,
    actor: doc.actor as string,
    reason: doc.reason as string | undefined,
    appliedMode: doc.appliedMode as GovernanceMode | undefined,
  }));
}
