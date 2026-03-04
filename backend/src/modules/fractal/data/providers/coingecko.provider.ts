/**
 * CoinGecko Historical Provider (Fallback)
 * Fetches historical OHLCV data from CoinGecko API
 * Note: CoinGecko free tier has limited historical data
 */

import { HistoricalSourceProvider, OhlcvCandle } from '../../contracts/fractal.contracts.js';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

export class CoinGeckoProvider implements HistoricalSourceProvider {
  name = 'coingecko';

  async fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]> {
    const candles: OhlcvCandle[] = [];
    const coinId = this.toCoinGeckoId(symbol);

    try {
      // CoinGecko uses Unix timestamps in seconds
      const fromTs = Math.floor(from.getTime() / 1000);
      const toTs = Math.floor(to.getTime() / 1000);

      const url = `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&from=${fromTs}&to=${toTs}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`[CoinGeckoProvider] API error: ${response.status}`);
        return candles;
      }

      const data = await response.json() as number[][];

      if (!data || data.length === 0) return candles;

      for (const row of data) {
        // CoinGecko OHLC format: [timestamp, open, high, low, close]
        // Note: CoinGecko doesn't provide volume in OHLC endpoint
        candles.push({
          ts: new Date(row[0]),
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: 0 // CoinGecko OHLC doesn't include volume
        });
      }

      console.log(`[CoinGeckoProvider] Fetched ${candles.length} candles for ${symbol}`);

    } catch (error) {
      console.error('[CoinGeckoProvider] Fetch error:', error);
    }

    return candles;
  }

  private toCoinGeckoId(symbol: string): string {
    const mapping: Record<string, string> = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'SOL': 'solana',
      'BNB': 'binancecoin'
    };
    return mapping[symbol] || symbol.toLowerCase();
  }
}
