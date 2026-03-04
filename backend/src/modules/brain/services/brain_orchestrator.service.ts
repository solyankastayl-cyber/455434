/**
 * AE/S-Brain v2 + P8.0-C — Brain Orchestrator
 * 
 * Main intelligence layer. New flow:
 *   WorldState → Quantile Forecast (MoE) → Scenario Engine → Risk Engine → Directives
 * 
 * Guard always has absolute priority over forecast-driven rules.
 */

import { WorldStatePack } from '../contracts/world_state.contract.js';
import {
  BrainOutputPack,
  BrainDirectives,
  BrainEvidence,
  ScenarioPack,
} from '../contracts/brain_output.contract.js';
import { AssetId } from '../contracts/asset_state.contract.js';
import { getWorldStateService } from './world_state.service.js';
import { getForecastPipelineService } from '../ml/services/forecast_pipeline.service.js';
import {
  computeForecastScenario,
  computeForecastOverrides,
  OverrideReasoning,
} from './brain_quantile_rules.service.js';
import { QuantileForecastResponse } from '../ml/contracts/quantile_forecast.contract.js';
import { CrossAssetPack, CrossAssetRegime } from '../contracts/cross_asset.contract.js';

export class BrainOrchestratorService {
  
  /**
   * Simplified getDecision for external services (MetaRisk, etc.)
   */
  async getDecision(asOf: string): Promise<BrainOutputPack | null> {
    try {
      return await this.computeDecision(asOf, false);
    } catch (e) {
      console.warn('[Brain] getDecision failed:', (e as Error).message);
      return null;
    }
  }
  
