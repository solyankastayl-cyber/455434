/**
 * DXY CHART SERVICE — Get OHLC Data
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { DxyCandleModel } from '../storage/dxy-candles.model.js';
import type { DxyCandle } from '../contracts/dxy.types.js';

// ═══════════════════════════════════════════════════════════════
// GET CHART DATA
// ═══════════════════════════════════════════════════════════════

export async function getDxyChart(limit = 450): Promise<DxyCandle[]> {
  const candles = await DxyCandleModel
    .find()
    .sort({ date: -1 })
    .limit(limit)
    .lean();
  
  // Reverse to chronological order
  return candles.reverse().map(c => ({
    date: typeof c.date === 'string' ? c.date : (c.date as Date).toISOString().split('T')[0],
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
    source: c.source,
  }));
}

// ═══════════════════════════════════════════════════════════════
// GET ALL CANDLES (for fractal scan)
// ═══════════════════════════════════════════════════════════════

export async function getAllDxyCandles(): Promise<DxyCandle[]> {
  const candles = await DxyCandleModel
    .find()
    .sort({ date: 1 })
    .lean();
  
  return candles.map(c => ({
    date: typeof c.date === 'string' ? c.date : (c.date as Date).toISOString().split('T')[0],
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
    source: c.source,
  }));
}

// ═══════════════════════════════════════════════════════════════
// GET LATEST PRICE
// ═══════════════════════════════════════════════════════════════

export async function getDxyLatestPrice(): Promise<{
  price: number;
  date: string;
  change24h: number;
} | null> {
  const latest = await DxyCandleModel
    .find()
    .sort({ date: -1 })
    .limit(2)
    .lean();
  
  if (latest.length < 1) return null;
  
  const current = latest[0];
  const previous = latest[1];
  
  const change24h = previous 
    ? ((current.close - previous.close) / previous.close) * 100
    : 0;
  
  // Handle both string and Date types
  const dateStr = typeof current.date === 'string' 
    ? current.date 
    : (current.date as Date).toISOString().split('T')[0];
  
  return {
    price: current.close,
    date: dateStr,
    change24h: Math.round(change24h * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET SMA
// ═══════════════════════════════════════════════════════════════

export async function getDxySma(period = 200): Promise<number | null> {
  const candles = await DxyCandleModel
    .find()
    .sort({ date: -1 })
    .limit(period)
    .lean();
  
  if (candles.length < period) return null;
  
  const sum = candles.reduce((acc, c) => acc + c.close, 0);
  return Math.round(sum / period * 100) / 100;
}
