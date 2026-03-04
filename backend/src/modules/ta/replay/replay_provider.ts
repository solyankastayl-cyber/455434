/**
 * Phase V: Replay Provider
 * 
 * Allows stepping through historical candles for backtesting.
 * Essential for building ML training datasets.
 */

import { Candle, MarketDataProvider } from '../data/market.provider.js';

export interface ReplayState {
  currentIndex: number;
  totalCandles: number;
  startTime: number;
  endTime: number;
  currentTime: number;
}

export class ReplayProvider implements MarketDataProvider {
  private allCandles: Candle[] = [];
  private currentIndex: number = 0;
  private symbol: string = '';
  private timeframe: string = '';

  constructor(candles: Candle[] = [], symbol: string = 'BTCUSDT', timeframe: string = '1h') {
    this.allCandles = candles;
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.currentIndex = Math.min(200, candles.length); // Start with 200 candles visible
  }

  getName(): string {
    return 'Replay';
  }

  /**
   * Load candles for replay
   */
  load(candles: Candle[], symbol: string, timeframe: string): void {
    this.allCandles = candles;
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.currentIndex = Math.min(200, candles.length);
  }

  /**
   * Get candles up to current replay position
   */
  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> {
    // Return candles from start up to currentIndex, limited by `limit`
    const start = Math.max(0, this.currentIndex - limit);
    const end = this.currentIndex;
    
    return this.allCandles.slice(start, end);
  }

  /**
   * Step forward by N candles
   */
  step(n: number = 1): boolean {
    const newIndex = this.currentIndex + n;
    
    if (newIndex > this.allCandles.length) {
      this.currentIndex = this.allCandles.length;
      return false; // Reached end
    }
    
    this.currentIndex = newIndex;
    return true;
  }

  /**
   * Step backward by N candles
   */
  stepBack(n: number = 1): boolean {
    const newIndex = this.currentIndex - n;
    
    if (newIndex < 200) {
      this.currentIndex = Math.min(200, this.allCandles.length);
      return false; // At beginning
    }
    
    this.currentIndex = newIndex;
    return true;
  }

  /**
   * Jump to specific index
   */
  jumpTo(index: number): void {
    this.currentIndex = Math.max(200, Math.min(index, this.allCandles.length));
  }

  /**
   * Jump to specific timestamp
   */
  jumpToTime(timestamp: number): boolean {
    const idx = this.allCandles.findIndex(c => c.ts >= timestamp);
    
    if (idx === -1) {
      return false;
    }
    
    this.currentIndex = Math.max(200, idx);
    return true;
  }

  /**
   * Reset to beginning
   */
  reset(): void {
    this.currentIndex = Math.min(200, this.allCandles.length);
  }

  /**
   * Get current replay state
   */
  getState(): ReplayState {
    const currentCandle = this.allCandles[this.currentIndex - 1];
    
    return {
      currentIndex: this.currentIndex,
      totalCandles: this.allCandles.length,
      startTime: this.allCandles[0]?.ts || 0,
      endTime: this.allCandles[this.allCandles.length - 1]?.ts || 0,
      currentTime: currentCandle?.ts || 0,
    };
  }

  /**
   * Check if at end
   */
  isAtEnd(): boolean {
    return this.currentIndex >= this.allCandles.length;
  }

  /**
   * Get future candles for outcome evaluation (not visible to TA engine)
   */
  getFutureCandles(n: number = 50): Candle[] {
    const start = this.currentIndex;
    const end = Math.min(start + n, this.allCandles.length);
    
    return this.allCandles.slice(start, end);
  }

  /**
   * Get progress percentage
   */
  getProgress(): number {
    if (this.allCandles.length === 0) return 0;
    return (this.currentIndex / this.allCandles.length) * 100;
  }
}

// Factory function
export function createReplayProvider(
  candles: Candle[],
  symbol: string,
  timeframe: string
): ReplayProvider {
  return new ReplayProvider(candles, symbol, timeframe);
}
