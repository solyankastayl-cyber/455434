/**
 * Phase N1: Cache Keys
 * 
 * Standardized cache key generation
 */

export function decisionKey(asset: string, tf: string): string {
  return `ta:decision:${asset}:${tf}`;
}

export function mtfKey(asset: string): string {
  return `ta:mtf:${asset}`;
}

export function patternKey(asset: string, tf: string): string {
  return `ta:patterns:${asset}:${tf}`;
}

export function structureKey(asset: string, tf: string): string {
  return `ta:structure:${asset}:${tf}`;
}

export function regimeKey(asset: string, tf: string): string {
  return `ta:regime:${asset}:${tf}`;
}

export function candlesKey(asset: string, tf: string): string {
  return `ta:candles:${asset}:${tf}`;
}

/**
 * Parse cache key back to components
 */
export function parseKey(key: string): { type: string; asset: string; tf?: string } | null {
  const parts = key.split(':');
  if (parts.length < 3) return null;
  return {
    type: parts[1],
    asset: parts[2],
    tf: parts[3],
  };
}
