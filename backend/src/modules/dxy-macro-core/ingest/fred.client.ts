/**
 * FRED CLIENT — B1
 * 
 * Client for fetching data from Federal Reserve Economic Data (FRED) API.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import axios from 'axios';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface FredObservation {
  date: string;
  value: string;
}

export interface FredSeriesResponse {
  realtime_start: string;
  realtime_end: string;
  observation_start: string;
  observation_end: string;
  units: string;
  output_type: number;
  file_type: string;
  order_by: string;
  sort_order: string;
  count: number;
  offset: number;
  limit: number;
  observations: FredObservation[];
}

export interface FredDataPoint {
  date: string;
  value: number;
}

// ═══════════════════════════════════════════════════════════════
// FRED CLIENT
// ═══════════════════════════════════════════════════════════════

const FRED_API_BASE = 'https://api.stlouisfed.org/fred';

// FRED API key - Get free key at https://fred.stlouisfed.org/docs/api/api_key.html
// Set FRED_API_KEY env variable for production
const FRED_API_KEY = process.env.FRED_API_KEY || '';

/**
 * Check if FRED API key is configured
 */
export function hasFredApiKey(): boolean {
  return FRED_API_KEY.length > 10;
}

/**
 * Fetch observations for a FRED series
 * 
 * @param seriesId - FRED series ID (e.g., "FEDFUNDS")
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD) or undefined for latest
 * @returns Array of data points
 */
export async function fetchFredSeries(
  seriesId: string,
  startDate?: string,
  endDate?: string
): Promise<FredDataPoint[]> {
  if (!hasFredApiKey()) {
    throw new Error('FRED_API_KEY not configured. Get free key at https://fred.stlouisfed.org/docs/api/api_key.html');
  }
  
  try {
    const params: Record<string, string> = {
      series_id: seriesId,
      api_key: FRED_API_KEY,
      file_type: 'json',
      sort_order: 'asc',
    };
    
    if (startDate) {
      params.observation_start = startDate;
    }
    
    if (endDate) {
      params.observation_end = endDate;
    }
    
    const response = await axios.get<FredSeriesResponse>(
      `${FRED_API_BASE}/series/observations`,
      { params, timeout: 30000 }
    );
    
    const observations = response.data.observations || [];
    
    // Filter and convert observations
    const points: FredDataPoint[] = [];
    
    for (const obs of observations) {
      // FRED uses "." for missing values
      if (obs.value === '.' || obs.value === '') {
        continue;
      }
      
      const value = parseFloat(obs.value);
      if (!Number.isFinite(value)) {
        continue;
      }
      
      points.push({
        date: obs.date,
        value,
      });
    }
    
    return points;
    
  } catch (error: any) {
    console.error(`[FRED] Error fetching ${seriesId}:`, error.message);
    throw new Error(`FRED fetch failed for ${seriesId}: ${error.message}`);
  }
}

/**
 * Fetch series metadata from FRED
 * 
 * @param seriesId - FRED series ID
 * @returns Series info
 */
export async function fetchFredSeriesInfo(seriesId: string): Promise<{
  id: string;
  title: string;
  frequency: string;
  units: string;
  seasonal_adjustment: string;
}> {
  try {
    const params = {
      series_id: seriesId,
      api_key: FRED_API_KEY,
      file_type: 'json',
    };
    
    const response = await axios.get(
      `${FRED_API_BASE}/series`,
      { params, timeout: 15000 }
    );
    
    const series = response.data.seriess?.[0];
    if (!series) {
      throw new Error(`Series ${seriesId} not found`);
    }
    
    return {
      id: series.id,
      title: series.title,
      frequency: series.frequency,
      units: series.units,
      seasonal_adjustment: series.seasonal_adjustment,
    };
    
  } catch (error: any) {
    console.error(`[FRED] Error fetching info for ${seriesId}:`, error.message);
    throw new Error(`FRED info fetch failed for ${seriesId}: ${error.message}`);
  }
}

/**
 * Check if FRED API is accessible
 */
export async function checkFredHealth(): Promise<{ ok: boolean; message: string }> {
  if (!hasFredApiKey()) {
    return {
      ok: false,
      message: 'FRED_API_KEY not configured. Set env variable or get free key at https://fred.stlouisfed.org/docs/api/api_key.html',
    };
  }
  
  try {
    // Try to fetch a known series with minimal data
    const points = await fetchFredSeries('FEDFUNDS', '2024-01-01', '2024-01-31');
    return {
      ok: points.length > 0,
      message: `FRED API accessible, got ${points.length} points`,
    };
  } catch (error: any) {
    return {
      ok: false,
      message: `FRED API error: ${error.message}`,
    };
  }
}
