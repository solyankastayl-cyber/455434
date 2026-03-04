/**
 * Phase K: Dataset Writer
 * 
 * Write ML dataset to various formats: CSV, JSON, MongoDB
 */

import fs from 'fs';
import path from 'path';
import { MLRow } from './dataset_types.js';
import { Db } from 'mongodb';

/**
 * Write dataset to CSV file
 */
export function writeCSV(rows: MLRow[], filePath: string): { ok: boolean; path: string; rows: number } {
  if (!rows.length) {
    return { ok: false, path: filePath, rows: 0 };
  }

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Get column headers from first row
  const keys = Object.keys(rows[0]) as (keyof MLRow)[];

  // Build CSV content
  const lines: string[] = [keys.join(',')];

  for (const row of rows) {
    const values = keys.map(k => {
      const v = row[k];
      // Escape strings with commas
      if (typeof v === 'string' && v.includes(',')) {
        return `"${v}"`;
      }
      return String(v);
    });
    lines.push(values.join(','));
  }

  fs.writeFileSync(filePath, lines.join('\n'));

  console.log(`[ML Dataset] Wrote ${rows.length} rows to ${filePath}`);

  return { ok: true, path: filePath, rows: rows.length };
}

/**
 * Write dataset to JSON file
 */
export function writeJSON(rows: MLRow[], filePath: string): { ok: boolean; path: string; rows: number } {
  if (!rows.length) {
    return { ok: false, path: filePath, rows: 0 };
  }

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data = {
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  console.log(`[ML Dataset] Wrote ${rows.length} rows to ${filePath}`);

  return { ok: true, path: filePath, rows: rows.length };
}

/**
 * Write dataset to MongoDB collection
 */
export async function writeToMongo(
  rows: MLRow[],
  db: Db,
  collectionName: string = 'ta_ml_rows'
): Promise<{ ok: boolean; inserted: number; collection: string }> {
  if (!rows.length) {
    return { ok: false, inserted: 0, collection: collectionName };
  }

  const collection = db.collection(collectionName);

  // Add metadata to each row
  const docs = rows.map(row => ({
    ...row,
    insertedAt: new Date(),
  }));

  // Clear existing and insert new (full refresh)
  await collection.deleteMany({});
  const result = await collection.insertMany(docs);

  console.log(`[ML Dataset] Inserted ${result.insertedCount} rows to ${collectionName}`);

  return {
    ok: true,
    inserted: result.insertedCount,
    collection: collectionName,
  };
}

/**
 * Export dataset in multiple formats
 */
export async function exportDataset(
  rows: MLRow[],
  db: Db,
  options: {
    csvPath?: string;
    jsonPath?: string;
    mongoCollection?: string;
  } = {}
): Promise<{
  ok: boolean;
  csv?: { path: string; rows: number };
  json?: { path: string; rows: number };
  mongo?: { collection: string; inserted: number };
}> {
  const result: any = { ok: true };

  // Write CSV if path provided
  if (options.csvPath) {
    result.csv = writeCSV(rows, options.csvPath);
  }

  // Write JSON if path provided
  if (options.jsonPath) {
    result.json = writeJSON(rows, options.jsonPath);
  }

  // Write to MongoDB if collection provided
  if (options.mongoCollection) {
    result.mongo = await writeToMongo(rows, db, options.mongoCollection);
  }

  return result;
}

/**
 * Get default export paths
 */
export function getDefaultPaths(): {
  csvPath: string;
  jsonPath: string;
} {
  const dataDir = path.resolve(process.cwd(), 'data');
  
  return {
    csvPath: path.join(dataDir, 'ml_dataset.csv'),
    jsonPath: path.join(dataDir, 'ml_dataset.json'),
  };
}
