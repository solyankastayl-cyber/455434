/**
 * P9.1 — Brain Compare Service
 * 
 * Compares engine allocations with Brain OFF vs Brain ON.
 * Builds delta, reasons, severity, context.
 */

import * as crypto from 'crypto';
import {
  BrainComparePack,
  AllocationSnapshot,
  DirectiveDetail,
  ChangedField,
  Severity,
} from '../contracts/brain_compare.contract.js';
import { getBrainOrchestratorService } from './brain_orchestrator.service.js';
import { getWorldStateService } from './world_state.service.js';
import { buildEngineGlobal } from '../../engine-global/engine_global.service.js';
import { getEngineGlobalWithBrain } from '../../engine-global/engine_global_brain_bridge.service.js';

const EPSILON = 0.002;

export class BrainCompareService {

  /**
   * Compare Brain OFF vs Brain ON for a given date
   */
  async compare(asOf: string): Promise<BrainComparePack> {
    // 1. Get engine output WITHOUT brain
    const engineOff = await buildEngineGlobal(asOf);
    const offAllocations = this.extractAllocations(engineOff);

    // 2. Get engine output WITH brain (no optimizer)
    const engineOn = await getEngineGlobalWithBrain({ asOf, brain: true, brainMode: 'on' });
    const onAllocations = this.extractAllocations(engineOn);
    
    // 2.1 Get engine output WITH brain + optimizer
    const engineOnOpt = await getEngineGlobalWithBrain({ asOf, brain: true, brainMode: 'on', optimizer: true });
    const onOptAllocations = this.extractAllocations(engineOnOpt);

    // 3. Get brain decision for context
    const brainService = getBrainOrchestratorService();
    const decision = await brainService.computeDecision(asOf, true);

    // 4. Build diff
    const delta = {
      spx: round4(onAllocations.spxSize - offAllocations.spxSize),
      btc: round4(onAllocations.btcSize - offAllocations.btcSize),
      cash: round4(onAllocations.cashSize - offAllocations.cashSize),
    };
    
    // 4.1 Calculate optimizer delta (separate)
    const optimizerDelta = {
      spx: round4(onOptAllocations.spxSize - onAllocations.spxSize),
      btc: round4(onOptAllocations.btcSize - onAllocations.btcSize),
      cash: round4(onOptAllocations.cashSize - onAllocations.cashSize),
    };
    const optimizerDeltaAbs = round4(Math.max(
      Math.abs(optimizerDelta.spx),
      Math.abs(optimizerDelta.btc)
    ));

    const changed = this.buildChangedFields(offAllocations, onAllocations, decision);
    const severity = this.computeSeverity(delta);
    const inputsHash = this.computeHash(asOf, offAllocations, onAllocations);
    const diffHash = this.computeHash(asOf + '_diff', delta, changed);

    // 5. Extract directives as structured list
    const directives = this.extractDirectives(decision);

    // 6. Context
    const worldService = getWorldStateService();
    const world = await worldService.buildWorldState(asOf);

    const context: BrainComparePack['context'] = {
      crossAsset: world.crossAsset ? {
        label: world.crossAsset.regime.label,
        confidence: world.crossAsset.regime.confidence,
      } : undefined,
      macro: {
        regime: world.assets.dxy?.macroV2?.regime?.name || 'UNKNOWN',
        confidence: world.assets.dxy?.macroV2?.confidence || 0,
        activeEngine: 'v2',
      },
      guard: {
        level: world.assets.dxy?.guard?.level || 'NONE',
      },
      liquidity: {
        regime: world.assets.dxy?.liquidity?.regime || 'NEUTRAL',
      },
    };
    
    // 7. Extract override intensity breakdown
    const overrideIntensity = (engineOnOpt as any).brain?.overrideIntensity || {
      brain: 0,
      metaRiskScale: 0,
      optimizer: 0,
      total: 0,
      cap: 0.35,
      withinCap: true,
    };

    return {
      asOf,
      inputsHash,
      base: {
        engineMode: 'brain_off',
        allocations: offAllocations,
        evidence: engineOff.evidence?.headline,
      },
      brain: {
        engineMode: 'brain_on',
        allocations: onAllocations,
        decision: {
          scenario: decision.scenario.name,
          probabilities: {
            base: decision.scenario.probs.BASE,
            risk: decision.scenario.probs.RISK,
            tail: decision.scenario.probs.TAIL,
          },
          directives,
          evidence: decision.evidence,
        },
      },
      diff: {
        allocationsDelta: delta,
        optimizerDelta,
        optimizerDeltaAbs,
        overrideIntensity,
        changed,
        severity,
        diffHash,
      },
      context,
    };
  }

  // ─────────────────────────────────────────────────────────

