/**
 * MACRO AS-OF SERVICE — P3
 * 
 * Handles publication lag for honest backtesting.
 * Each macro series has a release delay — data isn't known instantly.
 * 
 * KEY PRINCIPLE:
 *   For asOfDate T, only use data where releaseDate <= T
 * 
 * ISOLATION: Pure utility, no business logic
 */

// ═══════════════════════════════════════════════════════════════
// LAG PROFILES BY SERIES
// ═══════════════════════════════════════════════════════════════

/**
 * Publication lag in days for each series.
 * 
 * Sources:
 * - FRED release calendar
 * - Historical observation
 * 
 * Conservative estimates (real lag may vary).
 */
export const SERIES_LAG_DAYS: Record<string, number> = {
  // ─────────────────────────────────────────────────────────────
  // RATES (Fed policy)
  // ─────────────────────────────────────────────────────────────
  'FEDFUNDS': 1,        // Daily, next day
  'DFF': 1,             // Daily effective FF rate
  'SOFR': 1,            // Daily
  
  // ─────────────────────────────────────────────────────────────
  // INFLATION (Monthly, ~14 day lag)
  // ─────────────────────────────────────────────────────────────
  'CPIAUCSL': 14,       // CPI monthly, ~2 weeks lag
  'CPILFESL': 14,       // Core CPI
  'PCEPI': 28,          // PCE, ~4 weeks lag
  'PCEPILFE': 28,       // Core PCE
  'PPIACO': 14,         // PPI
  
  // ─────────────────────────────────────────────────────────────
  // LABOR (Monthly, ~5 day lag)
  // ─────────────────────────────────────────────────────────────
  'UNRATE': 5,          // Unemployment, first Friday
  'PAYEMS': 5,          // Nonfarm payrolls
  'ICSA': 5,            // Initial claims (weekly, Thursday)
  'CCSA': 5,            // Continued claims
  
  // ─────────────────────────────────────────────────────────────
  // LIQUIDITY (Fed balance sheet)
  // ─────────────────────────────────────────────────────────────
  'M2SL': 21,           // M2, ~3 weeks lag
  'WALCL': 7,           // Fed balance sheet, weekly (Thursday)
  'RRPONTSYD': 1,       // Reverse repo, next day
  'WTREGEN': 7,         // TGA, weekly
  
  // ─────────────────────────────────────────────────────────────
  // YIELD CURVE (Daily, minimal lag)
  // ─────────────────────────────────────────────────────────────
  'T10Y2Y': 1,          // 10Y-2Y spread
  'T10Y3M': 1,          // 10Y-3M spread
  'DGS10': 1,           // 10Y yield
  'DGS2': 1,            // 2Y yield
  
  // ─────────────────────────────────────────────────────────────
  // HOUSING (Monthly, ~3-4 weeks lag)
  // ─────────────────────────────────────────────────────────────
  'MORTGAGE30US': 5,    // Mortgage rates (weekly)
  'HOUST': 21,          // Housing starts
  'PERMIT': 21,         // Building permits
  'CSUSHPISA': 60,      // Case-Shiller (2 month lag!)
  
  // ─────────────────────────────────────────────────────────────
  // ACTIVITY (Monthly, varies)
  // ─────────────────────────────────────────────────────────────
  'NAPM': 3,            // ISM PMI (first business day)
  'MANEMP': 5,          // Manufacturing Employment (with payrolls)
  'INDPRO': 17,         // Industrial production
  'TCU': 17,            // Capacity utilization
  'RSXFS': 17,          // Retail sales
  
  // ─────────────────────────────────────────────────────────────
  // CREDIT (Daily/Weekly)
  // ─────────────────────────────────────────────────────────────
  'BAA10Y': 1,          // Baa spread (daily)
  'BAMLH0A0HYM2': 1,    // HY spread (daily)
  'TEDRATE': 1,         // TED spread (daily)
  'STLFSI4': 7,         // St Louis Financial Stress (weekly)
  
  // ─────────────────────────────────────────────────────────────
  // VOLATILITY
  // ─────────────────────────────────────────────────────────────
  'VIXCLS': 1,          // VIX (daily)
};

