/**
 * FRED DATA INGESTION SERVICE
 * 
 * Загрузка макроэкономических данных из FRED API в MongoDB.
 * 
 * Key Requirements:
 * - Store releasedAt (publication date) for NoLookahead
 * - Store periodEnd (observation date)
 * - Handle revisions via vintage
 * - No future leakage
 * - No duplicate releasedAt
 */

import { Db, Collection } from 'mongodb';
import { SERIES_CONFIG } from '../macro_score.contract.js';

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface MacroSeriesRecord {
  seriesId: string;
  value: number;
  periodEnd: Date;
  releasedAt: Date;
  vintage?: string;
  source: 'FRED';
  createdAt: Date;
}

export interface FredObservation {
  date: string;
  value: string;
  realtime_start: string;
  realtime_end: string;
}

export interface FredApiResponse {
  observations: FredObservation[];
  count: number;
  offset: number;
  limit: number;
}

export interface IngestionResult {
  seriesId: string;
  status: 'success' | 'failed' | 'skipped';
  recordsInserted: number;
  recordsSkipped: number;
  error?: string;
  dateRange?: { start: string; end: string };
}

export interface FullIngestionResult {
  timestamp: string;
  totalSeries: number;
  successful: number;
  failed: number;
  totalRecords: number;
  results: IngestionResult[];
}

// ═══════════════════════════════════════════════════════════════
// FRED API CLIENT
// ═══════════════════════════════════════════════════════════════

const FRED_API_BASE = 'https://api.stlouisfed.org/fred';

function getFredApiKey(): string {
  const key = process.env.FRED_API_KEY;
  if (!key) {
    throw new Error('FRED_API_KEY not configured');
  }
  return key;
}

async function fetchFredSeries(
  seriesId: string,
  startDate: string = '2010-01-01',
  endDate?: string
): Promise<FredObservation[]> {
  const apiKey = getFredApiKey();
  const end = endDate || new Date().toISOString().slice(0, 10);
  
  // Standard observations (without output_type=2 which gives null values)
  const url = `${FRED_API_BASE}/series/observations?` +
    `series_id=${seriesId}` +
    `&api_key=${apiKey}` +
    `&file_type=json` +
    `&observation_start=${startDate}` +
    `&observation_end=${end}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`FRED API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as FredApiResponse;
  return data.observations || [];
}

/**
 * Fetch FRED release dates for a series
 * This gives us the actual publication dates
 */
async function fetchFredReleaseDates(
  seriesId: string,
  startDate: string = '2010-01-01'
): Promise<Map<string, Date>> {
  const apiKey = getFredApiKey();
  
  // First, get the release ID for this series
  const releaseUrl = `${FRED_API_BASE}/series/release?` +
    `series_id=${seriesId}` +
    `&api_key=${apiKey}` +
    `&file_type=json`;
  
  try {
    const releaseResponse = await fetch(releaseUrl);
    if (!releaseResponse.ok) {
      console.warn(`[FRED] Could not get release info for ${seriesId}`);
      return new Map();
    }
    
    const releaseData = await releaseResponse.json();
    const releases = releaseData.releases || [];
    
    if (releases.length === 0) {
      return new Map();
    }
    
    const releaseId = releases[0].id;
    
    // Get release dates
    const datesUrl = `${FRED_API_BASE}/release/dates?` +
      `release_id=${releaseId}` +
      `&api_key=${apiKey}` +
      `&file_type=json` +
      `&realtime_start=${startDate}` +
      `&include_release_dates_with_no_data=false`;
    
    const datesResponse = await fetch(datesUrl);
    if (!datesResponse.ok) {
      return new Map();
    }
    
    const datesData = await datesResponse.json();
    const releaseDates = datesData.release_dates || [];
    
    // Map date strings to Date objects
    const dateMap = new Map<string, Date>();
    for (const rd of releaseDates) {
      dateMap.set(rd.date, new Date(rd.date));
    }
    
    return dateMap;
  } catch (e) {
    console.warn(`[FRED] Release dates fetch failed for ${seriesId}:`, e);
    return new Map();
  }
}

