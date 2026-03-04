/**
 * AE/S-Brain v2 — World State Service
 * 
 * Aggregates all assets into unified WorldStatePack.
 */

import { AssetId } from '../contracts/asset_state.contract.js';
import { WorldStatePack, deriveGlobalContext } from '../contracts/world_state.contract.js';
import { getAssetStateService } from './asset_state.service.js';
import { getMacroHealth } from '../adapters/sources.adapter.js';
import { getCrossAssetRegimeService } from './cross_asset_regime.service.js';
import * as crypto from 'crypto';

export class WorldStateService {
  
  /**
   * Build complete WorldStatePack
   */
  async buildWorldState(asOf: string): Promise<WorldStatePack> {
    const assetService = getAssetStateService();
    
    // Fetch all assets in parallel
    const [dxy, spx, btc, health, crossAsset] = await Promise.all([
      assetService.buildAssetState('dxy', asOf),
      assetService.buildAssetState('spx', asOf),
      assetService.buildAssetState('btc', asOf),
      getMacroHealth(),
      getCrossAssetRegimeService().buildPack(asOf).catch(e => {
        console.warn('[WorldState] CrossAsset unavailable:', (e as Error).message);
        return null;
      }),
    ]);
    
    const assets: Record<AssetId, typeof dxy> = { dxy, spx, btc };
    
    // Derive global context
    const global = deriveGlobalContext(assets);
    
    // Add system health from shadow monitoring
    if (health) {
      global.systemHealth = {
        status: health.status as any || 'HEALTHY',
        shadowDivergence: health.signMismatchRatio,
        stabilityScore: health.regimeStability,
      };
    }
    
    // Build inputs hash for determinism verification
    const inputsHash = this.computeInputsHash(assets);
    
    return {
      asOf,
      assets,
      global,
      crossAsset: crossAsset || undefined,
      meta: {
        generatedAt: new Date().toISOString(),
        engineVersion: 'brain-v2',
        inputsHash,
      },
    };
  }
  
  /**
   * Compute hash of inputs for determinism check
   */
  private computeInputsHash(assets: Record<AssetId, any>): string {
    const serialized = JSON.stringify({
      dxy_regime: assets.dxy?.macroV2?.regime?.name,
      dxy_score: assets.dxy?.macroV2?.scoreSigned,
      dxy_guard: assets.dxy?.guard?.level,
      spx_size: assets.spx?.cascade?.size,
      btc_price: assets.btc?.price?.spot,
    });
    
    return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);
  }
}

// Singleton
let instance: WorldStateService | null = null;

export function getWorldStateService(): WorldStateService {
  if (!instance) {
    instance = new WorldStateService();
  }
  return instance;
}
