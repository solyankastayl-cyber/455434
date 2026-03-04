/**
 * UNIFIED SNAPSHOT EXTRACTOR
 * 
 * Single function to extract snapshot payload from any engine result:
 * - BTC Fractal (focusPack)
 * - SPX Fractal (data)
 * - DXY Terminal (terminalPack)
 * 
 * All produce: [history] → anchor → [forecast]
 */

import { 
  buildFullSeries, 
  buildFullSeriesFromCandles,
  timestampsToDateStrings, 
  generateDateArray,
  FIXED_HISTORY_START_DATE,
  FIXED_HISTORY_START_ISO,
  type SeriesPoint,
  type BuildFullSeriesResult 
} from '../../shared/utils/buildFullSeries.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type AssetType = 'SPX' | 'DXY' | 'BTC';
export type PredictionView = 'synthetic' | 'hybrid' | 'macro' | 'crossAsset';
export type Stance = 'BULLISH' | 'BEARISH' | 'HOLD';

export interface PredictionPoint {
  t: string;
  v: number;
}

export interface SnapshotPayload {
  asset: AssetType;
  view: PredictionView;
  horizonDays: number;
  asOf: string;
  asOfPrice: number;
  series: PredictionPoint[];
  anchorIndex?: number;
  band?: { p10: PredictionPoint[]; p90: PredictionPoint[] };
  stance: Stance;
  confidence: number;
  quality?: number;
  modelVersion: string;
  sourceEndpoint: string;
}

// Horizon string to days mapping
const HORIZON_MAP: Record<string, number> = {
  '7d': 7, '14d': 14, '30d': 30, '90d': 90, '180d': 180, '365d': 365
};

// ═══════════════════════════════════════════════════════════════
// UNIFIED EXTRACTOR
// ═══════════════════════════════════════════════════════════════

export interface ExtractorInput {
  asset: AssetType;
  engineResult: any;       // focusPack, data, or terminalPack
  horizon: string;         // '30d', '90d', etc.
  sourceEndpoint: string;
  // NEW: Optional candles for history (bypasses currentWindow.raw limitation)
  historicalCandles?: Array<{ t: string; close: number }>;
}

/**
 * Universal snapshot extractor
 * Works for BTC, SPX, DXY
 */
