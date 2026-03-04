/**
 * CryptoCompare Historical Provider
 * Fetches historical OHLCV data from CryptoCompare API (free tier)
 * Has good historical data back to 2010
 */

import { HistoricalSourceProvider, OhlcvCandle } from '../../contracts/fractal.contracts.js';
import { ONE_DAY_MS } from '../../domain/constants.js';

const CRYPTOCOMPARE_API = 'https://min-api.cryptocompare.com';
const MAX_CANDLES_PER_REQUEST = 2000;

export class CryptoCompareProvider implements HistoricalSourceProvider {
  name = 'cryptocompare';

  async fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]> {
    const candles: OhlcvCandle[] = [];
    const fsym = symbol; // BTC
    const tsym = 'USD';

    // CryptoCompare uses toTs (end timestamp) and returns data going backwards
    let toTs = Math.floor(to.getTime() / 1000);
    const fromTs = Math.floor(from.getTime() / 1000);

    let attempts = 0;
    const maxAttempts = 50; // Safety limit

    while (toTs > fromTs && attempts < maxAttempts) {
      attempts++;

      try {
        const url = `${CRYPTOCOMPARE_API}/data/v2/histoday?fsym=${fsym}&tsym=${tsym}&limit=${MAX_CANDLES_PER_REQUEST}&toTs=${toTs}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`[CryptoCompareProvider] API error: ${response.status}`);
          break;
        }

        const json = await response.json() as {
          Response: string;
          Data: {
            Data: Array<{
              time: number;
              open: number;
              high: number;
              low: number;
              close: number;
              volumefrom: number;
            }>;
          };
        };

        if (json.Response !== 'Success' || !json.Data?.Data) {
          console.error('[CryptoCompareProvider] Invalid response:', json.Response);
          break;
        }

        const data = json.Data.Data;

        if (data.length === 0) break;

        // CryptoCompare returns oldest first, newest last
        for (const row of data) {
          const ts = row.time * 1000;
          
          // Skip if before our range
          if (ts < from.getTime()) continue;
          // Skip if after our range  
          if (ts > to.getTime()) continue;
          // Skip if price is 0 (no trading data)
          if (row.close === 0) continue;

          candles.push({
            ts: new Date(ts),
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volumefrom
          });
        }

        // Move to earlier period (oldest timestamp in batch minus 1 day)
        const oldestInBatch = Math.min(...data.map(d => d.time));
        toTs = oldestInBatch - 86400;

        // Rate limiting (free tier: 100k calls/month)
        await this.sleep(300);

      } catch (error) {
        console.error('[CryptoCompareProvider] Fetch error:', error);
        break;
      }
    }

    // Sort by timestamp ascending
    candles.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    // Remove duplicates
    const seen = new Set<number>();
    const unique = candles.filter(c => {
      const key = c.ts.getTime();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[CryptoCompareProvider] Fetched ${unique.length} candles for ${symbol}`);
    return unique;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
