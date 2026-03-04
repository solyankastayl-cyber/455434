/**
 * PHASE 4 - БЛОК 4.4: Price Service Interface
 * 
 * Abstraction for price data providers
 * 
 * CRITICAL INVARIANTS:
 * - Price data NEVER goes to Engine
 * - Price data NEVER goes to Rankings
 * - Price data NEVER changes decisions
 * - Price data → ONLY labels → ONLY Shadow ML
 */

export interface PriceProvider {
  /**
   * Get price for token at specific timestamp
   * 
   * @param tokenAddress - Token contract address
   * @param timestamp - Time to get price for
   * @returns Price in USD or null if not available
   */
  getPrice(tokenAddress: string, timestamp: Date): Promise<number | null>;

  /**
   * Get current price for token
   * 
   * @param tokenAddress - Token contract address
   * @returns Current price in USD or null if not available
   */
  getCurrentPrice(tokenAddress: string): Promise<number | null>;

  /**
   * Get price change between two timestamps
   * 
   * @param tokenAddress - Token contract address
   * @param startTime - Start timestamp
   * @param endTime - End timestamp
   * @returns Return percentage or null if data not available
   */
  getPriceChange(
    tokenAddress: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    startPrice: number;
    endPrice: number;
    returnPct: number;
  } | null>;

  /**
   * Provider name for logging/debugging
   */
  getName(): string;
}

/**
 * Outcome label classification
 */
export type OutcomeLabel = 'UP' | 'DOWN' | 'FLAT';

/**
 * Classify return percentage into label
 * 
 * Thresholds:
 * - UP: > +5%
 * - DOWN: < -5%
 * - FLAT: [-5%, +5%]
 */
export function classifyOutcome(returnPct: number): OutcomeLabel {
  if (returnPct > 5) return 'UP';
  if (returnPct < -5) return 'DOWN';
  return 'FLAT';
}

/**
 * Calculate return percentage
 */
export function calculateReturn(startPrice: number, endPrice: number): number {
  return ((endPrice - startPrice) / startPrice) * 100;
}
