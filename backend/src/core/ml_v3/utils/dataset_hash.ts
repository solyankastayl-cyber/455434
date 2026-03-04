/**
 * Dataset Hash Utils - P0.1
 * 
 * Functions for computing row hashes and deduplication
 */
import crypto from 'crypto';

/**
 * Compute hash of a row for deduplication
 * 
 * @param row - Data row
 * @param fields - Fields to include in hash (if not specified, uses all numeric fields)
 * @returns Hash string
 */
export function rowHash(
  row: Record<string, any>,
  fields?: string[]
): string {
  const fieldsToHash = fields || Object.keys(row).filter(k => 
    typeof row[k] === 'number' && !['bucketTs', 'timestamp'].includes(k)
  );
  
  const values = fieldsToHash.map(k => row[k]).join('|');
  
  return crypto
    .createHash('sha256')
    .update(values)
    .digest('hex')
    .substring(0, 16); // Short hash for efficiency
}

/**
 * Deduplicate rows based on hash
 * 
 * @param rows - Array of rows
 * @returns Deduplicated rows
 */
export function deduplicateRows(rows: Record<string, any>[]): Record<string, any>[] {
  const seen = new Set<string>();
  const unique: Record<string, any>[] = [];
  
  for (const row of rows) {
    const hash = rowHash(row);
    if (!seen.has(hash)) {
      seen.add(hash);
      unique.push(row);
    }
  }
  
  return unique;
}
