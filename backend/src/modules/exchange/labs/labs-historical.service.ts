/**
 * Labs Historical Service
 * 
 * Provides historical context for Labs:
 * - Rolling averages (24h, 7d)
 * - Percentile calculations
 * - Anomaly detection
 * - Trend analysis
 */

import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';

let db: Db | null = null;

async function getDb(): Promise<Db> {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

export interface HistoricalStats {
  symbol: string;
  period: '1h' | '4h' | '24h' | '7d';
  volume: {
    avg: number;
    min: number;
    max: number;
    stdDev: number;
  };
  volatility: {
    avg: number;
    min: number;
    max: number;
  };
  priceChange: {
    avg: number;
    min: number;
    max: number;
  };
  liquidations: {
    avgLong: number;
    avgShort: number;
    maxTotal: number;
  };
  sampleCount: number;
  calculatedAt: string;
}

// Cache for historical stats
const statsCache: Map<string, { data: HistoricalStats; expiry: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getHistoricalStats(symbol: string, period: '1h' | '4h' | '24h' | '7d' = '24h'): Promise<HistoricalStats | null> {
  const cacheKey = `${symbol}_${period}`;
  const cached = statsCache.get(cacheKey);
  
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const database = await getDb();
  const observations = database.collection('exchange_observations');
  
  // Calculate time window
  const periodMs = {
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  
  const startTime = Date.now() - periodMs[period];
  
  const pipeline = [
    { 
      $match: { 
        symbol,
        timestamp: { $gte: startTime }
      }
    },
    {
      $group: {
        _id: null,
        // Volume stats
        avgVolume: { $avg: '$volume.total' },
        minVolume: { $min: '$volume.total' },
        maxVolume: { $max: '$volume.total' },
        volumes: { $push: '$volume.total' },
        // Volatility stats
        avgVolatility: { $avg: '$market.volatility' },
        minVolatility: { $min: '$market.volatility' },
        maxVolatility: { $max: '$market.volatility' },
        // Price change stats
        avgPriceChange: { $avg: '$market.priceChange15m' },
        minPriceChange: { $min: '$market.priceChange15m' },
        maxPriceChange: { $max: '$market.priceChange15m' },
        // Liquidation stats
        avgLongLiq: { $avg: '$liquidations.longVolume' },
        avgShortLiq: { $avg: '$liquidations.shortVolume' },
        maxLiq: { $max: { $add: ['$liquidations.longVolume', '$liquidations.shortVolume'] } },
        // Count
        count: { $sum: 1 }
      }
    }
  ];

  const result = await observations.aggregate(pipeline).toArray();
  
  if (!result[0] || result[0].count < 3) {
    return null;
  }

  const r = result[0];
  
  // Calculate standard deviation for volume
  const volumes = r.volumes.filter((v: any) => v != null) as number[];
  const avgVol = r.avgVolume || 0;
  const variance = volumes.reduce((sum, v) => sum + Math.pow(v - avgVol, 2), 0) / volumes.length;
  const stdDev = Math.sqrt(variance);

  const stats: HistoricalStats = {
    symbol,
    period,
    volume: {
      avg: r.avgVolume || 0,
      min: r.minVolume || 0,
      max: r.maxVolume || 0,
      stdDev,
    },
    volatility: {
      avg: r.avgVolatility || 0,
      min: r.minVolatility || 0,
      max: r.maxVolatility || 0,
    },
    priceChange: {
      avg: r.avgPriceChange || 0,
      min: r.minPriceChange || 0,
      max: r.maxPriceChange || 0,
    },
    liquidations: {
      avgLong: r.avgLongLiq || 0,
      avgShort: r.avgShortLiq || 0,
      maxTotal: r.maxLiq || 0,
    },
    sampleCount: r.count,
    calculatedAt: new Date().toISOString(),
  };

  // Cache the result
  statsCache.set(cacheKey, { data: stats, expiry: Date.now() + CACHE_TTL });
  
  return stats;
}

// Calculate percentile position
export function calculatePercentile(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

// Detect if value is anomalous (outside 2 std deviations)
export function isAnomaly(value: number, avg: number, stdDev: number): boolean {
  if (stdDev === 0) return false;
  const zScore = Math.abs((value - avg) / stdDev);
  return zScore > 2;
}

// Get trend direction based on recent vs historical
export function getTrend(current: number, historical: number): 'up' | 'down' | 'stable' {
  const change = historical > 0 ? (current - historical) / historical : 0;
  if (change > 0.1) return 'up';
  if (change < -0.1) return 'down';
  return 'stable';
}

console.log('[LABS.HISTORICAL] Service loaded');