export function extractSnapshotPayload(input: ExtractorInput): SnapshotPayload | null {
  const { asset, engineResult, horizon, sourceEndpoint, historicalCandles } = input;
  
  try {
    const horizonDays = HORIZON_MAP[horizon] || parseInt(horizon) || 30;
    const asOfDate = new Date();
    const asOfDateStr = asOfDate.toISOString().split('T')[0];
    
    // Extract based on asset type
    let extractResult: ExtractResult | null = null;
    
    switch (asset) {
      case 'BTC':
        extractResult = extractBtcData(engineResult, horizonDays, asOfDateStr, historicalCandles);
        break;
      case 'SPX':
        extractResult = extractSpxData(engineResult, horizonDays, asOfDateStr, historicalCandles);
        break;
      case 'DXY':
        extractResult = extractDxyData(engineResult, horizonDays, asOfDateStr);
        break;
    }
    
    if (!extractResult) {
      console.warn(`[UnifiedExtractor] No data extracted for ${asset}`);
      return null;
    }
    
    const { asOfPrice, historicalPrices, historicalDates, forecastPrices, forecastDates, confidence, view } = extractResult;
    
    // Build full series using unified function
    const result = buildFullSeries({
      asOfDate: asOfDateStr,
      asOfPrice,
      historicalPrices,
      historicalDates,
      forecastPrices,
      forecastDates,
    });
    
    if (result.series.length < 10) {
      console.warn(`[UnifiedExtractor] Series too short: ${result.series.length} for ${asset}/${horizon}`);
      return null;
    }
    
    // Derive stance from forecast direction
    const stance = deriveStance(result.series, result.anchorIndex);
    
    // DEBUG: Log full extraction details for cross-module verification
    console.log(`[UnifiedExtractor] ${asset}/${horizon}:`, {
      seriesLength: result.series.length,
      anchorIndex: result.anchorIndex,
      historyLength: result.historyLength,
      forecastLength: result.forecastLength,
      asOfDate: asOfDateStr,
      asOfPrice: asOfPrice.toFixed(2),
      firstDate: result.series[0]?.t,
      firstPrice: result.series[0]?.v?.toFixed(2),
      anchorDate: result.series[result.anchorIndex]?.t,
      anchorPrice: result.series[result.anchorIndex]?.v?.toFixed(2),
      lastDate: result.series[result.series.length - 1]?.t,
      lastPrice: result.series[result.series.length - 1]?.v?.toFixed(2),
      stance,
      confidence: confidence.toFixed(3),
    });
    
    return {
      asset,
      view,
      horizonDays,
      asOf: asOfDate.toISOString(),
      asOfPrice,
      series: result.series,
      anchorIndex: result.anchorIndex,
      stance,
      confidence,
      modelVersion: 'v3.2.0-unified',
      sourceEndpoint,
    };
    
  } catch (e: any) {
    console.error(`[UnifiedExtractor] Error for ${asset}:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ASSET-SPECIFIC DATA EXTRACTION
// ═══════════════════════════════════════════════════════════════

interface ExtractResult {
  asOfPrice: number;
  historicalPrices: number[];
  historicalDates: string[];
  forecastPrices: number[];
  forecastDates: string[];
  confidence: number;
  view: PredictionView;
}

/**
 * Extract data from BTC focusPack
 */
function extractBtcData(
  focusPack: any, 
  horizonDays: number, 
  asOfDateStr: string,
  historicalCandles?: Array<{ t: string; close: number }>
): ExtractResult | null {
  const forecast = focusPack?.forecast;
  const overlay = focusPack?.overlay;
  const currentWindow = overlay?.currentWindow;
  
  if (!forecast?.path || forecast.path.length < 5) return null;
  
  const asOfPrice = forecast.currentPrice || currentWindow?.raw?.slice(-1)[0] || 0;
  if (asOfPrice === 0) return null;
  
  // Historical prices: prefer candles over currentWindow.raw
  const historicalPrices: number[] = [];
  const historicalDates: string[] = [];
  
  if (historicalCandles && historicalCandles.length > 0) {
    // Use provided candles (full history from FIXED_HISTORY_START_DATE)
    for (const c of historicalCandles) {
      const dateStr = c.t.split('T')[0];
      if (dateStr >= FIXED_HISTORY_START_DATE && dateStr < asOfDateStr) {
        historicalPrices.push(c.close);
        historicalDates.push(dateStr);
      }
    }
  } else if (currentWindow?.raw && currentWindow?.timestamps) {
    // Fallback: use currentWindow.raw (limited by horizon config)
    const raw = currentWindow.raw as number[];
    const timestamps = currentWindow.timestamps as number[];
    const dates = timestampsToDateStrings(timestamps);
    
    for (let i = 0; i < raw.length; i++) {
      const dateStr = dates[i];
      if (dateStr && dateStr >= FIXED_HISTORY_START_DATE && dateStr < asOfDateStr) {
        historicalPrices.push(raw[i]);
        historicalDates.push(dateStr);
      }
    }
  }
  
  // Forecast prices from forecast.path
  const forecastPrices: number[] = [];
  const forecastDates: string[] = [];
  const startTs = forecast.startTs ? new Date(forecast.startTs) : new Date();
  
  for (let i = 0; i < forecast.path.length; i++) {
    const d = new Date(startTs);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    
    if (dateStr > asOfDateStr) {
      forecastPrices.push(forecast.path[i]);
      forecastDates.push(dateStr);
    }
  }
  
  const confidence = focusPack?.diagnostics?.qualityScore || 0.5;
  
  return {
    asOfPrice,
    historicalPrices,
    historicalDates,
    forecastPrices,
    forecastDates,
    confidence,
    view: 'hybrid',
  };
}

/**
 * Extract data from SPX focusPack (wrapped in 'data')
 */
function extractSpxData(
  data: any, 
  horizonDays: number, 
  asOfDateStr: string,
  historicalCandles?: Array<{ t: string; close: number }>
): ExtractResult | null {
  const forecast = data?.forecast;
  const overlay = data?.overlay;
  const currentWindow = overlay?.currentWindow;
  const price = data?.price;
  
  if (!forecast?.path || forecast.path.length < 5) return null;
  
  const asOfPrice = price?.current || forecast.currentPrice || 0;
  if (asOfPrice === 0) return null;
  
  // Historical prices: prefer candles over currentWindow.raw
  const historicalPrices: number[] = [];
  const historicalDates: string[] = [];
  
  if (historicalCandles && historicalCandles.length > 0) {
    // Use provided candles (full history from FIXED_HISTORY_START_DATE)
    for (const c of historicalCandles) {
      const dateStr = c.t.split('T')[0];
      if (dateStr >= FIXED_HISTORY_START_DATE && dateStr < asOfDateStr) {
        historicalPrices.push(c.close);
        historicalDates.push(dateStr);
      }
    }
  } else if (currentWindow?.raw && currentWindow?.timestamps) {
    // Fallback: use currentWindow.raw (limited by horizon config)
    const raw = currentWindow.raw as number[];
    const timestamps = currentWindow.timestamps as number[];
    const dates = timestampsToDateStrings(timestamps);
    
    for (let i = 0; i < raw.length; i++) {
      const dateStr = dates[i];
      if (dateStr && dateStr >= FIXED_HISTORY_START_DATE && dateStr < asOfDateStr) {
        historicalPrices.push(raw[i]);
        historicalDates.push(dateStr);
      }
    }
  }
  
  // Forecast prices
  const forecastPrices: number[] = [];
  const forecastDates: string[] = [];
  const startTs = forecast.startTs ? new Date(forecast.startTs) : new Date();
  
  for (let i = 0; i < forecast.path.length; i++) {
    const d = new Date(startTs);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    
    if (dateStr > asOfDateStr) {
      forecastPrices.push(forecast.path[i]);
      forecastDates.push(dateStr);
    }
  }
  
  const confidence = data?.diagnostics?.qualityScore || 0.5;
  
  return {
    asOfPrice,
    historicalPrices,
    historicalDates,
    forecastPrices,
    forecastDates,
    confidence,
    view: 'crossAsset',
  };
}

/**
 * Extract data from DXY terminalPack
 */
function extractDxyData(terminalPack: any, horizonDays: number, asOfDateStr: string): ExtractResult | null {
  const hybrid = terminalPack?.hybrid;
  const core = terminalPack?.core;
  const replay = terminalPack?.replay;
  
  if (!hybrid?.path) return null;
  
  const asOfPrice = core?.current?.price || core?.lastPrice || 0;
  if (asOfPrice === 0) return null;
  
  // Historical prices from replay.window
  const historicalPrices: number[] = [];
  const historicalDates: string[] = [];
  
  const replayWindow = replay?.window;
  if (replayWindow && Array.isArray(replayWindow)) {
    // FIXED: History starts from FIXED_HISTORY_START_DATE (2026-01-01)
    for (const p of replayWindow) {
      const dateStr = parseDateStr(p.date || p.t);
      
      if (dateStr && dateStr >= FIXED_HISTORY_START_DATE && dateStr < asOfDateStr) {
        historicalPrices.push(p.value || p.v);
        historicalDates.push(dateStr);
      }
    }
  }
  
  // Forecast prices from hybrid.path
  const forecastPrices: number[] = [];
  const forecastDates: string[] = [];
  
  for (const p of hybrid.path) {
    const dateStr = parseDateStr(p.date || p.t);
    
    if (dateStr && dateStr > asOfDateStr) {
      forecastPrices.push(p.value || p.v);
      forecastDates.push(dateStr);
    }
  }
  
  const confidence = terminalPack?.meta?.confidence || hybrid.confidence || 0.5;
  
  return {
    asOfPrice,
    historicalPrices,
    historicalDates,
    forecastPrices,
    forecastDates,
    confidence,
    view: 'hybrid',
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Parse various date formats to YYYY-MM-DD
 */
function parseDateStr(rawDate: any): string | undefined {
  if (!rawDate) return undefined;
  
  if (rawDate instanceof Date) {
    return rawDate.toISOString().split('T')[0];
  }
  
  if (typeof rawDate === 'string') {
    if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return rawDate;
    }
    if (rawDate.includes('T')) {
      return rawDate.split('T')[0];
    }
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch (e) {}
  }
  
  if (typeof rawDate === 'number') {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  
  return undefined;
}

/**
 * Derive stance from forecast direction
 */
function deriveStance(series: PredictionPoint[], anchorIndex: number): Stance {
  if (anchorIndex < 0 || anchorIndex >= series.length - 1) return 'HOLD';
  
  const anchorPrice = series[anchorIndex].v;
  const finalPrice = series[series.length - 1].v;
  const returnPct = (finalPrice - anchorPrice) / anchorPrice;
  
  if (returnPct > 0.02) return 'BULLISH';
  if (returnPct < -0.02) return 'BEARISH';
  return 'HOLD';
}

// ═══════════════════════════════════════════════════════════════
// LEGACY EXPORTS (for backward compatibility)
// ═══════════════════════════════════════════════════════════════

export function extractBtcSnapshotPayload(
  focusPack: any, 
  focus: string,
  historicalCandles?: Array<{ t: string; close: number }>
): SnapshotPayload | null {
  return extractSnapshotPayload({
    asset: 'BTC',
    engineResult: focusPack,
    horizon: focus,
    sourceEndpoint: '/api/fractal/v2.1/focus-pack',
    historicalCandles,
  });
}

export function extractSpxSnapshotPayload(
  terminalPack: any, 
  horizon: string,
  historicalCandles?: Array<{ t: string; close: number }>
): SnapshotPayload | null {
  // SPX wraps data in 'data' key
  const data = terminalPack?.data || terminalPack;
  return extractSnapshotPayload({
    asset: 'SPX',
    engineResult: data,
    horizon,
    sourceEndpoint: '/api/spx/v2.1/focus-pack',
    historicalCandles,
  });
}

export function extractDxySnapshotPayload(terminalPack: any, focus: string): SnapshotPayload | null {
  return extractSnapshotPayload({
    asset: 'DXY',
    engineResult: terminalPack,
    horizon: focus,
    sourceEndpoint: '/api/fractal/dxy/terminal',
  });
}

export default extractSnapshotPayload;
