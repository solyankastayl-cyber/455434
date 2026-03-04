/**
 * Window Service (P0 - Common Platform Layer)
 * 
 * Unified time window handling
 * Windows: 1h, 6h, 24h, 7d
 */

export type TimeWindow = '1h' | '6h' | '24h' | '7d';

export const WINDOW_MS: Record<TimeWindow, number> = {
  '1h': 1 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export const WINDOW_LABELS: Record<TimeWindow, string> = {
  '1h': '1 Hour',
  '6h': '6 Hours',
  '24h': '24 Hours',
  '7d': '7 Days',
};

/**
 * Parse window from query string
 */
export function parseWindow(input: string | undefined, defaultWindow: TimeWindow = '24h'): TimeWindow {
  if (!input) return defaultWindow;
  
  const normalized = input.toLowerCase().trim();
  
  if (normalized === '1h' || normalized === '1hour') return '1h';
  if (normalized === '6h' || normalized === '6hours') return '6h';
  if (normalized === '24h' || normalized === '1d' || normalized === '24hours') return '24h';
  if (normalized === '7d' || normalized === '1w' || normalized === '7days') return '7d';
  
  return defaultWindow;
}

/**
 * Get cutoff date for window
 */
export function getWindowCutoff(window: TimeWindow): Date {
  return new Date(Date.now() - WINDOW_MS[window]);
}

/**
 * Get window duration in milliseconds
 */
export function getWindowDuration(window: TimeWindow): number {
  return WINDOW_MS[window];
}

/**
 * Format window for display
 */
export function formatWindow(window: TimeWindow): string {
  return WINDOW_LABELS[window];
}

/**
 * Check if timestamp is within window
 */
export function isWithinWindow(timestamp: Date | string | number, window: TimeWindow): boolean {
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const cutoff = getWindowCutoff(window).getTime();
  return ts >= cutoff;
}

/**
 * Get all supported windows
 */
export function getSupportedWindows(): TimeWindow[] {
  return ['1h', '6h', '24h', '7d'];
}

/**
 * Validate window
 */
export function isValidWindow(input: string): input is TimeWindow {
  return ['1h', '6h', '24h', '7d'].includes(input);
}
