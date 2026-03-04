/**
 * Demo Data Provider for Fractal Module
 * Generates realistic BTC price history for testing
 * Uses actual BTC price ranges and patterns from historical data
 */

import { HistoricalSourceProvider, OhlcvCandle } from '../../contracts/fractal.contracts.js';
import { ONE_DAY_MS } from '../../domain/constants.js';

// Historical BTC price milestones (approximate)
const PRICE_MILESTONES: Array<{ date: string; price: number }> = [
  { date: '2015-01-01', price: 315 },
  { date: '2015-07-01', price: 260 },
  { date: '2016-01-01', price: 430 },
  { date: '2016-07-01', price: 650 },
  { date: '2017-01-01', price: 1000 },
  { date: '2017-07-01', price: 2500 },
  { date: '2017-12-17', price: 19700 }, // ATH 2017
  { date: '2018-02-01', price: 9000 },
  { date: '2018-12-01', price: 3800 },
  { date: '2019-06-01', price: 8500 },
  { date: '2019-12-01', price: 7200 },
  { date: '2020-03-12', price: 5000 }, // COVID crash
  { date: '2020-08-01', price: 11500 },
  { date: '2020-12-01', price: 19000 },
  { date: '2021-04-14', price: 64000 }, // ATH April 2021
  { date: '2021-07-01', price: 35000 },
  { date: '2021-11-10', price: 68000 }, // ATH Nov 2021
  { date: '2022-01-01', price: 47000 },
  { date: '2022-06-01', price: 30000 },
  { date: '2022-11-01', price: 20000 },
  { date: '2023-01-01', price: 16500 },
  { date: '2023-07-01', price: 30000 },
  { date: '2024-01-01', price: 42000 },
  { date: '2024-03-14', price: 73000 }, // ATH 2024
  { date: '2024-08-01', price: 58000 },
  { date: '2025-01-01', price: 95000 },
  { date: '2025-12-01', price: 100000 },
  { date: '2026-02-14', price: 98000 },
];

export class DemoDataProvider implements HistoricalSourceProvider {
  name = 'demo';

  async fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]> {
    if (symbol !== 'BTC') {
      console.log(`[DemoDataProvider] Only BTC supported, got ${symbol}`);
      return [];
    }

    const candles: OhlcvCandle[] = [];
    let cursor = new Date(from);
    
    // Seed random with consistent value for reproducibility
    let seed = from.getTime();
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    while (cursor <= to) {
      const price = this.interpolatePrice(cursor);
      
      // Generate realistic OHLCV with some noise
      const volatility = 0.02 + random() * 0.03; // 2-5% daily volatility
      const direction = random() > 0.5 ? 1 : -1;
      const change = volatility * direction;
      
      const open = price * (1 + (random() - 0.5) * 0.02);
      const close = open * (1 + change);
      const high = Math.max(open, close) * (1 + random() * 0.02);
      const low = Math.min(open, close) * (1 - random() * 0.02);
      const volume = 10000 + random() * 50000; // Simplified volume

      candles.push({
        ts: new Date(cursor),
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round(volume)
      });

      cursor = new Date(cursor.getTime() + ONE_DAY_MS);
    }

    console.log(`[DemoDataProvider] Generated ${candles.length} demo candles for ${symbol}`);
    return candles;
  }

  private interpolatePrice(date: Date): number {
    const ts = date.getTime();
    
    // Find surrounding milestones
    let before = PRICE_MILESTONES[0];
    let after = PRICE_MILESTONES[PRICE_MILESTONES.length - 1];

    for (let i = 0; i < PRICE_MILESTONES.length - 1; i++) {
      const current = PRICE_MILESTONES[i];
      const next = PRICE_MILESTONES[i + 1];
      const currentTs = new Date(current.date).getTime();
      const nextTs = new Date(next.date).getTime();

      if (ts >= currentTs && ts <= nextTs) {
        before = current;
        after = next;
        break;
      }
    }

    // Linear interpolation between milestones
    const beforeTs = new Date(before.date).getTime();
    const afterTs = new Date(after.date).getTime();
    
    if (afterTs === beforeTs) return before.price;

    const ratio = (ts - beforeTs) / (afterTs - beforeTs);
    const price = before.price + (after.price - before.price) * ratio;

    return price;
  }
}
