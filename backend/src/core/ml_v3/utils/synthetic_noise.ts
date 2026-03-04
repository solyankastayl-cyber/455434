/**
 * Synthetic Noise Utils - P0.1
 * 
 * Functions for applying controlled noise to feature values
 */

/**
 * Apply noise to a numeric value
 * 
 * @param value - Original value
 * @param pct - Noise percentage (0-100, e.g., 2.5 = ±2.5%)
 * @param seed - Seed for reproducibility
 * @returns Noisy value
 */
export function applyNoise(value: number, pct: number, seed: number): number {
  // Deterministic pseudo-random based on seed + value
  const rand = Math.sin(seed + value * 1000) * 10000;
  const normalized = rand - Math.floor(rand); // [0, 1)
  const noise = (normalized - 0.5) * 2; // [-1, 1]
  
  return value * (1 + (noise * pct) / 100);
}

/**
 * Apply noise to all numeric features in a row
 * 
 * @param row - Data row
 * @param pct - Noise percentage
 * @param seed - Seed for reproducibility
 * @param excludeFields - Fields to exclude from noise
 * @returns Noisy row
 */
export function applyNoiseToRow(
  row: Record<string, any>,
  pct: number,
  seed: number,
  excludeFields: string[] = ['label', 'datasetId', 'network', 'bucketTs', 'timestamp', 'version']
): Record<string, any> {
  const noisyRow = { ...row };
  
  for (const key of Object.keys(noisyRow)) {
    if (excludeFields.includes(key)) {
      continue;
    }
    
    if (typeof noisyRow[key] === 'number' && !isNaN(noisyRow[key])) {
      noisyRow[key] = applyNoise(noisyRow[key], pct, seed + hashString(key));
    }
  }
  
  return noisyRow;
}

/**
 * Simple string hash for deterministic seeding
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Time-shift a row by bucketTs offset
 */
export function timeShiftRow(
  row: Record<string, any>,
  shiftBuckets: number
): Record<string, any> {
  const shifted = { ...row };
  
  if (typeof shifted.bucketTs === 'number') {
    shifted.bucketTs += shiftBuckets * 3600; // 1 bucket = 1 hour
  }
  
  if (shifted.timestamp instanceof Date) {
    shifted.timestamp = new Date(shifted.timestamp.getTime() + shiftBuckets * 3600000);
  }
  
  return shifted;
}