  private extractAllocations(engine: any): AllocationSnapshot {
    const alloc = engine?.allocations || {};
    const rawSpx = alloc.spxSize || 0;
    const rawBtc = alloc.btcSize || 0;
    const rawCash = alloc.cashSize || 0;
    
    // Normalize (Engine may return unnormalized allocations)
    const sum = rawSpx + rawBtc + rawCash || 1;
    return {
      spxSize: clamp01(rawSpx / sum),
      btcSize: clamp01(rawBtc / sum),
      cashSize: clamp01(rawCash / sum),
    };
  }

  private buildChangedFields(
    off: AllocationSnapshot,
    on: AllocationSnapshot,
    decision: any
  ): ChangedField[] {
    const changed: ChangedField[] = [];
    const fields: ('spxSize' | 'btcSize' | 'cashSize')[] = ['spxSize', 'btcSize', 'cashSize'];
    const warnings: string[] = decision.directives?.warnings || [];
    const reasoning = (decision as any).overrideReasoning;

    for (const field of fields) {
      const from = off[field];
      const to = on[field];
      const delta = round4(to - from);

      if (Math.abs(delta) <= EPSILON) continue;

      const reasons: string[] = [];
      const sources: string[] = [];

      // Extract relevant reasons from warnings
      for (const w of warnings) {
        if (field.startsWith('btc') && (w.includes('BTC') || w.includes('btc'))) {
          reasons.push(w);
        } else if (field.startsWith('spx') && (w.includes('SPX') || w.includes('spx'))) {
          reasons.push(w);
        } else if (field === 'cashSize') {
          reasons.push(w);
        }
      }

      // Add scenario-based reasons
      if (decision.scenario?.name === 'TAIL') {
        sources.push('QUANTILE:TAIL_PROB>0.35');
        if (reasons.length === 0) reasons.push(`TAIL scenario (${(decision.scenario.probs.TAIL * 100).toFixed(0)}%) → risk reduction`);
      }
      if (decision.scenario?.name === 'RISK') {
        sources.push('QUANTILE:RISK_ELEVATED');
        if (reasons.length === 0) reasons.push(`RISK scenario → moderate risk reduction`);
      }

      // Cross-asset reasons
      if (reasoning?.crossAssetOverride) {
        sources.push(`CROSS_ASSET:${reasoning.crossAssetOverride.regime}`);
        reasons.push(reasoning.crossAssetOverride.action);
      }

      // Tail amplification
      if (reasoning?.tailAmplified) {
        sources.push('QUANTILE:TAIL_AMPLIFICATION');
      }
      // Bull extension
      if (reasoning?.bullExtension) {
        sources.push('QUANTILE:BULL_EXTENSION');
      }

      if (reasons.length === 0) reasons.push(`Brain ${decision.scenario?.name} adjustment`);
      if (sources.length === 0) sources.push(`BRAIN:${decision.scenario?.name}`);

      changed.push({ field, from: round4(from), to: round4(to), delta, reasons, sources });
    }

    return changed;
  }

  private extractDirectives(decision: any): DirectiveDetail[] {
    const directives: DirectiveDetail[] = [];
    const d = decision.directives;
    if (!d) return directives;

    // Caps
    for (const [target, cap] of Object.entries(d.caps || {})) {
      const c = cap as any;
      if (c?.maxSize !== undefined) {
        directives.push({ type: 'CAP', target, value: c.maxSize, reason: `Cap ${target} to ${c.maxSize}` });
      }
    }

    // Haircuts
    for (const [target, haircut] of Object.entries(d.haircuts || {})) {
      directives.push({ type: 'HAIRCUT', target, value: haircut as number, reason: `Haircut ${target} × ${haircut}` });
    }

    // Scales
    for (const [target, scale] of Object.entries(d.scales || {})) {
      const s = scale as any;
      if (s?.sizeScale !== undefined) {
        directives.push({ type: 'SCALE', target, value: s.sizeScale, reason: `Scale ${target} × ${s.sizeScale}` });
      }
    }

    return directives;
  }

  private computeSeverity(delta: { spx: number; btc: number; cash: number }): Severity {
    const maxDelta = Math.max(Math.abs(delta.spx), Math.abs(delta.btc), Math.abs(delta.cash));
    if (maxDelta > 0.25) return 'HIGH';
    if (maxDelta > 0.10) return 'MEDIUM';
    if (maxDelta > 0.02) return 'LOW';
    return 'NONE';
  }

  private computeHash(prefix: string, ...parts: any[]): string {
    const s = JSON.stringify({ prefix, parts });
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// Singleton
let instance: BrainCompareService | null = null;

export function getBrainCompareService(): BrainCompareService {
  if (!instance) instance = new BrainCompareService();
  return instance;
}
