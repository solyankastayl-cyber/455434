/**
 * Phase M: Timeframe Mapping
 * 
 * Convert logical TF names to Binance intervals
 */

import { TF } from './mtf_types.js';

/**
 * Convert TF to Binance interval format
 */
export function toBinanceInterval(tf: TF | string): string {
  switch (tf) {
    case '1D': return '1d';
    case '4H': return '4h';
    case '1H': return '1h';
    case '15m': return '15m';
    case '5m': return '5m';
    default: return tf.toLowerCase();
  }
}

/**
 * Convert Binance interval to logical TF
 */
export function fromBinanceInterval(interval: string): TF {
  switch (interval.toLowerCase()) {
    case '1d': return '1D';
    case '4h': return '4H';
    case '1h': return '1H';
    default: return '1D';
  }
}

/**
 * Get timeframe hierarchy (higher first)
 */
export function getTFHierarchy(): TF[] {
  return ['1D', '4H', '1H'];
}

/**
 * Check if tf1 is higher than tf2
 */
export function isHigherTF(tf1: TF, tf2: TF): boolean {
  const hierarchy = getTFHierarchy();
  return hierarchy.indexOf(tf1) < hierarchy.indexOf(tf2);
}

/**
 * Get minutes for timeframe
 */
export function getTFMinutes(tf: TF): number {
  switch (tf) {
    case '1D': return 1440;
    case '4H': return 240;
    case '1H': return 60;
    default: return 1440;
  }
}