/**
 * Default lag for unknown series
 */
export const DEFAULT_LAG_DAYS = 7;

// ═══════════════════════════════════════════════════════════════
// AS-OF DATE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Get the lag days for a series
 */
export function getSeriesLag(seriesId: string): number {
  return SERIES_LAG_DAYS[seriesId] ?? DEFAULT_LAG_DAYS;
}

/**
 * Calculate release date from value date.
 * 
 * releaseDate = valueDate + lagDays
 */
export function calculateReleaseDate(valueDate: string, seriesId: string): string {
  const lagDays = getSeriesLag(seriesId);
  const date = new Date(valueDate);
  date.setUTCDate(date.getUTCDate() + lagDays);
  return date.toISOString().split('T')[0];
}

/**
 * Calculate the latest value date available as of a given date.
 * 
 * If asOfDate = 2022-06-15 and lag = 14 days:
 *   latestValueDate = 2022-06-01 (data released by 2022-06-15)
 */
export function calculateLatestValueDate(asOfDate: string, seriesId: string): string {
  const lagDays = getSeriesLag(seriesId);
  const date = new Date(asOfDate);
  date.setUTCDate(date.getUTCDate() - lagDays);
  return date.toISOString().split('T')[0];
}

/**
 * Check if a data point would be available at asOfDate.
 * 
 * Available if: valueDate + lagDays <= asOfDate
 */
export function isDataAvailable(
  valueDate: string,
  asOfDate: string,
  seriesId: string
): boolean {
  const releaseDate = calculateReleaseDate(valueDate, seriesId);
  return releaseDate <= asOfDate;
}

// ═══════════════════════════════════════════════════════════════
// FILTER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Filter data points to only those available as of a given date.
 * 
 * This is the key function for honest backtesting.
 */
export function filterByAsOf<T extends { date: string }>(
  points: T[],
  asOfDate: string,
  seriesId: string
): T[] {
  const lagDays = getSeriesLag(seriesId);
  
  return points.filter(p => {
    const releaseDate = new Date(p.date);
    releaseDate.setUTCDate(releaseDate.getUTCDate() + lagDays);
    const releaseDateStr = releaseDate.toISOString().split('T')[0];
    return releaseDateStr <= asOfDate;
  });
}

/**
 * Get latest available value as of a date.
 * 
 * Returns null if no data available yet.
 */
export function getLatestAsOf<T extends { date: string; value: number }>(
  points: T[],
  asOfDate: string,
  seriesId: string
): T | null {
  const available = filterByAsOf(points, asOfDate, seriesId);
  
  if (available.length === 0) return null;
  
  // Return the latest available point
  return available[available.length - 1];
}

// ═══════════════════════════════════════════════════════════════
// SERIES METADATA
// ═══════════════════════════════════════════════════════════════

export interface SeriesLagInfo {
  seriesId: string;
  lagDays: number;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  description: string;
}

/**
 * Get lag info for a series
 */
export function getSeriesLagInfo(seriesId: string): SeriesLagInfo {
  const lagDays = getSeriesLag(seriesId);
  
  // Infer frequency from lag
  let frequency: SeriesLagInfo['frequency'] = 'monthly';
  if (lagDays <= 2) frequency = 'daily';
  else if (lagDays <= 10) frequency = 'weekly';
  else if (lagDays >= 60) frequency = 'quarterly';
  
  return {
    seriesId,
    lagDays,
    frequency,
    description: `${lagDays} day publication lag`,
  };
}

/**
 * Get all lag profiles
 */
export function getAllLagProfiles(): SeriesLagInfo[] {
  return Object.keys(SERIES_LAG_DAYS).map(getSeriesLagInfo);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export const AsOfService = {
  getSeriesLag,
  calculateReleaseDate,
  calculateLatestValueDate,
  isDataAvailable,
  filterByAsOf,
  getLatestAsOf,
  getSeriesLagInfo,
  getAllLagProfiles,
};

export default AsOfService;
