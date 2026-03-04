/**
 * AE/S-Brain v2 — Apply Brain Overrides
 * 
 * Applies Brain directives to Engine allocations.
 * Deterministic order: caps → haircuts → scales
 */

import { AssetId } from '../contracts/asset_state.contract.js';
import { BrainOutputPack, BrainDirectives } from '../contracts/brain_output.contract.js';

export interface EngineAllocation {
  size: number;
  direction?: string;
  source?: string;
}

export interface EngineOutput {
  allocations: Record<string, EngineAllocation>;
  cash?: number;
}

export interface AppliedEngineOutput extends EngineOutput {
  brainApplied: boolean;
  brainEvidence?: string[];
  originalAllocations?: Record<string, EngineAllocation>;
}

export class BrainOverrideApplyService {
  
  /**
   * Apply brain overrides to engine output
   * Order: caps → haircuts → scales → minCash
   */
  applyOverrides(
    engineOutput: EngineOutput,
    brainOutput: BrainOutputPack
  ): AppliedEngineOutput {
    const { directives } = brainOutput;
    
    // Save original
    const originalAllocations = JSON.parse(JSON.stringify(engineOutput.allocations));
    
    // Work on copy
    const result: AppliedEngineOutput = {
      ...engineOutput,
      allocations: { ...engineOutput.allocations },
      brainApplied: true,
      originalAllocations,
      brainEvidence: [],
    };
    
    // Step 1: Apply caps (hard limits)
    if (directives.caps) {
      for (const [asset, cap] of Object.entries(directives.caps)) {
        if (cap?.maxSize !== undefined && result.allocations[asset]) {
          const original = result.allocations[asset].size;
          result.allocations[asset].size = Math.min(original, cap.maxSize);
          if (result.allocations[asset].size < original) {
            result.brainEvidence?.push(
              `CAP: ${asset} ${original.toFixed(3)} → ${result.allocations[asset].size.toFixed(3)}`
            );
          }
        }
      }
    }
    
    // Step 2: Apply haircuts (multiplicative reduction)
    if (directives.haircuts) {
      for (const [asset, haircut] of Object.entries(directives.haircuts)) {
        if (haircut !== undefined && result.allocations[asset]) {
          const original = result.allocations[asset].size;
          result.allocations[asset].size = original * haircut;
          result.brainEvidence?.push(
            `HAIRCUT: ${asset} ×${haircut.toFixed(2)} (${original.toFixed(3)} → ${result.allocations[asset].size.toFixed(3)})`
          );
        }
      }
    }
    
    // Step 3: Apply scales (multiplicative adjustment)
    if (directives.scales) {
      for (const [asset, scale] of Object.entries(directives.scales)) {
        if (scale?.sizeScale !== undefined && result.allocations[asset]) {
          const original = result.allocations[asset].size;
          result.allocations[asset].size = Math.min(1, original * scale.sizeScale);
          result.brainEvidence?.push(
            `SCALE: ${asset} ×${scale.sizeScale.toFixed(2)} (${original.toFixed(3)} → ${result.allocations[asset].size.toFixed(3)})`
          );
        }
      }
    }
    
    // Step 4: Apply NO_TRADE flags
    if (directives.noTrade) {
      for (const [asset, noTrade] of Object.entries(directives.noTrade)) {
        if (noTrade && result.allocations[asset]) {
          result.allocations[asset].size = 0;
          result.brainEvidence?.push(`NO_TRADE: ${asset} → 0`);
        }
      }
    }
    
    // Step 5: Clamp all to [0, 1]
    for (const asset of Object.keys(result.allocations)) {
      result.allocations[asset].size = Math.max(0, Math.min(1, result.allocations[asset].size));
    }
    
    // Step 6: Recalculate cash if minCash specified
    if (directives.caps) {
      const totalMinCash = Object.values(directives.caps)
        .map(c => c?.minCash || 0)
        .reduce((a, b) => Math.max(a, b), 0);
      
      if (totalMinCash > 0) {
        const totalRisk = Object.values(result.allocations)
          .map(a => a.size)
          .reduce((a, b) => a + b, 0);
        
        if (totalRisk > (1 - totalMinCash)) {
          // Scale down proportionally
          const scaleFactor = (1 - totalMinCash) / totalRisk;
          for (const asset of Object.keys(result.allocations)) {
            result.allocations[asset].size *= scaleFactor;
          }
          result.brainEvidence?.push(
            `MIN_CASH: Scaled all by ×${scaleFactor.toFixed(2)} to ensure ${(totalMinCash * 100).toFixed(0)}% cash`
          );
        }
        
        result.cash = Math.max(result.cash || 0, totalMinCash);
      }
    }
    
    // Add risk mode to evidence
    if (directives.riskMode) {
      result.brainEvidence?.push(`RISK_MODE: ${directives.riskMode}`);
    }
    
    // Add warnings
    if (directives.warnings) {
      result.brainEvidence?.push(...directives.warnings.map(w => `WARNING: ${w}`));
    }
    
    return result;
  }
  
  /**
   * Check if overrides would change anything
   */
  wouldChangeAnything(
    engineOutput: EngineOutput,
    brainOutput: BrainOutputPack
  ): boolean {
    const applied = this.applyOverrides(engineOutput, brainOutput);
    
    for (const [asset, alloc] of Object.entries(applied.allocations)) {
      const original = engineOutput.allocations[asset];
      if (!original) continue;
      if (Math.abs(alloc.size - original.size) > 0.001) {
        return true;
      }
    }
    
    return false;
  }
}

// Singleton
let instance: BrainOverrideApplyService | null = null;

export function getBrainOverrideApplyService(): BrainOverrideApplyService {
  if (!instance) {
    instance = new BrainOverrideApplyService();
  }
  return instance;
}
