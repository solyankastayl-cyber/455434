/**
 * BLOCK 2.11 — Feature Builder
 * ============================
 * Computes all features from raw data.
 */

import { FEATURE_REGISTRY, SymbolRawData } from './feature_registry.js';

export interface FeatureBuildResult {
  features: Record<string, number | null>;
  missing: string[];
}

export function buildFeatures(raw: SymbolRawData): FeatureBuildResult {
  const nowPrice = raw.price;
  const ctx = { raw, nowPrice };

  const features: Record<string, number | null> = {};
  const missing: string[] = [];

  for (const f of FEATURE_REGISTRY) {
    const req = f.requires ?? [];
    const ok = req.every((k) => {
      const val = (raw as any)[k];
      return val !== undefined && val !== null;
    });

    if (!ok) {
      // Track missing dependencies
      for (const k of req) {
        if ((raw as any)[k] === undefined || (raw as any)[k] === null) {
          missing.push(String(k));
        }
      }
      features[f.key] = null;
      continue;
    }

    try {
      const value = f.compute(ctx);
      features[f.key] = value;
    } catch (e) {
      features[f.key] = null;
    }
  }

  return {
    features,
    missing: Array.from(new Set(missing)),
  };
}

/**
 * Compute quality score based on available data
 */
export function computeQualityScore(raw: SymbolRawData, missing: string[]): number {
  let score = 0;

  // Base price required
  if (typeof raw.price === 'number' && raw.price > 0) score += 0.4;

  // Volume
  if (typeof raw.volumeUsd24h === 'number') score += 0.1;

  // Funding
  if (typeof raw.fundingRate === 'number') score += 0.1;

  // OI
  if (typeof raw.oiUsd === 'number') score += 0.1;

  // Liquidations
  if (typeof raw.liquidationsUsd1h === 'number') score += 0.1;

  // OHLC
  if (raw.ohlc?.close1hAgo) score += 0.1;
  if (raw.ohlc?.close24hAgo) score += 0.1;

  // Penalize missing
  score -= Math.min(0.25, missing.length * 0.01);

  return Math.max(0, Math.min(1, score));
}

console.log('[FeatureBuilder] Loaded');
