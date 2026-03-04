/**
 * Database Indexes
 * Run this on startup or via migration script
 */

import { mongoose } from './mongoose.js';

export async function ensureIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    console.log('[DB] No database connection, skipping indexes');
    return;
  }

  // Exchange Forecasts indexes
  try {
    const forecastsCol = db.collection('exchange_forecasts');
    await forecastsCol.createIndex({ asset: 1, createdAt: -1 });
    await forecastsCol.createIndex({ asset: 1, horizon: 1, evaluated: 1 });
    await forecastsCol.createIndex({ evaluated: 1, evaluateAfter: 1 });
    await forecastsCol.createIndex({ symbol: 1, horizon: 1 });
    console.log('[DB] exchange_forecasts indexes created');
  } catch (err: any) {
    console.log('[DB] exchange_forecasts indexes already exist or error:', err.message);
  }

  console.log('[DB] Indexes ensured');
}

export async function dropIndexes(): Promise<void> {
  const collections = await mongoose.connection.db?.collections();
  if (!collections) return;

  for (const collection of collections) {
    await collection.dropIndexes();
  }
  console.log('[DB] Indexes dropped');
}
