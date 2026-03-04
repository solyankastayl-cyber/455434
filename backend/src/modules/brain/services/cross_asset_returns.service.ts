/**
 * P9.0 — Cross-Asset Returns Service
 * 
 * Loads close prices for BTC/SPX/DXY/GOLD and computes log-returns.
 * All data is asOf-safe (only data <= asOf).
 */

import { getMongoDb } from '../../../db/mongoose.js';

export type CrossAssetId = 'btc' | 'spx' | 'dxy' | 'gold';

export interface PricePoint {
  date: string;   // YYYY-MM-DD
  close: number;
}

export interface ReturnPoint {
  date: string;
  ret1d: number;  // 1-day log return
  ret5d: number;  // 5-day log return
}

export class CrossAssetReturnsService {

  /**
   * Load close prices for asset, asOf-safe
   */
  async loadPrices(asset: CrossAssetId, startDate: string, asOf: string): Promise<PricePoint[]> {
    const db = getMongoDb()!;

    switch (asset) {
      case 'dxy':
        return this.loadDxyPrices(db, startDate, asOf);
      case 'spx':
        return this.loadSpxPrices(db, startDate, asOf);
      case 'btc':
        return this.loadBtcPrices(db, startDate, asOf);
      case 'gold':
        return this.loadGoldPrices(db, startDate, asOf);
    }
  }

  /**
   * Compute 1D and 5D log-returns from price series
   */
  computeReturns(prices: PricePoint[]): ReturnPoint[] {
    const returns: ReturnPoint[] = [];

    for (let i = 1; i < prices.length; i++) {
      const cur = prices[i].close;
      const prev = prices[i - 1].close;

      if (cur <= 0 || prev <= 0) continue;

      const ret1d = Math.log(cur / prev);
      let ret5d = 0;
      if (i >= 5 && prices[i - 5].close > 0) {
        ret5d = Math.log(cur / prices[i - 5].close);
      }

      returns.push({
        date: prices[i].date,
        ret1d,
        ret5d,
      });
    }

    return returns;
  }

  /**
   * Align returns of two assets to common dates
   */
  alignReturns(
    a: ReturnPoint[],
    b: ReturnPoint[]
  ): { dates: string[]; aRet: number[]; bRet: number[] } {
    const bMap = new Map(b.map(r => [r.date, r]));
    const dates: string[] = [];
    const aRet: number[] = [];
    const bRet: number[] = [];

    for (const ar of a) {
      const br = bMap.get(ar.date);
      if (br) {
        dates.push(ar.date);
        aRet.push(ar.ret1d);
        bRet.push(br.ret1d);
      }
    }

    return { dates, aRet, bRet };
  }

  // ─────────────────────────────────────────────────────────
  // LOADERS (per collection schema)
  // ─────────────────────────────────────────────────────────

  private async loadDxyPrices(db: any, start: string, asOf: string): Promise<PricePoint[]> {
    const docs = await db.collection('dxy_candles')
      .find({ date: { $gte: new Date(start), $lte: new Date(asOf) } })
      .sort({ date: 1 })
      .project({ _id: 0, date: 1, close: 1 })
      .toArray();

    return docs.map((d: any) => ({
      date: new Date(d.date).toISOString().split('T')[0],
      close: d.close as number,
    }));
  }

  private async loadSpxPrices(db: any, start: string, asOf: string): Promise<PricePoint[]> {
    const docs = await db.collection('spx_candles')
      .find({ date: { $gte: start, $lte: asOf } })
      .sort({ date: 1 })
      .project({ _id: 0, date: 1, close: 1 })
      .toArray();

    return docs.map((d: any) => ({
      date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString().split('T')[0],
      close: d.close as number,
    }));
  }

  private async loadBtcPrices(db: any, start: string, asOf: string): Promise<PricePoint[]> {
    const docs = await db.collection('fractal_canonical_ohlcv')
      .find({
        'meta.symbol': 'BTC',
        ts: { $gte: new Date(start), $lte: new Date(asOf) },
      })
      .sort({ ts: 1 })
      .project({ _id: 0, ts: 1, 'ohlcv.c': 1 })
      .toArray();

    return docs
      .filter((d: any) => d.ohlcv?.c > 0)
      .map((d: any) => ({
        date: new Date(d.ts).toISOString().split('T')[0],
        close: d.ohlcv.c as number,
      }));
  }

  private async loadGoldPrices(db: any, start: string, asOf: string): Promise<PricePoint[]> {
    // Try FRED API for gold data (series: GOLDAMGBD228NLBM)
    try {
      const apiKey = process.env.FRED_API_KEY;
      if (!apiKey) return [];

      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=GOLDAMGBD228NLBM&observation_start=${start}&observation_end=${asOf}&api_key=${apiKey}&file_type=json`;
      const resp = await fetch(url);
      if (!resp.ok) return [];

      const data = await resp.json() as any;
      const observations = data.observations || [];

      return observations
        .filter((o: any) => o.value !== '.' && parseFloat(o.value) > 0)
        .map((o: any) => ({
          date: o.date,
          close: parseFloat(o.value),
        }));
    } catch (e) {
      console.warn('[CrossAsset] Failed to load GOLD prices from FRED:', (e as Error).message);
      return [];
    }
  }
}

// Singleton
let instance: CrossAssetReturnsService | null = null;

export function getCrossAssetReturnsService(): CrossAssetReturnsService {
  if (!instance) {
    instance = new CrossAssetReturnsService();
  }
  return instance;
}
