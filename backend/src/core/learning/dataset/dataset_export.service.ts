/**
 * Dataset Export Service
 * 
 * ETAP 3.4: Export training data to JSONL/CSV.
 * 
 * Streaming exports to handle large datasets without memory issues.
 */
import { LearningSampleModel, type ILearningSample } from './learning_sample.model.js';
import type { Horizon } from '../learning.types.js';
import { DATASET_SCHEMA_VERSION } from '../types/dataset.types.js';

// ==================== TYPES ====================

export interface ExportOptions {
  trainEligibleOnly: boolean;
  horizons?: Horizon[];
  bucket?: string;
  verdict?: string;
  limit?: number;
  includeMetadata?: boolean;
}

export interface ExportMeta {
  schemaVersion: string;
  exportedAt: string;
  totalSamples: number;
  filters: ExportOptions;
}

// ==================== JSONL EXPORT ====================

/**
 * Export samples to JSONL format (newline-delimited JSON)
 * Returns an async generator for streaming
 */
export async function* exportJSONLStream(
  options: ExportOptions
): AsyncGenerator<string> {
  const query = buildExportQuery(options);
  const limit = options.limit || 10000;
  
  // Yield metadata first
  if (options.includeMetadata) {
    const total = await LearningSampleModel.countDocuments(query);
    const meta: ExportMeta = {
      schemaVersion: DATASET_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      totalSamples: total,
      filters: options,
    };
    yield `// META: ${JSON.stringify(meta)}\n`;
  }
  
  // Stream samples
  const cursor = LearningSampleModel.find(query)
    .sort({ snapshotAt: -1 })
    .limit(limit)
    .cursor();
  
  for await (const sample of cursor) {
    const record = sampleToExportRecord(sample);
    yield JSON.stringify(record) + '\n';
  }
}

/**
 * Export all samples to JSONL string
 */
export async function exportJSONL(options: ExportOptions): Promise<string> {
  const lines: string[] = [];
  
  for await (const line of exportJSONLStream(options)) {
    lines.push(line);
  }
  
  return lines.join('');
}

// ==================== CSV EXPORT ====================

const CSV_HEADERS = [
  // Identity
  'sampleId',
  'snapshotId',
  'tokenAddress',
  'symbol',
  'snapshotAt',
  
  // Snapshot features
  'bucket',
  'compositeScore',
  'engineConfidence_raw',
  'risk_raw',
  'actorSignalScore',
  'engineMode',
  
  // Drift features
  'driftLevel',
  'driftScore',
  'confidenceModifier',
  'engineConfidence_adj',
  
  // Live features
  'live_netFlow',
  'live_inflow',
  'live_outflow',
  'live_uniqueSenders',
  'live_eventCount',
  'liveCoverage',
  
  // Market features
  'priceAtDecision',
  'mcapAtDecision',
  'volumeAtDecision',
  
  // Trend labels
  'trend_1d',
  'trend_7d',
  'trend_30d',
  
  // Delay labels
  'delayClass_7d',
  'delayClass_30d',
  
  // Outcome labels
  'ret_1d_pct',
  'ret_7d_pct',
  'ret_30d_pct',
  'maxDrawdown_7d',
  'maxDrawdown_30d',
  
  // Verdict labels
  'verdict_1d',
  'verdict_7d',
  'verdict_30d',
  
  // Quality
  'trainEligible',
  'dataCompleteness',
];

/**
 * Export samples to CSV format
 * Returns an async generator for streaming
 */
export async function* exportCSVStream(
  options: ExportOptions
): AsyncGenerator<string> {
  // Yield header row
  yield CSV_HEADERS.join(',') + '\n';
  
  const query = buildExportQuery(options);
  const limit = options.limit || 10000;
  
  const cursor = LearningSampleModel.find(query)
    .sort({ snapshotAt: -1 })
    .limit(limit)
    .cursor();
  
  for await (const sample of cursor) {
    const row = sampleToCSVRow(sample);
    yield row + '\n';
  }
}

/**
 * Export all samples to CSV string
 */
export async function exportCSV(options: ExportOptions): Promise<string> {
  const lines: string[] = [];
  
  for await (const line of exportCSVStream(options)) {
    lines.push(line);
  }
  
  return lines.join('');
}

// ==================== HELPERS ====================

function buildExportQuery(options: ExportOptions): any {
  const query: any = {};
  
  if (options.trainEligibleOnly) {
    query['quality.trainEligible'] = true;
  }
  
  if (options.horizons && options.horizons.length > 0) {
    query.horizon = { $in: options.horizons };
  }
  
  if (options.bucket) {
    query['features.snapshot.bucket'] = options.bucket;
  }
  
  if (options.verdict) {
    query['labels.verdicts.verdict_7d'] = options.verdict;
  }
  
  return query;
}

