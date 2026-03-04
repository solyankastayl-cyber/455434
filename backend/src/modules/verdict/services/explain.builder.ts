/**
 * EXPLAIN BUILDER SERVICE
 * =======================
 * 
 * BLOCK A1: Multi-Layer Influence Bars (Explainable AI)
 * 
 * Builds the `explain` snapshot object for V4 endpoint response.
 * This object provides transparency into WHY the model made a decision.
 * 
 * Contains:
 * - Final verdict state (action, confidence raw/adjusted, expected move)
 * - Layer contributions (exchange, onchain, sentiment) - normalized weights
 * - Overlay adjustments (macro, funding, health) - delta values
 * - Top signals (3 max) - individual signal impacts
 * 
 * Architectural principle: Transparency without UI clutter.
 */

export type LayerKey = 'exchange' | 'onchain' | 'sentiment';
export type OverlayKey = 'macro' | 'funding' | 'health';
export type HorizonType = '1D' | '7D' | '30D';

export interface ExplainLayerEntry {
  key: LayerKey;
  weight: number;       // 0..1, normalized (sum of active = 1.0)
  note?: string;        // e.g., "OI rising, volume confirms" or "frozen"
}

export interface ExplainOverlayEntry {
  key: OverlayKey;
  delta: number;        // Raw delta adjustment (e.g., -0.12 = -12%)
  label?: string;       // e.g., "BTC_FLIGHT_TO_SAFETY", "crowded longs"
}

export interface ExplainSignalEntry {
  key: string;          // Signal identifier, e.g., "fundingCrowdedness", "lsRatio"
  impact: number;       // Signed impact on confidence, e.g., -0.04
}

export interface ExplainSnapshot {
  horizon: HorizonType;
  
  final: {
    action: string;             // BUY | SELL | HOLD | AVOID
    confidence_raw: number;     // 0..1, before adjustments
    confidence_adj: number;     // 0..1, after all adjustments
    expectedMovePct: number;    // Signed percentage
  };
  
  drivers: {
    layers: ExplainLayerEntry[];
    overlays: ExplainOverlayEntry[];
    topSignals: ExplainSignalEntry[];
  };
}

export interface ExplainBuilderParams {
  horizon: HorizonType;
  rawConfidence: number;
  adjustedConfidence: number;
  expectedMovePct: number;
  action: string;
  
  // Layer scores (0 if frozen/disabled)
  layerScores: {
    exchange?: number;
    onchain?: number;
    sentiment?: number;
  };
  
  // Overlay adjustments from verdict pipeline
  overlayAdjustments: {
    macro?: number;
    funding?: number;
    health?: number;
  };
  
  // Optional labels for overlays
  overlayLabels?: {
    macro?: string;
    funding?: string;
    health?: string;
  };
  
  // Top individual signals (max 5, will be capped to 3)
  topSignals?: Array<{ key: string; impact: number }>;
}

/**
 * Build ExplainSnapshot from verdict data
 * 
 * Key rule: Frozen layers get weight = 0 and note = "frozen".
 * Active layers are normalized so sum = 1.0.
 */
export function buildExplainSnapshot(params: ExplainBuilderParams): ExplainSnapshot {
  // 1. Normalize layer weights
  const rawLayers = {
    exchange: params.layerScores?.exchange ?? 0,
    onchain: params.layerScores?.onchain ?? 0,
    sentiment: params.layerScores?.sentiment ?? 0,
  };
  
  // Calculate sum of active (non-zero) layers
  const activeLayers = Object.entries(rawLayers)
    .filter(([_, v]) => v !== 0 && !Number.isNaN(v));
  
  const activeSum = activeLayers.reduce((sum, [_, v]) => sum + Math.abs(v), 0) || 1;
  
  // Build normalized layer entries
  const layers: ExplainLayerEntry[] = Object.entries(rawLayers).map(([key, value]) => {
    const isFrozen = value === 0 || Number.isNaN(value);
    const normalizedWeight = isFrozen ? 0 : Math.abs(value) / activeSum;
    
    return {
      key: key as LayerKey,
      weight: Math.round(normalizedWeight * 100) / 100, // Round to 2 decimals
      note: isFrozen ? 'frozen' : undefined,
    };
  });
  
  // 2. Build overlay entries (raw deltas, not multiplied)
  const overlays: ExplainOverlayEntry[] = [];
  
  if (params.overlayAdjustments?.macro !== undefined) {
    overlays.push({
      key: 'macro',
      delta: params.overlayAdjustments.macro,
      label: params.overlayLabels?.macro,
    });
  }
  
  if (params.overlayAdjustments?.funding !== undefined) {
    overlays.push({
      key: 'funding',
      delta: params.overlayAdjustments.funding,
      label: params.overlayLabels?.funding,
    });
  }
  
  if (params.overlayAdjustments?.health !== undefined) {
    overlays.push({
      key: 'health',
      delta: params.overlayAdjustments.health,
      label: params.overlayLabels?.health,
    });
  }
  
  // 3. Cap top signals to 3 max
  const topSignals = (params.topSignals || [])
    .slice(0, 3)
    .map(s => ({
      key: s.key,
      impact: Math.round(s.impact * 1000) / 1000, // Round to 3 decimals
    }));
  
  return {
    horizon: params.horizon,
    
    final: {
      action: params.action,
      confidence_raw: Math.round(params.rawConfidence * 100) / 100,
      confidence_adj: Math.round(params.adjustedConfidence * 100) / 100,
      expectedMovePct: Math.round(params.expectedMovePct * 100) / 100,
    },
    
    drivers: {
      layers,
      overlays,
      topSignals,
    },
  };
}

