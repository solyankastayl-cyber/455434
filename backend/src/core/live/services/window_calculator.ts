/**
 * Window Calculator
 * 
 * Pure functions for time window calculations.
 * NO side effects, NO Date.now(), NO external state.
 * 
 * All times are UTC.
 */

import type { WindowSize } from '../models/live_aggregate_window.model.js';

// ==================== CONSTANTS ====================

export const WINDOW_DURATIONS_MS: Record<WindowSize, number> = {
  '1h': 60 * 60 * 1000,        // 3,600,000
  '6h': 6 * 60 * 60 * 1000,    // 21,600,000
  '24h': 24 * 60 * 60 * 1000,  // 86,400,000
};

export const WINDOWS: WindowSize[] = ['1h', '6h', '24h'];

// ==================== PURE FUNCTIONS ====================

/**
 * Floor a timestamp to the start of its window
 * 
 * @param timestamp - Any timestamp
 * @param window - Window size
 * @returns Start of the window containing this timestamp
 */
export function floorToWindowStart(timestamp: Date, window: WindowSize): Date {
  const ms = timestamp.getTime();
  const duration = WINDOW_DURATIONS_MS[window];
  const floored = Math.floor(ms / duration) * duration;
  return new Date(floored);
}

/**
 * Get window bounds for a timestamp
 * 
 * @param timestamp - Any timestamp
 * @param window - Window size
 * @returns { start, end } of the window
 */
export function getWindowBounds(
  timestamp: Date,
  window: WindowSize
): { start: Date; end: Date } {
  const start = floorToWindowStart(timestamp, window);
  const end = new Date(start.getTime() + WINDOW_DURATIONS_MS[window]);
  return { start, end };
}

/**
 * Check if a window is closed (safe to aggregate)
 * 
 * @param windowEnd - End of the window
 * @param safeTime - Current "safe" time (with confirmations buffer)
 * @returns true if window is fully closed
 */
export function isWindowClosed(windowEnd: Date, safeTime: Date): boolean {
  return windowEnd.getTime() <= safeTime.getTime();
}

/**
 * Get all closed windows between two timestamps
 * 
 * @param fromTime - Start time (exclusive - windows after this)
 * @param toTime - End time (safe head time)
 * @param window - Window size
 * @returns Array of { start, end } for closed windows
 */
export function getClosedWindows(
  fromTime: Date,
  toTime: Date,
  window: WindowSize
): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  const duration = WINDOW_DURATIONS_MS[window];
  
  // Start from the next window after fromTime
  let currentStart = floorToWindowStart(fromTime, window);
  if (currentStart.getTime() <= fromTime.getTime()) {
    currentStart = new Date(currentStart.getTime() + duration);
  }
  
  // Collect all closed windows
  while (true) {
    const currentEnd = new Date(currentStart.getTime() + duration);
    
    // Stop if window is not yet closed
    if (!isWindowClosed(currentEnd, toTime)) {
      break;
    }
    
    windows.push({ start: currentStart, end: currentEnd });
    currentStart = new Date(currentStart.getTime() + duration);
  }
  
  return windows;
}

/**
 * Get the safe time for aggregation (now minus confirmations buffer)
 * 
 * @param currentTime - Current time
 * @param confirmations - Number of block confirmations (default: 12)
 * @param blockTimeSeconds - Average block time in seconds (default: 12)
 * @returns Safe time for aggregation
 */
export function getSafeTime(
  currentTime: Date,
  confirmations: number = 12,
  blockTimeSeconds: number = 12
): Date {
  const bufferMs = confirmations * blockTimeSeconds * 1000;
  return new Date(currentTime.getTime() - bufferMs);
}

/**
 * Format window for logging
 */
export function formatWindow(start: Date, end: Date, window: WindowSize): string {
  return `[${window}] ${start.toISOString()} → ${end.toISOString()}`;
}
