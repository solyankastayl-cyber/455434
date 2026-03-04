/**
 * Coinbase Provider
 * Used for tail updates (incremental data after Kraken CSV ends)
 * Public API, no auth required
 */

import { OhlcvCandle, HistoricalSourceProvider } from '../../contracts/fractal.contracts.js';
import { ONE_DAY_MS } from '../../domain/constants.js';

const COINBASE_API = 'https://api.exchange.coinbase.com';

export class CoinbaseProvider implements HistoricalSourceProvider {
  public readonly name = 'coinbase';

  async fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]> {
    const candles: OhlcvCandle[] = [];
    const product = this.toProductId(symbol);
    const granularity = 86400; // 1 day in seconds

    let cursor = new Date(from);
    const maxBatchDays = 300;

    while (cursor < to) {
      const batchEnd = new Date(Math.min(
        cursor.getTime() + maxBatchDays * ONE_DAY_MS,
        to.getTime()
      ));

      try {
        const url = `${COINBASE_API}/products/${product}/candles?` +
          `start=${cursor.toISOString()}&` +
          `end=${batchEnd.toISOString()}&` +
          `granularity=${granularity}`;

        const response = await fetch(url);

        if (!response.ok) {
          console.error(`[Coinbase] API error: ${response.status}`);
          break;
        }

        const data = await response.json() as number[][];

        // Coinbase format: [time, low, high, open, close, volume]
        for (const row of data) {
          const ts = new Date(row[0] * 1000);
          if (ts < from || ts > to) continue;

          candles.push({
            ts,
            open: row[3],
            high: row[2],
            low: row[1],
            close: row[4],
            volume: row[5]
          });
        }

        // Rate limiting
        await this.sleep(200);

      } catch (error) {
        console.error('[Coinbase] Fetch error:', error);
        break;
      }

      cursor = batchEnd;
    }

    // Sort ascending
    candles.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    console.log(`[Coinbase] Fetched ${candles.length} candles for ${symbol}`);
    return candles;
  }

  private toProductId(symbol: string): string {
    if (symbol === 'BTC') return 'BTC-USD';
    if (symbol === 'ETH') return 'ETH-USD';
    return `${symbol}-USD`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