  /**
   * Main entry: compute Brain decision
   * @param withForecast - include full forecast in response (for debug)
   */
  async computeDecision(asOf: string, withForecast: boolean = false): Promise<BrainOutputPack> {
    const startTime = Date.now();
    
    // 1. Get world state
    const worldService = getWorldStateService();
    const world = await worldService.buildWorldState(asOf);
    
    // 2. Get quantile forecast from MoE pipeline
    let forecast: QuantileForecastResponse | null = null;
    try {
      const pipeline = getForecastPipelineService();
      forecast = await pipeline.generateForecast('dxy', asOf);
    } catch (e) {
      console.warn('[Brain] Forecast unavailable, using legacy rules:', (e as Error).message);
    }
    
    let scenario: ScenarioPack;
    let directives: BrainDirectives;
    let overrideReasoning: OverrideReasoning | undefined;
    let scenarioDiagnostics: any = undefined;  // P12.0
    
    if (forecast) {
      // P8.0-C: New forecast-driven flow
      // P12.0: Now with Sanity Layer
      const scenarioResult = computeForecastScenario(forecast, world);
      scenario = scenarioResult.scenario;
      overrideReasoning = scenarioResult.reasoning;
      scenarioDiagnostics = scenarioResult.diagnostics;  // P12.0
      directives = computeForecastOverrides(forecast, world, scenario, overrideReasoning);
      
      // P9.0: Cross-asset correlation overrides
      if (world.crossAsset) {
        this.applyCrossAssetOverrides(world.crossAsset, directives, overrideReasoning, scenario);
      }
    } else {
      // Legacy rule-based fallback (pre-P8.0-C)
      scenario = this.computeLegacyScenario(world);
      directives = this.computeLegacyDirectives(world, scenario);
    }
    
    // 3. Build evidence (enriched with forecast data)
    const evidence = this.buildEvidence(world, scenario, directives, forecast, overrideReasoning);
    
    // Note: MetaRisk is now computed separately in engine_global_brain_bridge
    // to avoid circular dependency
    
    // 4. Build response
    const output: BrainOutputPack = {
      asOf,
      scenario,
      scenarioDiagnostics,  // P12.0: Include diagnostics for transparency
      directives,
      evidence,
      meta: {
        engineVersion: 'v2',
        brainVersion: forecast ? 'v2.1.0-moe-sanity' : 'v2.0.0-legacy',  // P12.0 version bump
        computeTimeMs: Date.now() - startTime,
        inputsHash: world.meta.inputsHash,
        // MetaRisk fields will be added by engine bridge
      },
    };
    
    // Optionally include forecasts
    if (withForecast && forecast) {
      output.forecasts = {
        dxy: {
          byHorizon: forecast.byHorizon,
        },
      };
      // Attach override reasoning for debug
      (output as any).overrideReasoning = overrideReasoning;
      (output as any).forecastMeta = {
        modelVersion: forecast.model.modelVersion,
        isBaseline: forecast.model.isBaseline,
        trainedAt: forecast.model.trainedAt,
        regime: forecast.regime,
      };
      // P9.0: Cross-asset data
      if (world.crossAsset) {
        (output as any).crossAsset = {
          regime: world.crossAsset.regime,
          diagnostics: world.crossAsset.diagnostics,
          keyCorrs: world.crossAsset.evidence.keyCorrs,
        };
      }
    }
    
    return output;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // P9.0: CROSS-ASSET CORRELATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════
  
  private applyCrossAssetOverrides(
    crossAsset: CrossAssetPack,
    directives: BrainDirectives,
    reasoning: OverrideReasoning,
    scenario: ScenarioPack
  ): void {
    const regime = crossAsset.regime.label;
    const confidence = crossAsset.regime.confidence;
    
    // Only apply if confidence is decent
    if (confidence < 0.3) return;
    
    switch (regime) {
      case 'RISK_OFF_SYNC':
        // Strengthen risk-off: BTC haircut stronger
        const existingBtcHaircut = directives.haircuts?.btc ?? 1;
        directives.haircuts = {
          ...directives.haircuts,
          btc: Math.min(existingBtcHaircut, 0.85),
        };
        directives.warnings!.push(`CROSS-ASSET: RISK_OFF_SYNC → extra BTC haircut (conf=${confidence.toFixed(2)})`);
        (reasoning as any).crossAssetOverride = { regime, action: 'BTC haircut 0.85' };
        break;
        
      case 'FLIGHT_TO_QUALITY':
        // Allow slightly more cash, reduce risk
        const existingSpxScale = directives.scales?.spx?.sizeScale ?? 1;
        directives.scales = {
          ...directives.scales,
          spx: { sizeScale: Math.min(existingSpxScale, 0.95) },
        };
        directives.warnings!.push(`CROSS-ASSET: FLIGHT_TO_QUALITY → SPX scale reduced (conf=${confidence.toFixed(2)})`);
        (reasoning as any).crossAssetOverride = { regime, action: 'SPX scale 0.95' };
        break;
        
      case 'DECOUPLED':
        // Lower certainty → reduce sizes by 5-10%
        const decoupleScale = 0.92;
        const existBtcScale = directives.scales?.btc?.sizeScale ?? 1;
        const existSpxScale = directives.scales?.spx?.sizeScale ?? 1;
        directives.scales = {
          ...directives.scales,
          btc: { sizeScale: Math.min(existBtcScale, decoupleScale) },
          spx: { sizeScale: Math.min(existSpxScale, decoupleScale) },
        };
        directives.warnings!.push(`CROSS-ASSET: DECOUPLED → uncertainty↑, sizes reduced ×${decoupleScale} (conf=${confidence.toFixed(2)})`);
        (reasoning as any).crossAssetOverride = { regime, action: `sizes × ${decoupleScale}` };
        break;
        
      case 'RISK_ON_SYNC':
        // If tailRisk low → allow mild extension (but under caps)
        if (scenario.name === 'BASE' && !reasoning.tailAmplified) {
          const btcScale = directives.scales?.btc?.sizeScale ?? 1;
          const spxScale = directives.scales?.spx?.sizeScale ?? 1;
          if (btcScale <= 1 && spxScale <= 1) {
            directives.scales = {
              ...directives.scales,
              btc: { sizeScale: Math.min(btcScale * 1.05, 1.10) },
              spx: { sizeScale: Math.min(spxScale * 1.05, 1.10) },
            };
            directives.warnings!.push(`CROSS-ASSET: RISK_ON_SYNC → mild extension ×1.05 (conf=${confidence.toFixed(2)})`);
            (reasoning as any).crossAssetOverride = { regime, action: 'sizes × 1.05' };
          }
        }
        break;
        
      case 'MIXED':
        // No action
        break;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LEGACY RULES (fallback when forecast unavailable)
  // ═══════════════════════════════════════════════════════════════
  
  private computeLegacyScenario(world: WorldStatePack): ScenarioPack {
    const dxy = world.assets.dxy;
    const regimePosterior = dxy?.macroV2?.regime.probs || {};
    const guardLevel = dxy?.guard?.level || 'NONE';
    
    let stressProb = regimePosterior['STRESS'] || 0;
    let tailProb = 0.05;
    
    if (guardLevel === 'CRISIS') {
      stressProb = Math.max(stressProb, 0.4);
      tailProb = 0.25;
    } else if (guardLevel === 'BLOCK') {
      stressProb = 0.6;
      tailProb = 0.35;
    } else if (guardLevel === 'WARN') {
      stressProb = Math.max(stressProb, 0.25);
      tailProb = 0.15;
    }
    
    if (world.assets.dxy?.liquidity?.regime === 'CONTRACTION') {
      stressProb += 0.10;
    }
    
    stressProb = Math.min(stressProb, 0.7);
    tailProb = Math.min(tailProb, 0.4);
    const baseProb = Math.max(0, 1 - stressProb - tailProb);
    
    let name: 'BASE' | 'RISK' | 'TAIL' = 'BASE';
    if (tailProb >= 0.25) name = 'TAIL';
    else if (stressProb >= 0.35) name = 'RISK';
    
    return {
      name,
      probs: {
        BASE: Math.round(baseProb * 100) / 100,
        RISK: Math.round(stressProb * 100) / 100,
        TAIL: Math.round(tailProb * 100) / 100,
      },
      confidence: dxy?.macroV2?.confidence || 0.5,
      description: `Legacy rule-based scenario. ${dxy?.macroV2?.regime.name || 'UNKNOWN'} regime.`,
    };
  }
  
  private computeLegacyDirectives(world: WorldStatePack, scenario: ScenarioPack): BrainDirectives {
    const directives: BrainDirectives = {
      caps: {},
      scales: {},
      haircuts: {},
      warnings: [],
    };
    
    const dxy = world.assets.dxy;
    const guardLevel = dxy?.guard?.level || 'NONE';
    const liquidityRegime = dxy?.liquidity?.regime || 'NEUTRAL';
    const macroScore = dxy?.macroV2?.scoreSigned || 0;
    
    if (guardLevel === 'BLOCK') {
      directives.caps = { spx: { maxSize: 0.05 }, btc: { maxSize: 0.05 } };
      directives.riskMode = 'RISK_OFF';
      directives.warnings!.push('GUARD BLOCK: All risk assets capped');
    } else if (guardLevel === 'CRISIS') {
      directives.haircuts = { btc: 0.60, spx: 0.75 };
      directives.riskMode = 'RISK_OFF';
      directives.warnings!.push('GUARD CRISIS: Strong haircuts');
    } else if (guardLevel === 'WARN') {
      directives.haircuts = { btc: 0.85, spx: 0.90 };
      directives.warnings!.push('GUARD WARN: Moderate reduction');
    }
    
    if (scenario.probs.RISK >= 0.35) {
      directives.riskMode = 'RISK_OFF';
    }
    
    if (liquidityRegime === 'CONTRACTION' && macroScore < 0) {
      directives.haircuts = {
        ...directives.haircuts,
        btc: Math.min(directives.haircuts?.btc ?? 1, 0.90),
      };
    }
    
    if (!directives.riskMode) directives.riskMode = 'NEUTRAL';
    
    return directives;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EVIDENCE BUILDER (enriched with forecast)
  // ═══════════════════════════════════════════════════════════════
  
  private buildEvidence(
    world: WorldStatePack,
    scenario: ScenarioPack,
    directives: BrainDirectives,
    forecast: QuantileForecastResponse | null,
    reasoning?: OverrideReasoning
  ): BrainEvidence {
    const dxy = world.assets.dxy;
    const drivers: string[] = [];
    const conflicts: string[] = [];
    const whatWouldFlip: string[] = [];
    
    // Forecast-driven drivers
    if (forecast) {
      const mean90 = forecast.byHorizon['90D']?.mean || 0;
      const tailRisk90 = forecast.byHorizon['90D']?.tailRisk || 0;
      const direction = mean90 > 0 ? 'Bullish' : 'Bearish';
      drivers.push(`MoE Forecast (90D): ${direction} ${(mean90 * 100).toFixed(1)}%, TailRisk=${tailRisk90.toFixed(2)}`);
      
      if (forecast.model.isBaseline) {
        drivers.push('Model: BASELINE (not trained)');
      } else {
        drivers.push(`Model: ${forecast.model.modelVersion} (trained ${forecast.model.trainedAt?.split('T')[0]})`);
      }
    }
    
    // P9.0: Cross-asset driver
    if (world.crossAsset) {
      const ca = world.crossAsset;
      drivers.push(`Cross-Asset: ${ca.regime.label} (conf=${ca.regime.confidence.toFixed(2)}, contagion=${ca.diagnostics.contagionScore.toFixed(2)})`);
      
      const w60 = ca.windows.find(w => w.windowDays === 60);
      if (w60) {
        drivers.push(`BTC-SPX corr(60d)=${w60.corr_btc_spx}, SPX-DXY corr(60d)=${w60.corr_spx_dxy}`);
      }
    }
    
    // Regime driver
    if (dxy?.macroV2?.regime.name) {
      drivers.push(`Macro Regime: ${dxy.macroV2.regime.name}`);
    }
    
    // Guard driver
    if (dxy?.guard?.level && dxy.guard.level !== 'NONE') {
      drivers.push(`Guard Level: ${dxy.guard.level}`);
    }
    
    // Liquidity driver
    if (dxy?.liquidity?.regime) {
      drivers.push(`Liquidity: ${dxy.liquidity.regime}`);
    }
    
    // Override reasoning drivers
    if (reasoning?.tailAmplified) {
      drivers.push(`Tail Amplified: q05=${(reasoning.tailAmplificationDetails!.q05 * 100).toFixed(1)}%`);
    }
    if (reasoning?.bullExtension) {
      drivers.push(`Bull Extension: sizeScale ×${reasoning.bullExtensionDetails!.sizeScale}`);
    }
    if (reasoning?.neutralDampened) {
      drivers.push(`Neutral Dampened: spread=${(reasoning.neutralDampeningDetails!.spread * 100).toFixed(1)}%`);
    }
    
    // Detect conflicts
    if (forecast) {
      const mean90 = forecast.byHorizon['90D']?.mean || 0;
      const tailRisk90 = forecast.byHorizon['90D']?.tailRisk || 0;
      
      if (mean90 > 0.02 && tailRisk90 > 0.4) {
        conflicts.push('Forecast bullish but tail risk elevated — mixed signal');
      }
      if (dxy?.guard?.level === 'CRISIS' && scenario.name === 'BASE') {
        conflicts.push('Guard CRISIS but scenario BASE — anomaly');
      }
    }
    
    // What would flip
    if (scenario.name === 'BASE') {
      whatWouldFlip.push('TailRisk spike above 0.35');
      whatWouldFlip.push('Guard escalation to CRISIS/BLOCK');
      whatWouldFlip.push('q05 drop below horizon threshold');
    }
    if (scenario.name === 'RISK' || scenario.name === 'TAIL') {
      whatWouldFlip.push('TailRisk drop below 0.20');
      whatWouldFlip.push('Guard deescalation to NONE');
      whatWouldFlip.push('Mean turning positive with low uncertainty');
    }
    
    // Build headline
    const forecastTag = forecast ? ` [MoE ${forecast.model.modelVersion}]` : ' [legacy]';
    const headline = `${scenario.name} scenario (${(scenario.confidence * 100).toFixed(0)}% conf) | ${directives.riskMode} mode${forecastTag}`;
    
    return {
      headline,
      drivers,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      whatWouldFlip: whatWouldFlip.length > 0 ? whatWouldFlip : undefined,
      confidenceFactors: [
        `Scenario confidence: ${(scenario.confidence * 100).toFixed(0)}%`,
        `Model: ${forecast?.model.isBaseline ? 'BASELINE' : forecast?.model.modelVersion || 'N/A'}`,
        `System health: ${world.global.systemHealth?.status || 'UNKNOWN'}`,
      ],
    };
  }
}

// Singleton
let instance: BrainOrchestratorService | null = null;

export function getBrainOrchestratorService(): BrainOrchestratorService {
  if (!instance) {
    instance = new BrainOrchestratorService();
  }
  return instance;
}
