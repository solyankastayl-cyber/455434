/**
 * PHASE 4 - БЛОК 4.4: CoinGecko Price Provider
 * 
 * Primary price source for outcome labels
 * 
 * Features:
 * - Historical prices via CoinGecko API
 * - Current prices
 * - Rate limiting
 * - Fallback handling
 */
import axios from 'axios';
import { PriceProvider, calculateReturn } from './price_service.interface.js';

export class CoinGeckoPriceProvider implements PriceProvider {
  private baseUrl = 'https://api.coingecko.com/api/v3';
  private cache: Map<string, { price: number; timestamp: number }> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  getName(): string {
    return 'CoinGecko';
  }

  /**
   * Get CoinGecko coin ID from contract address
   * This is a simplified mapping - in production, use proper token registry
   */
  private async getCoinId(contractAddress: string): Promise<string | null> {
    try {
      // Try to find coin by contract address
      const response = await axios.get(
        `${this.baseUrl}/coins/ethereum/contract/${contractAddress.toLowerCase()}`,
        { timeout: 5000 }
      );
      
      return response.data.id || null;
    } catch (error) {
      console.error(`[CoinGecko] Failed to get coin ID for ${contractAddress}:`, error);
      return null;
    }
  }

  /**
   * Get current price
   */
  async getCurrentPrice(tokenAddress: string): Promise<number | null> {
    const cacheKey = `current-${tokenAddress}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.price;
    }

    try {
      const coinId = await this.getCoinId(tokenAddress);
      if (!coinId) return null;

      const response = await axios.get(
        `${this.baseUrl}/simple/price`,
        {
          params: {
            ids: coinId,
            vs_currencies: 'usd',
          },
          timeout: 5000,
        }
      );

      const price = response.data[coinId]?.usd;
      
      if (price) {
        this.cache.set(cacheKey, { price, timestamp: Date.now() });
      }

      return price || null;
    } catch (error) {
      console.error(`[CoinGecko] Failed to get current price for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Get historical price at specific timestamp
   */
  async getPrice(tokenAddress: string, timestamp: Date): Promise<number | null> {
    try {
      const coinId = await this.getCoinId(tokenAddress);
      if (!coinId) return null;

      // CoinGecko expects timestamp in seconds
      const timestampSeconds = Math.floor(timestamp.getTime() / 1000);

      const response = await axios.get(
        `${this.baseUrl}/coins/${coinId}/market_chart/range`,
        {
          params: {
            vs_currency: 'usd',
            from: timestampSeconds - 3600, // 1 hour before
            to: timestampSeconds + 3600, // 1 hour after
          },
          timeout: 10000,
        }
      );

      const prices = response.data.prices || [];
      
      if (prices.length === 0) return null;

      // Find closest price to target timestamp
      let closestPrice = prices[0];
      let minDiff = Math.abs(prices[0][0] - timestampSeconds * 1000);

      for (const [ts, price] of prices) {
        const diff = Math.abs(ts - timestampSeconds * 1000);
        if (diff < minDiff) {
          minDiff = diff;
          closestPrice = [ts, price];
        }
      }

      return closestPrice[1];
    } catch (error) {
      console.error(`[CoinGecko] Failed to get historical price for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Get price change between two timestamps
   */
  async getPriceChange(
    tokenAddress: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    startPrice: number;
    endPrice: number;
    returnPct: number;
  } | null> {
    try {
      const [startPrice, endPrice] = await Promise.all([
        this.getPrice(tokenAddress, startTime),
        this.getPrice(tokenAddress, endTime),
      ]);

      if (!startPrice || !endPrice) return null;

      const returnPct = calculateReturn(startPrice, endPrice);

      return {
        startPrice,
        endPrice,
        returnPct,
      };
    } catch (error) {
      console.error(`[CoinGecko] Failed to get price change for ${tokenAddress}:`, error);
      return null;
    }
  }
}

// Singleton instance
export const coinGeckoPriceProvider = new CoinGeckoPriceProvider();
