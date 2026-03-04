/**
 * Feature Pack Types - B4.2 Training Routing + P0.3 Variants
 * 
 * Defines which features are included in ML training
 */

export enum FeaturePack {
  /**
   * PACK_A: Base features only
   * - CEX Pressure v3
   * - Zones v3  
   * - Corridors v3
   */
  PACK_A = 'PACK_A',
  
  /**
   * PACK_A_PLUS_DEX: Base features + DEX features
   * - All PACK_A features
   * - DEX Liquidity (net changes, spikes)
   * - DEX Depth (index, thin liquidity)
   * - DEX Price Proxy (confidence, coverage)
   */
  PACK_A_PLUS_DEX = 'PACK_A_PLUS_DEX',
  
  /**
   * P0.3 Variants - For ablation matrix
   */
  
  /**
   * PACK_A_MINUS_CEX: Base features WITHOUT CEX Pressure
   * - Zones v3
   * - Corridors v3
   */
  PACK_A_MINUS_CEX = 'PACK_A_MINUS_CEX',
  
  /**
   * PACK_A_MINUS_CORRIDORS: Base features WITHOUT Corridors
   * - CEX Pressure v3
   * - Zones v3
   */
  PACK_A_MINUS_CORRIDORS = 'PACK_A_MINUS_CORRIDORS',
  
  /**
   * PACK_A_MINUS_ZONES: Base features WITHOUT Zones
   * - CEX Pressure v3
   * - Corridors v3
   */
  PACK_A_MINUS_ZONES = 'PACK_A_MINUS_ZONES',
}

/**
 * Feature pack configuration
 */
export interface FeaturePackConfig {
  pack: FeaturePack;
  features: string[];
  requiresDex: boolean;
  description: string;
}

/**
 * Get feature list for a pack
 */
export function getFeaturesByPack(pack: FeaturePack): string[] {
  const cexFeatures = [
    'cex_pressure_5m',
    'cex_pressure_1h', 
    'cex_pressure_1d',
    'cex_in_delta',
    'cex_out_delta',
    'cex_spike_level',
    'cex_spike_direction',
  ];
  
  const zonesFeatures = [
    'zone_persistence_7d',
    'zone_persistence_30d',
    'zone_decay_score',
    'zone_quality_score',
  ];
  
  const corridorsFeatures = [
    'corridor_persistence_7d',
    'corridor_persistence_30d',
    'corridor_repeat_rate',
    'corridor_entropy',
    'corridor_concentration',
    'corridor_net_flow_trend',
    'corridor_quality_score',
  ];
  
  const dexFeatures = [
    // DEX Liquidity
    'dex_liquidity_net_1h',
    'dex_liquidity_net_24h',
    'dex_lp_spike_level',
    'dex_lp_spike_direction',
    
    // DEX Depth
    'dex_depth_index',
    'dex_thin_liquidity_share',
    
    // DEX Price/Coverage
    'dex_price_confidence_avg',
    'dex_universe_coverage',
  ];
  
  // Base features (all groups)
  const baseFeatures = [...cexFeatures, ...zonesFeatures, ...corridorsFeatures];
  
  if (pack === FeaturePack.PACK_A) {
    return baseFeatures;
  }
  
  if (pack === FeaturePack.PACK_A_PLUS_DEX) {
    return [...baseFeatures, ...dexFeatures];
  }
  
  // P0.3: Masked variants
  if (pack === FeaturePack.PACK_A_MINUS_CEX) {
    return [...zonesFeatures, ...corridorsFeatures];
  }
  
  if (pack === FeaturePack.PACK_A_MINUS_CORRIDORS) {
    return [...cexFeatures, ...zonesFeatures];
  }
  
  if (pack === FeaturePack.PACK_A_MINUS_ZONES) {
    return [...cexFeatures, ...corridorsFeatures];
  }
  
  throw new Error(`Unknown feature pack: ${pack}`);
}

/**
 * Get configuration for a pack
 */
export function getPackConfig(pack: FeaturePack): FeaturePackConfig {
  return {
    pack,
    features: getFeaturesByPack(pack),
    requiresDex: pack === FeaturePack.PACK_A_PLUS_DEX,
    description: pack === FeaturePack.PACK_A 
      ? 'Base features (CEX, Zones, Corridors)'
      : 'Base + DEX features',
  };
}

/**
 * Validate that dataset has required features for a pack
 */
export function validateDatasetForPack(
  datasetFeatures: string[],
  pack: FeaturePack
): { valid: boolean; missing: string[] } {
  const required = getFeaturesByPack(pack);
  const missing = required.filter(f => !datasetFeatures.includes(f));
  
  return {
    valid: missing.length === 0,
    missing,
  };
}
