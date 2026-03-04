/**
 * MACRO ENGINE ROUTER — Auto/Manual switching between V1 and V2
 * 
 * V1 = Baseline (stable, production-proven)
 * V2 = Challenger (Markov + Gold, experimental)
 * 
 * Rules:
 * - Default: V1
 * - Auto-switch to V2 if conditions met
 * - Feature flag override: MACRO_ENGINE=v1|v2|auto
 */

import {
  IMacroEngine,
  MacroPack,
  MacroEngineVersion,
  MacroEngineConfig,
  DEFAULT_ENGINE_CONFIG,
  MacroHorizon,
  MacroPathPoint,
  MacroRegime,
} from '../interfaces/macro_engine.interface.js';
import { getMacroEngineV1 } from '../v1/macro_engine_v1.service.js';
import { getMacroEngineV2 } from '../v2/macro_engine_v2.service.js';

// ═══════════════════════════════════════════════════════════════
// ENGINE ROUTER
// ═══════════════════════════════════════════════════════════════

export class MacroEngineRouter {
  private config: MacroEngineConfig;
  private overrideVersion: MacroEngineVersion | 'auto' | null = null;
  
  constructor(config: MacroEngineConfig = DEFAULT_ENGINE_CONFIG) {
    this.config = config;
    
    // Check env override
    const envEngine = process.env.MACRO_ENGINE?.toLowerCase();
    if (envEngine === 'v1' || envEngine === 'v2' || envEngine === 'auto') {
      this.overrideVersion = envEngine;
    }
  }
  
  /**
   * Get the active engine based on config and conditions
   */
  async getActiveEngine(): Promise<{ engine: IMacroEngine; reason: string }> {
    // Manual override
    if (this.overrideVersion === 'v1') {
      return { engine: getMacroEngineV1(), reason: 'ENV_OVERRIDE_V1' };
    }
    if (this.overrideVersion === 'v2') {
      return { engine: getMacroEngineV2(), reason: 'ENV_OVERRIDE_V2' };
    }
    
    // Auto mode
    if (this.overrideVersion === 'auto' || this.config.autoSwitch) {
      const v2Ready = await this.checkV2Readiness();
      
      if (v2Ready.ready) {
        return { engine: getMacroEngineV2(), reason: 'AUTO_V2_READY' };
      } else {
        return { engine: getMacroEngineV1(), reason: `FALLBACK_V1: ${v2Ready.reason}` };
      }
    }
    
    // Default
    if (this.config.defaultEngine === 'v2') {
      return { engine: getMacroEngineV2(), reason: 'CONFIG_DEFAULT_V2' };
    }
    
    return { engine: getMacroEngineV1(), reason: 'CONFIG_DEFAULT_V1' };
  }
  
  /**
   * Check if V2 is ready for use
   */
  async checkV2Readiness(): Promise<{ ready: boolean; reason: string; warnings?: string[] }> {
    try {
      const v2 = getMacroEngineV2();
      const health = await v2.healthCheck();
      
      // Critical issues block V2
      if (!health.ok) {
        return { ready: false, reason: `V2 health issues: ${health.issues.join(', ')}` };
      }
      
      // Get regime state to check confidence
      const state = await v2.getRegimeState();
      
      if (state.confidence < this.config.v2MinConfidence) {
        return { ready: false, reason: `V2 confidence too low: ${state.confidence}` };
      }
      
      // Warnings don't block V2 but are reported
      const warnings = (health as any).warnings || [];
      return { ready: true, reason: 'V2 passed all checks', warnings };
      
    } catch (e) {
      return { ready: false, reason: `V2 error: ${(e as any).message}` };
    }
  }
  
  /**
   * Compute macro pack using active engine
   */
  async computePack(params: {
    asset: 'DXY' | 'SPX' | 'BTC';
    horizon: MacroHorizon;
    hybridEndReturn: number;
    hybridPath?: MacroPathPoint[];
  }): Promise<MacroPack & { router: { mode: string; chosen: string; fallbackFrom?: string; reason: string } }> {
    const { engine, reason } = await this.getActiveEngine();
    
    const pack = await engine.computePack(params);
    
    const mode = this.overrideVersion || (this.config.autoSwitch ? 'auto' : this.config.defaultEngine);
    const isV2Fallback = engine.version === 'v1' && reason.includes('FALLBACK');
    
    return {
      ...pack,
      router: {
        mode,
        chosen: engine.version,
        ...(isV2Fallback ? { fallbackFrom: 'v2' } : {}),
        reason,
      },
      // Keep backward compat
      routerInfo: {
        activeEngine: engine.version,
        reason,
      },
    } as any;
  }
  
  /**
   * Force specific engine version (for testing)
   */
  forceEngine(version: MacroEngineVersion | 'auto'): void {
    this.overrideVersion = version;
  }
  
  /**
   * Reset to config defaults
   */
  resetOverride(): void {
    this.overrideVersion = null;
  }
  
  /**
   * Get both engines for comparison (shadow mode)
   */
  async comparePacks(params: {
    asset: 'DXY' | 'SPX' | 'BTC';
    horizon: MacroHorizon;
    hybridEndReturn: number;
    hybridPath?: MacroPathPoint[];
  }): Promise<{
    v1: MacroPack;
    v2: MacroPack;
    comparison: {
      scoreDiff: number;
      regimeSame: boolean;
      deltaReturn: { v1: number; v2: number; diff: number };
    };
  }> {
    const v1Engine = getMacroEngineV1();
    const v2Engine = getMacroEngineV2();
    
    const [v1Pack, v2Pack] = await Promise.all([
      v1Engine.computePack(params),
      v2Engine.computePack(params),
    ]);
    
    // Compute comparison metrics
    const scoreDiff = v2Pack.drivers.scoreSigned - v1Pack.drivers.scoreSigned;
    const regimeSame = v1Pack.regime.dominant === v2Pack.regime.dominant;
    
    const v1Delta = v1Pack.overlay.horizons.find(h => h.horizon === params.horizon)?.delta || 0;
    const v2Delta = v2Pack.overlay.horizons.find(h => h.horizon === params.horizon)?.delta || 0;
    
    return {
      v1: v1Pack,
      v2: v2Pack,
      comparison: {
        scoreDiff: Math.round(scoreDiff * 10000) / 10000,
        regimeSame,
        deltaReturn: {
          v1: Math.round(v1Delta * 10000) / 10000,
          v2: Math.round(v2Delta * 10000) / 10000,
          diff: Math.round((v2Delta - v1Delta) * 10000) / 10000,
        },
      },
    };
  }
  
  /**
   * Get router status
   */
  getStatus(): {
    config: MacroEngineConfig;
    override: MacroEngineVersion | 'auto' | null;
    envSetting: string | undefined;
  } {
    return {
      config: this.config,
      override: this.overrideVersion,
      envSetting: process.env.MACRO_ENGINE,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let routerInstance: MacroEngineRouter | null = null;

export function getMacroEngineRouter(): MacroEngineRouter {
  if (!routerInstance) {
    routerInstance = new MacroEngineRouter();
  }
  return routerInstance;
}

export function resetMacroEngineRouter(): void {
  routerInstance = null;
}
