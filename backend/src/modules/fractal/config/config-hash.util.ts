/**
 * P1-A: Config Hash Utility
 * 
 * Creates deterministic hash of model config for version tracking.
 */

import crypto from 'crypto';

/**
 * Create SHA256 hash of config object
 * Normalizes by sorting keys for consistency
 */
export function hashConfig(config: any): string {
  const normalized = JSON.stringify(sortKeys(config));
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .substring(0, 16); // Short hash for readability
}

/**
 * Sort object keys recursively for consistent hashing
 */
function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  
  return Object.keys(obj)
    .sort()
    .reduce((sorted: any, key) => {
      sorted[key] = sortKeys(obj[key]);
      return sorted;
    }, {});
}

/**
 * Generate version string from timestamp
 * Uses milliseconds for uniqueness in rapid succession
 */
export function generateVersion(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `v${y}${m}${d}.${h}${min}${sec}.${ms}`;
}
