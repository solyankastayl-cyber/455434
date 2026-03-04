/**
 * Binance Historical Provider
 * Fetches historical OHLCV data from Binance API
 * Using Binance because it has good historical data and is already used in the project
 */

import { HistoricalSourceProvider, OhlcvCandle } from '../../contracts/fractal.contracts.js';
import { ONE_DAY_MS } from '../../domain/constants.js';

const BINANCE_API = 'https://api.binance.com';
const MAX_CANDLES_PER_REQUEST = 1000;

export class BinanceProvider implements HistoricalSourceProvider {
  name = 'binance';

  async fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]> {
    const candles: OhlcvCandle[] = [];
    const binanceSymbol = this.toBinanceSymbol(symbol);
    const interval = '1d';

    let startTime = from.getTime();
    const endTime = to.getTime();

    while (startTime < endTime) {
      try {
        const url = `${BINANCE_API}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${MAX_CANDLES_PER_REQUEST}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`[BinanceProvider] API error: ${response.status}`);
          break;
        }

        const data = await response.json() as number[][];

        if (!data || data.length === 0) break;

        for (const row of data) {
          const ts = new Date(row[0]);
          if (ts.getTime() > endTime) break;

          candles.push({
            ts,
            open: parseFloat(String(row[1])),
            high: parseFloat(String(row[2])),
            low: parseFloat(String(row[3])),
            close: parseFloat(String(row[4])),
            volume: parseFloat(String(row[5]))
          });
        }

        // Move to next batch
        const lastTs = data[data.length - 1][0] as number;
        startTime = lastTs + ONE_DAY_MS;

        // Rate limiting
        await this.sleep(100);

      } catch (error) {
        console.error('[BinanceProvider] Fetch error:', error);
        break;
      }
    }

    console.log(`[BinanceProvider] Fetched ${candles.length} candles for ${symbol}`);
    return candles;
  }

  private toBinanceSymbol(symbol: string): string {
    // BTC -> BTCUSDT
    if (symbol === 'BTC') return 'BTCUSDT';
    if (symbol === 'ETH') return 'ETHUSDT';
    return `${symbol}USDT`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