// ═══════════════════════════════════════════════════════════════
// INGESTION LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Estimate release date based on series type
 * Different indicators have different release lags
 */
function estimateReleaseDate(seriesId: string, periodEnd: Date): Date {
  // Release lag in days (typical values)
  const releaseLags: Record<string, number> = {
    // Monthly with ~2 week lag
    CPIAUCSL: 14,
    CPILFESL: 14,
    PPIACO: 14,
    UNRATE: 7,
    M2SL: 21,
    HOUST: 18,
    INDPRO: 16,
    
    // Daily/Weekly
    FEDFUNDS: 1,
    T10Y2Y: 1,
    BAA10Y: 1,
    TEDRATE: 1,
    VIXCLS: 1,
  };
  
  const lag = releaseLags[seriesId] || 14;
  const releaseDate = new Date(periodEnd);
  releaseDate.setDate(releaseDate.getDate() + lag);
  
  return releaseDate;
}

async function ingestSeries(
  db: Db,
  seriesId: string,
  startDate: string = '2010-01-01'
): Promise<IngestionResult> {
  const collection = db.collection<MacroSeriesRecord>('macro_series');
  
  try {
    console.log(`[Ingestion] Fetching ${seriesId}...`);
    
    // Fetch observations from FRED
    const observations = await fetchFredSeries(seriesId, startDate);
    
    if (observations.length === 0) {
      return {
        seriesId,
        status: 'skipped',
        recordsInserted: 0,
        recordsSkipped: 0,
        error: 'No observations returned',
      };
    }
    
    // Fetch release dates (best effort)
    const releaseDates = await fetchFredReleaseDates(seriesId, startDate);
    
    // Check existing records to avoid duplicates
    const existingDates = await collection.distinct('periodEnd', { seriesId });
    const existingSet = new Set(existingDates.map(d => d.toISOString().slice(0, 10)));
    
    let inserted = 0;
    let skipped = 0;
    let minDate = observations[0].date;
    let maxDate = observations[0].date;
    
    const records: MacroSeriesRecord[] = [];
    
    for (const obs of observations) {
      // Skip invalid values
      if (obs.value === '.' || obs.value === '' || isNaN(parseFloat(obs.value))) {
        skipped++;
        continue;
      }
      
      // Skip duplicates
      if (existingSet.has(obs.date)) {
        skipped++;
        continue;
      }
      
      const periodEnd = new Date(obs.date);
      
      // Determine release date
      // FRED standard API returns realtime_start = today for all observations
      // So we ALWAYS use estimated release dates based on typical publication lags
      // This provides realistic "when would this data have been available" dates
      const releasedAt = estimateReleaseDate(seriesId, periodEnd);
      
      records.push({
        seriesId,
        value: parseFloat(obs.value),
        periodEnd,
        releasedAt,
        vintage: obs.realtime_start,
        source: 'FRED',
        createdAt: new Date(),
      });
      
      if (obs.date < minDate) minDate = obs.date;
      if (obs.date > maxDate) maxDate = obs.date;
    }
    
    // Bulk insert
    if (records.length > 0) {
      await collection.insertMany(records);
      inserted = records.length;
    }
    
    console.log(`[Ingestion] ${seriesId}: ${inserted} inserted, ${skipped} skipped`);
    
    return {
      seriesId,
      status: 'success',
      recordsInserted: inserted,
      recordsSkipped: skipped,
      dateRange: { start: minDate, end: maxDate },
    };
    
  } catch (e: any) {
    console.error(`[Ingestion] ${seriesId} failed:`, e.message);
    return {
      seriesId,
      status: 'failed',
      recordsInserted: 0,
      recordsSkipped: 0,
      error: e.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN INGESTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function runFullIngestion(
  db: Db,
  options: {
    startDate?: string;
    seriesIds?: string[];
    forceReload?: boolean;
  } = {}
): Promise<FullIngestionResult> {
  const startDate = options.startDate || '2010-01-01';
  const seriesIds = options.seriesIds || SERIES_CONFIG.map(s => s.key);
  
  console.log(`[Ingestion] Starting full ingestion for ${seriesIds.length} series from ${startDate}`);
  
  // Create indexes if not exist
  const collection = db.collection<MacroSeriesRecord>('macro_series');
  await collection.createIndex({ seriesId: 1, periodEnd: 1 }, { unique: true });
  await collection.createIndex({ seriesId: 1, releasedAt: 1 });
  await collection.createIndex({ releasedAt: 1 });
  
  // Optional: clear existing data
  if (options.forceReload) {
    console.log('[Ingestion] Force reload - clearing existing data');
    await collection.deleteMany({ seriesId: { $in: seriesIds } });
  }
  
  const results: IngestionResult[] = [];
  let totalRecords = 0;
  
  for (const seriesId of seriesIds) {
    // Add delay between requests to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const result = await ingestSeries(db, seriesId, startDate);
    results.push(result);
    totalRecords += result.recordsInserted;
  }
  
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  console.log(`[Ingestion] Complete: ${successful}/${seriesIds.length} success, ${totalRecords} records`);
  
  return {
    timestamp: new Date().toISOString(),
    totalSeries: seriesIds.length,
    successful,
    failed,
    totalRecords,
    results,
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA QUALITY CHECKS
// ═══════════════════════════════════════════════════════════════

export interface DataQualityReport {
  seriesId: string;
  recordCount: number;
  dateRange: { start: string; end: string } | null;
  gaps: Array<{ from: string; to: string; days: number }>;
  duplicateReleaseDates: number;
  futureLeak: number;
  coverage: number;
}

export async function checkDataQuality(
  db: Db,
  seriesId: string
): Promise<DataQualityReport> {
  const collection = db.collection<MacroSeriesRecord>('macro_series');
  
  const records = await collection
    .find({ seriesId })
    .sort({ periodEnd: 1 })
    .toArray();
  
  if (records.length === 0) {
    return {
      seriesId,
      recordCount: 0,
      dateRange: null,
      gaps: [],
      duplicateReleaseDates: 0,
      futureLeak: 0,
      coverage: 0,
    };
  }
  
  // Check for gaps
  const gaps: DataQualityReport['gaps'] = [];
  const maxGapDays = seriesId.includes('VIXCLS') ? 5 : 45; // Daily vs monthly
  
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].periodEnd;
    const curr = records[i].periodEnd;
    const daysDiff = Math.floor((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > maxGapDays) {
      gaps.push({
        from: prev.toISOString().slice(0, 10),
        to: curr.toISOString().slice(0, 10),
        days: daysDiff,
      });
    }
  }
  
  // Check for duplicate release dates
  const releaseDateCounts = new Map<string, number>();
  for (const r of records) {
    const key = r.releasedAt.toISOString().slice(0, 10);
    releaseDateCounts.set(key, (releaseDateCounts.get(key) || 0) + 1);
  }
  const duplicateReleaseDates = Array.from(releaseDateCounts.values()).filter(c => c > 1).length;
  
  // Check for future leak (releasedAt < periodEnd)
  const futureLeak = records.filter(r => r.releasedAt < r.periodEnd).length;
  
  // Calculate coverage (expected vs actual records)
  const firstDate = records[0].periodEnd;
  const lastDate = records[records.length - 1].periodEnd;
  const totalDays = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
  const expectedRecords = seriesId.includes('VIXCLS') ? totalDays : totalDays / 30;
  const coverage = records.length / Math.max(expectedRecords, 1);
  
  return {
    seriesId,
    recordCount: records.length,
    dateRange: {
      start: firstDate.toISOString().slice(0, 10),
      end: lastDate.toISOString().slice(0, 10),
    },
    gaps,
    duplicateReleaseDates,
    futureLeak,
    coverage: Math.min(coverage, 1),
  };
}

export async function runFullQualityCheck(db: Db): Promise<DataQualityReport[]> {
  const reports: DataQualityReport[] = [];
  
  for (const config of SERIES_CONFIG) {
    const report = await checkDataQuality(db, config.key);
    reports.push(report);
  }
  
  return reports;
}

export default {
  runFullIngestion,
  checkDataQuality,
  runFullQualityCheck,
};
