/**
 * Analysis Envelope (P0 - Common Platform Layer)
 * 
 * Единый формат ответа для всех API
 * Гарантирует консистентность Frontend контракта
 */

export type AnalysisStatus = 'completed' | 'failed' | 'pending';
export type TimeWindow = '1h' | '6h' | '24h' | '7d';
export type DataSource = 'db_cache' | 'live';

export interface Interpretation {
  headline: string;
  description?: string;
}

export interface Coverage {
  pct: number;      // 0-100, полнота данных (НЕ качество)
  note: string;     // "Based on 847 transfers"
}

export interface AnalysisMeta {
  status: AnalysisStatus;
  window: TimeWindow;
  checked: string[]; // ["actor_flows", "corridors", "signals"]
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  interpretation: Interpretation;
  coverage: Coverage;
  analysis: AnalysisMeta;
  source: DataSource;
  error?: string;
}

/**
 * Build successful response with full envelope
 */
export function buildEnvelope<T>(
  data: T,
  options: {
    interpretation: Interpretation;
    coverage: Coverage;
    window: TimeWindow;
    checked: string[];
    source?: DataSource;
  }
): ApiEnvelope<T> {
  return {
    ok: true,
    data,
    interpretation: options.interpretation,
    coverage: options.coverage,
    analysis: {
      status: 'completed',
      window: options.window,
      checked: options.checked,
    },
    source: options.source || 'live',
  };
}

/**
 * Build cached response
 */
export function buildCachedEnvelope<T>(
  data: T,
  options: {
    interpretation: Interpretation;
    coverage: Coverage;
    window: TimeWindow;
    checked: string[];
  }
): ApiEnvelope<T> {
  return buildEnvelope(data, { ...options, source: 'db_cache' });
}

/**
 * Build pending response (still computing)
 */
export function buildPendingEnvelope<T>(
  partialData: T,
  window: TimeWindow,
  checked: string[]
): ApiEnvelope<T> {
  return {
    ok: true,
    data: partialData,
    interpretation: {
      headline: 'Analysis in progress',
      description: 'Data is being processed. Results may be incomplete.',
    },
    coverage: {
      pct: 0,
      note: 'Computing...',
    },
    analysis: {
      status: 'pending',
      window,
      checked,
    },
    source: 'live',
  };
}

/**
 * Build error response
 */
export function buildErrorEnvelope(
  error: string,
  window: TimeWindow = '24h'
): ApiEnvelope<null> {
  return {
    ok: false,
    data: null,
    interpretation: {
      headline: 'Analysis failed',
      description: error,
    },
    coverage: {
      pct: 0,
      note: 'No data available',
    },
    analysis: {
      status: 'failed',
      window,
      checked: [],
    },
    source: 'live',
    error,
  };
}

/**
 * Build empty result response (valid result, just no data)
 */
export function buildEmptyEnvelope(
  options: {
    message: string;
    window: TimeWindow;
    checked: string[];
    source?: DataSource;
  }
): ApiEnvelope<null> {
  return {
    ok: true,
    data: null,
    interpretation: {
      headline: options.message,
      description: `We checked ${options.checked.join(', ')}. Nothing found.`,
    },
    coverage: {
      pct: 100, // We checked everything, just empty
      note: `Checked: ${options.checked.join(', ')}`,
    },
    analysis: {
      status: 'completed',
      window: options.window,
      checked: options.checked,
    },
    source: options.source || 'live',
  };
}
