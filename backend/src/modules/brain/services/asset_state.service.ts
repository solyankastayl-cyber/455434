/**
 * AE/S-Brain v2 — Asset State Service
 * 
 * Builds normalized AssetStatePack for any asset.
 * Uses sources adapter to fetch data.
 */

import {
  AssetId,
  AssetStatePack,
  createEmptyAssetState,
  MacroV2Pack,
  LiquidityPack,
  GuardPack,
  CascadePack,
  EvidencePack,
} from '../contracts/asset_state.contract.js';

import {
  getFractalTerminal,
  getMacroEnginePack,
  getMacroHealth,
  getLiquidityState,
  getGuardState,
  getSpxConsensus,
  getCalibrationStatus,
} from '../adapters/sources.adapter.js';

export class AssetStateService {
  
  /**
   * Build complete AssetStatePack for given asset
   */
  async buildAssetState(asset: AssetId, asOf: string): Promise<AssetStatePack> {
    const state = createEmptyAssetState(asset, asOf);
    
    try {
      // Fetch all data in parallel
      const [fractal, macro, liquidity, guard, calibration, health] = await Promise.all([
        getFractalTerminal(asset, asOf),
        getMacroEnginePack(asset, asOf),
        getLiquidityState(),
        getGuardState(asset),
        getCalibrationStatus(),
        getMacroHealth(),
      ]);
      
      // Build price context
      if (fractal?.chart?.currentPrice) {
        state.price.spot = fractal.chart.currentPrice;
      }
      if (fractal?.volatility) {
        state.price.realizedVol20d = fractal.volatility.vol20d;
      }
      
      // Build fractal pack
      if (fractal?.horizons) {
        const horizonData: Record<string, number> = {};
        for (const [h, data] of Object.entries(fractal.horizons)) {
          if (data.endReturn !== undefined) {
            horizonData[h] = data.endReturn;
          }
        }
        state.fractal = {
          hybrid: {
            endReturnByHorizon: horizonData,
            confidence: fractal.resolver?.final?.confidence,
            signal: fractal.resolver?.final?.action,
          },
        };
      }
      
      // Build macro V2 pack (primarily for DXY)
      if (macro && asset === 'dxy') {
        const macroV2: MacroV2Pack = {
          regime: {
            name: macro.regime?.dominant || 'UNKNOWN',
            probs: macro.regime?.posterior || {},
            persistence: undefined,
          },
          confidence: macro.regime?.confidence || 0,
          keyDrivers: [],
          scoreSigned: macro.drivers?.scoreSigned,
        };
        
        // Extract key drivers
        if (macro.drivers?.components) {
          macroV2.keyDrivers = macro.drivers.components
            .filter(c => c.key && c.weight)
            .sort((a, b) => Math.abs(b.weight || 0) - Math.abs(a.weight || 0))
            .slice(0, 5)
            .map(c => ({
              key: c.key!,
              direction: (c.direction || 0) > 0 ? 'pos' as const : 'neg' as const,
              strength: Math.abs(c.weight || 0),
            }));
        }
        
        // Add per-horizon weights if available
        if (calibration?.perHorizon) {
          macroV2.perHorizonWeights = calibration.perHorizon;
        }
        
        state.macroV2 = macroV2;
        
        // Add macro overlay to fractal
        if (macro.overlay) {
          const macroHorizons: Record<string, number> = {};
          for (const [h, data] of Object.entries(macro.overlay)) {
            if (data.expectedReturn !== undefined) {
              macroHorizons[h] = data.expectedReturn;
            }
          }
          state.fractal.macro = {
            endReturnByHorizon: macroHorizons,
            confidence: macro.regime?.confidence,
            engineVersion: macro.engineVersion as 'v1' | 'v2',
          };
        }
      }
      
      // Build liquidity pack
      if (liquidity) {
        state.liquidity = {
          impulse: liquidity.impulse || 0,
          regime: (liquidity.regime as LiquidityPack['regime']) || 'NEUTRAL',
          confidence: liquidity.confidence || 0,
        };
      }
      
      // Build guard pack
      if (guard) {
        state.guard = {
          level: (guard.level as GuardPack['level']) || 'NONE',
          since: guard.since,
          rationale: guard.rationale,
        };
      }
      
      // Build cascade pack (for SPX/BTC)
      if (asset === 'spx') {
        const spx = await getSpxConsensus();
        if (spx?.data?.sizes?.final !== undefined) {
          state.cascade = {
            size: spx.data.sizes.final,
          };
        }
      }
      
      // Build evidence pack
      const evidence: EvidencePack = {
        headline: this.buildHeadline(state),
        keyDrivers: state.macroV2?.keyDrivers?.map(d => `${d.key}: ${d.direction}`) || [],
        conflicts: [],
        whatWouldFlip: [],
      };
      
      // Add regime flip condition
      if (state.macroV2?.regime.name === 'EASING') {
        evidence.whatWouldFlip?.push('Inflation spike → TIGHTENING');
      } else if (state.macroV2?.regime.name === 'TIGHTENING') {
        evidence.whatWouldFlip?.push('Growth collapse → STRESS');
      }
      
      state.evidence = evidence;
      
      // Update meta
      state.meta = {
        freshnessDays: 0,
        dataSource: 'live',
        lastUpdate: new Date().toISOString(),
      };
      
    } catch (e) {
      console.error(`[Brain] Failed to build AssetState for ${asset}:`, (e as Error).message);
    }
    
    return state;
  }
  
  /**
   * Build human-readable headline
   */
  private buildHeadline(state: AssetStatePack): string {
    const parts: string[] = [];
    
    if (state.macroV2?.regime.name) {
      parts.push(`Regime: ${state.macroV2.regime.name}`);
    }
    
    if (state.guard?.level && state.guard.level !== 'NONE') {
      parts.push(`Guard: ${state.guard.level}`);
    }
    
    if (state.liquidity?.regime) {
      parts.push(`Liquidity: ${state.liquidity.regime}`);
    }
    
    return parts.join(' | ') || 'No significant signals';
  }
}

// Singleton
let instance: AssetStateService | null = null;

export function getAssetStateService(): AssetStateService {
  if (!instance) {
    instance = new AssetStateService();
  }
  return instance;
}