/**
 * Extract overlay deltas from verdict adjustments array
 */
export function extractOverlayDeltas(
  adjustments: Array<{ stage?: string; key?: string; deltaConfidence?: number; notes?: string }>
): { 
  overlayAdjustments: { macro: number; funding: number; health: number };
  overlayLabels: { macro?: string; funding?: string; health?: string };
} {
  const result = {
    overlayAdjustments: { macro: 0, funding: 0, health: 0 },
    overlayLabels: {} as { macro?: string; funding?: string; health?: string },
  };
  
  for (const adj of adjustments) {
    const key = adj.key?.toLowerCase() || '';
    const delta = adj.deltaConfidence || 0;
    const notes = adj.notes || '';
    
    // Macro-related adjustments
    if (key.includes('macro') || key.includes('risk_level') || key.includes('regime')) {
      result.overlayAdjustments.macro += delta;
      if (notes.includes('BTC_') || notes.includes('ALT_')) {
        result.overlayLabels.macro = notes.split(' ').find(w => w.includes('_')) || notes;
      }
    }
    
    // Funding-related adjustments
    if (key.includes('funding') || key.includes('crowd') || key.includes('squeeze')) {
      result.overlayAdjustments.funding += delta;
      if (notes.includes('crowded')) {
        result.overlayLabels.funding = 'crowded longs';
      }
    }
    
    // Health-related adjustments
    if (key.includes('health') || key.includes('horizon_health')) {
      result.overlayAdjustments.health += delta;
      if (notes.includes('health=')) {
        result.overlayLabels.health = notes.match(/health=(\w+)/)?.[1] || 'UNKNOWN';
      }
    }
  }
  
  return result;
}

/**
 * Extract top signals from features + verdict context
 */
export function extractTopSignals(
  features: Record<string, number>,
  verdictAdjustments?: Array<{ key?: string; deltaConfidence?: number }>
): Array<{ key: string; impact: number }> {
  const signals: Array<{ key: string; impact: number }> = [];
  
  // From features - infer signal impact based on deviation from neutral
  const featureSignals: Record<string, { neutral: number; scale: number }> = {
    rsi: { neutral: 50, scale: 0.001 },           // RSI deviation → impact
    momentum_1d: { neutral: 0, scale: 0.5 },     // Strong momentum = high impact
    volume_change: { neutral: 0, scale: 0.3 },   // Volume spike = impact
    trend_strength: { neutral: 0, scale: 0.05 }, // Trend = directional impact
    fear_greed: { neutral: 50, scale: 0.001 },   // Fear/Greed deviation
  };
  
  for (const [key, config] of Object.entries(featureSignals)) {
    if (features[key] !== undefined) {
      const deviation = features[key] - config.neutral;
      const impact = deviation * config.scale;
      
      // Only include if meaningful
      if (Math.abs(impact) > 0.005) {
        signals.push({ key, impact });
      }
    }
  }
  
  // From verdict adjustments - extract rule impacts
  if (verdictAdjustments) {
    for (const adj of verdictAdjustments) {
      if (adj.key && adj.deltaConfidence && Math.abs(adj.deltaConfidence) > 0.01) {
        // Don't duplicate overlay keys
        if (!adj.key.toLowerCase().includes('macro') && 
            !adj.key.toLowerCase().includes('funding') &&
            !adj.key.toLowerCase().includes('health')) {
          signals.push({
            key: adj.key.toLowerCase().replace(/_/g, ''),
            impact: adj.deltaConfidence,
          });
        }
      }
    }
  }
  
  // Sort by absolute impact and take top 3
  return signals
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3);
}

console.log('[ExplainBuilder] Module loaded');
