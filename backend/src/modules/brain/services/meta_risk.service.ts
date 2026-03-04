/**
 * P10.2 — MetaRisk Service
 * 
 * Computes MetaRiskPack from Regime Memory + Brain Scenario.
 * Provides institutional aggression/defense scaling.
 */

import { 
  MetaRiskPack, 
  MetaRiskInputs,
  calculateMetaRisk,
} from '../contracts/meta_risk.contract.js';
import { getRegimeMemoryService } from './regime_memory.service.js';

export class MetaRiskService {

  /**
   * Get MetaRiskPack for given asOf date
   * Note: Does NOT call Brain to avoid circular dependency.
   * Brain scenario is passed in externally when needed.
   */
  async getMetaRisk(asOf?: string, brainScenario?: MetaRiskInputs['brainScenario']): Promise<MetaRiskPack> {
    const targetDate = asOf || new Date().toISOString().split('T')[0];
    
    // 1. Get regime memory state
    const regimeMemory = await getRegimeMemoryService().getCurrent(targetDate);
    
    // 2. Brain scenario is now passed in (no circular call)
    
    // 3. Build inputs
    const inputs: MetaRiskInputs = {
      macro: {
        regime: regimeMemory.macro.current,
        daysInState: regimeMemory.macro.daysInState,
        stability: regimeMemory.macro.stability,
        flips30d: regimeMemory.macro.flips30d,
      },
      guard: {
        level: regimeMemory.guard.current,
        daysInState: regimeMemory.guard.daysInState,
        stability: regimeMemory.guard.stability,
        flips30d: regimeMemory.guard.flips30d,
      },
      crossAsset: {
        regime: regimeMemory.crossAsset.current,
        daysInState: regimeMemory.crossAsset.daysInState,
        stability: regimeMemory.crossAsset.stability,
        flips30d: regimeMemory.crossAsset.flips30d,
      },
      brainScenario,
    };
    
    // 4. Calculate MetaRisk
    return calculateMetaRisk(inputs, targetDate);
  }

  /**
   * Get MetaRisk with forced scenario override (for stress testing)
   */
  async getMetaRiskWithOverrides(
    asOf: string, 
    overrides: {
      macroRegime?: string;
      guardLevel?: string;
      crossAssetRegime?: string;
      scenario?: string;
      flips30d?: number;
    }
  ): Promise<MetaRiskPack> {
    const targetDate = asOf || new Date().toISOString().split('T')[0];
    
    // Get base regime memory
    const regimeMemory = await getRegimeMemoryService().getCurrent(targetDate);
    
    // Build inputs with overrides
    const inputs: MetaRiskInputs = {
      macro: {
        regime: overrides.macroRegime || regimeMemory.macro.current,
        daysInState: regimeMemory.macro.daysInState,
        stability: regimeMemory.macro.stability,
        flips30d: overrides.flips30d ?? regimeMemory.macro.flips30d,
      },
      guard: {
        level: overrides.guardLevel || regimeMemory.guard.current,
        daysInState: regimeMemory.guard.daysInState,
        stability: regimeMemory.guard.stability,
        flips30d: overrides.flips30d ?? regimeMemory.guard.flips30d,
      },
      crossAsset: {
        regime: overrides.crossAssetRegime || regimeMemory.crossAsset.current,
        daysInState: regimeMemory.crossAsset.daysInState,
        stability: regimeMemory.crossAsset.stability,
        flips30d: overrides.flips30d ?? regimeMemory.crossAsset.flips30d,
      },
      brainScenario: overrides.scenario ? {
        scenario: overrides.scenario,
        pTail: overrides.scenario === 'TAIL' ? 0.6 : (overrides.scenario === 'RISK' ? 0.4 : 0.1),
        pRisk: overrides.scenario === 'RISK' ? 0.5 : 0.2,
      } : undefined,
    };
    
    return calculateMetaRisk(inputs, targetDate);
  }

  /**
   * Timeline of MetaRisk over date range
   */
  async getTimeline(start: string, end: string, stepDays: number = 7): Promise<{
    start: string;
    end: string;
    stepDays: number;
    points: Array<{
      asOf: string;
      metaRiskScale: number;
      posture: string;
      maxOverrideCap: number;
    }>;
    summary: {
      avgScale: number;
      minScale: number;
      maxScale: number;
      dominantPosture: string;
    };
  }> {
    const dates = this.generateDates(start, end, stepDays);
    const points: Array<{
      asOf: string;
      metaRiskScale: number;
      posture: string;
      maxOverrideCap: number;
    }> = [];
    
    const postureCounts: Record<string, number> = {};
    let scaleSum = 0;
    let minScale = 2;
    let maxScale = 0;
    
    for (const asOf of dates.slice(0, 50)) { // Limit for performance
      try {
        const pack = await this.getMetaRisk(asOf);
        points.push({
          asOf,
          metaRiskScale: pack.metaRiskScale,
          posture: pack.posture,
          maxOverrideCap: pack.maxOverrideCap,
        });
        
        scaleSum += pack.metaRiskScale;
        minScale = Math.min(minScale, pack.metaRiskScale);
        maxScale = Math.max(maxScale, pack.metaRiskScale);
        postureCounts[pack.posture] = (postureCounts[pack.posture] || 0) + 1;
      } catch (e) {
        console.warn(`[MetaRisk] Timeline error at ${asOf}:`, (e as Error).message);
      }
    }
    
    const n = points.length || 1;
    
    // Find dominant posture
    let dominantPosture = 'NEUTRAL';
    let maxCount = 0;
    for (const [p, c] of Object.entries(postureCounts)) {
      if (c > maxCount) {
        dominantPosture = p;
        maxCount = c;
      }
    }
    
    return {
      start,
      end,
      stepDays,
      points,
      summary: {
        avgScale: Math.round((scaleSum / n) * 1000) / 1000,
        minScale: minScale < 2 ? minScale : 0,
        maxScale,
        dominantPosture,
      },
    };
  }

  private generateDates(start: string, end: string, stepDays: number): string[] {
    const dates: string[] = [];
    let current = new Date(start);
    const endDate = new Date(end);
    
    while (current <= endDate && dates.length < 200) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + stepDays);
    }
    
    return dates;
  }
}

// Singleton
let instance: MetaRiskService | null = null;

export function getMetaRiskService(): MetaRiskService {
  if (!instance) {
    instance = new MetaRiskService();
  }
  return instance;
}