function sampleToExportRecord(sample: ILearningSample): any {
  return {
    // Remove MongoDB fields
    sampleId: sample.sampleId,
    snapshotId: sample.snapshotId,
    tokenAddress: sample.tokenAddress,
    symbol: sample.symbol,
    horizon: sample.horizon,
    snapshotAt: sample.snapshotAt,
    features: sample.features,
    labels: sample.labels,
    quality: sample.quality,
    schemaVersion: sample.schemaVersion,
    builtAt: sample.builtAt,
  };
}

function sampleToCSVRow(sample: ILearningSample): string {
  const values = [
    // Identity
    escapeCSV(sample.sampleId),
    escapeCSV(sample.snapshotId),
    escapeCSV(sample.tokenAddress),
    escapeCSV(sample.symbol),
    escapeCSV(sample.snapshotAt?.toISOString() || ''),
    
    // Snapshot features
    escapeCSV(sample.features.snapshot.bucket),
    sample.features.snapshot.compositeScore,
    sample.features.snapshot.engineConfidence_raw,
    sample.features.snapshot.risk_raw,
    sample.features.snapshot.actorSignalScore,
    escapeCSV(sample.features.snapshot.engineMode),
    
    // Drift features
    escapeCSV(sample.features.drift.driftLevel),
    sample.features.drift.driftScore,
    sample.features.drift.confidenceModifier,
    sample.features.drift.engineConfidence_adj,
    
    // Live features
    sample.features.live.live_netFlow,
    sample.features.live.live_inflow,
    sample.features.live.live_outflow,
    sample.features.live.live_uniqueSenders,
    sample.features.live.live_eventCount,
    escapeCSV(sample.features.live.liveCoverage),
    
    // Market features
    sample.features.market.priceAtDecision,
    sample.features.market.mcapAtDecision,
    sample.features.market.volumeAtDecision,
    
    // Trend labels
    escapeCSV(sample.labels.trends.trend_1d || ''),
    escapeCSV(sample.labels.trends.trend_7d || ''),
    escapeCSV(sample.labels.trends.trend_30d || ''),
    
    // Delay labels
    escapeCSV(sample.labels.delays.delayClass_7d || ''),
    escapeCSV(sample.labels.delays.delayClass_30d || ''),
    
    // Outcome labels
    sample.labels.outcomes.ret_1d_pct ?? '',
    sample.labels.outcomes.ret_7d_pct ?? '',
    sample.labels.outcomes.ret_30d_pct ?? '',
    sample.labels.outcomes.maxDrawdown_7d ?? '',
    sample.labels.outcomes.maxDrawdown_30d ?? '',
    
    // Verdict labels
    escapeCSV(sample.labels.verdicts.verdict_1d || ''),
    escapeCSV(sample.labels.verdicts.verdict_7d || ''),
    escapeCSV(sample.labels.verdicts.verdict_30d || ''),
    
    // Quality
    sample.quality.trainEligible,
    sample.quality.dataCompleteness,
  ];
  
  return values.join(',');
}

function escapeCSV(value: string): string {
  if (!value) return '';
  
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  
  return value;
}

/**
 * Get schema information for consumers
 */
export function getSchemaInfo(): {
  version: string;
  features: string[];
  labels: string[];
  csvHeaders: string[];
} {
  return {
    version: DATASET_SCHEMA_VERSION,
    features: [
      'snapshot.bucket',
      'snapshot.compositeScore',
      'snapshot.engineConfidence_raw',
      'snapshot.risk_raw',
      'snapshot.actorSignalScore',
      'snapshot.engineMode',
      'live.live_netFlow',
      'live.live_inflow',
      'live.live_outflow',
      'live.liveCoverage',
      'drift.driftLevel',
      'drift.driftScore',
      'drift.confidenceModifier',
      'drift.engineConfidence_adj',
      'market.priceAtDecision',
      'market.mcapAtDecision',
      'market.volumeAtDecision',
    ],
    labels: [
      'trends.trend_1d',
      'trends.trend_7d',
      'trends.trend_30d',
      'delays.delayClass_7d',
      'delays.delayClass_30d',
      'outcomes.ret_1d_pct',
      'outcomes.ret_7d_pct',
      'outcomes.ret_30d_pct',
      'verdicts.verdict_1d',
      'verdicts.verdict_7d',
      'verdicts.verdict_30d',
    ],
    csvHeaders: CSV_HEADERS,
  };
}
