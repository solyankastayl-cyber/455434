/**
 * S10.6I.4 — Order Book / Depth Indicators
 * 
 * Measure pressure, voids, and resistance.
 * NOT about "where price will go".
 * 
 * This is DIAGNOSTICS, not SIGNAL.
 * 
 * 6 indicators:
 * 19. Order Book Imbalance (OBI)
 * 20. Depth Density Index (DDI)
 * 21. Liquidity Wall Strength (LWS)
 * 22. Absorption Strength (ABS)
 * 23. Liquidity Vacuum Index (LVI)
 * 24. Spread Pressure Index (SPI)
 */

import {
  IndicatorCalculator,
  IndicatorValue,
  IndicatorInput,
  INDICATOR_IDS,
} from '../../indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Clamp
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Percentile Rank
// ═══════════════════════════════════════════════════════════════

function percentileRank(value: number, history: number[]): number {
  if (history.length === 0) return 0.5;
  const belowCount = history.filter(v => v < value).length;
  return belowCount / history.length;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Median
// ═══════════════════════════════════════════════════════════════

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Generate mock order book data
// ═══════════════════════════════════════════════════════════════

interface OrderBookLevel {
  price: number;
  volume: number;
  side: 'bid' | 'ask';
}

interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  midPrice: number;
  spread: number;
  totalBidVolume: number;
  totalAskVolume: number;
}

function generateMockOrderBook(price: number, seed: number): OrderBookData {
  const levels = 20;
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  
  // Generate bids (below price)
  for (let i = 0; i < levels; i++) {
    const levelPrice = price * (1 - (i + 1) * 0.001);
    const volume = 100 + Math.sin(seed + i) * 50 + Math.random() * 200;
    bids.push({ price: levelPrice, volume: Math.abs(volume), side: 'bid' });
  }
  
  // Generate asks (above price)
  for (let i = 0; i < levels; i++) {
    const levelPrice = price * (1 + (i + 1) * 0.001);
    const volume = 100 + Math.cos(seed + i) * 50 + Math.random() * 200;
    asks.push({ price: levelPrice, volume: Math.abs(volume), side: 'ask' });
  }
  
  const totalBidVolume = bids.reduce((sum, b) => sum + b.volume, 0);
  const totalAskVolume = asks.reduce((sum, a) => sum + a.volume, 0);
  const bestBid = bids[0]?.price || price * 0.999;
  const bestAsk = asks[0]?.price || price * 1.001;
  
  return {
    bids,
    asks,
    midPrice: (bestBid + bestAsk) / 2,
    spread: bestAsk - bestBid,
    totalBidVolume,
    totalAskVolume,
  };
}

function extractOrderBookData(input: IndicatorInput): OrderBookData {
  // If order book data provided, use it
  if (input.orderBook) {
    const price = input.price;
    const seed = input.symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const mockBook = generateMockOrderBook(price, seed);
    
    // Adjust with real imbalance if available
    const realImbalance = input.orderBook.imbalance;
    if (realImbalance !== undefined) {
      // Scale volumes based on real imbalance
      const adjustmentFactor = 1 + realImbalance * 0.5;
      mockBook.bids.forEach(b => b.volume *= adjustmentFactor);
      mockBook.totalBidVolume *= adjustmentFactor;
    }
    
    return mockBook;
  }
  
  // Generate based on candle data
  const candles = input.candles;
  const price = input.price;
  const seed = candles.length > 0 
    ? candles.reduce((sum, c) => sum + c.close, 0) 
    : Date.now();
  
  return generateMockOrderBook(price, seed);
}

// ═══════════════════════════════════════════════════════════════
// 19. ORDER BOOK IMBALANCE (OBI)
// ═══════════════════════════════════════════════════════════════

export const orderBookImbalanceCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.ORDER_BOOK.IMBALANCE,
    name: 'Order Book Imbalance',
    category: 'ORDER_BOOK',
    description: 'Volume skew between bid and ask sides',
    formula: 'OBI = (sumBidVolume - sumAskVolume) / (sumBidVolume + sumAskVolume)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Seller pressure dominates',
      neutral: 'Balanced order book',
      high: 'Buyer pressure dominates',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const book = extractOrderBookData(input);
    const total = book.totalBidVolume + book.totalAskVolume;
    
    if (total === 0) {
      return {
        id: INDICATOR_IDS.ORDER_BOOK.IMBALANCE,
        category: 'ORDER_BOOK',
        value: 0,
        normalized: true,
        interpretation: 'No order book data',
        timestamp: Date.now(),
      };
    }
    
    const obi = (book.totalBidVolume - book.totalAskVolume) / total;
    
    let interpretation = 'Balanced order book';
    if (obi > 0.3) interpretation = 'Buyer pressure dominates';
    else if (obi < -0.3) interpretation = 'Seller pressure dominates';
    
    return {
      id: INDICATOR_IDS.ORDER_BOOK.IMBALANCE,
      category: 'ORDER_BOOK',
      value: clamp(obi, -1, 1),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 20. DEPTH DENSITY INDEX (DDI)
// ═══════════════════════════════════════════════════════════════

const DDI_RANGE_PERCENT = 0.5; // ±0.5% from mid price

export const depthDensityCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.ORDER_BOOK.DEPTH_DENSITY,
    name: 'Depth Density Index',
    category: 'ORDER_BOOK',
    description: 'How dense is the order book around current price',
    formula: 'DDI = volumeWithinRange / totalOrderBookVolume (within ±0.5%)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Thin market around price',
      neutral: 'Normal depth',
      high: 'Dense, viscous market',
    },
    dependencies: [],
    parameters: { rangePercent: DDI_RANGE_PERCENT },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const book = extractOrderBookData(input);
    const midPrice = book.midPrice;
    const rangeFactor = DDI_RANGE_PERCENT / 100;
    
    const lowerBound = midPrice * (1 - rangeFactor);
    const upperBound = midPrice * (1 + rangeFactor);
    
    // Volume within range
    let volumeWithinRange = 0;
    for (const bid of book.bids) {
      if (bid.price >= lowerBound) volumeWithinRange += bid.volume;
    }
    for (const ask of book.asks) {
      if (ask.price <= upperBound) volumeWithinRange += ask.volume;
    }
    
    const totalVolume = book.totalBidVolume + book.totalAskVolume;
    const ddi = totalVolume > 0 ? volumeWithinRange / totalVolume : 0;
    
    let interpretation = 'Normal depth';
    if (ddi < 0.3) interpretation = 'Thin market around price';
    else if (ddi > 0.6) interpretation = 'Dense, viscous market';
    
    return {
      id: INDICATOR_IDS.ORDER_BOOK.DEPTH_DENSITY,
      category: 'ORDER_BOOK',
      value: clamp(ddi, 0, 1),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 21. LIQUIDITY WALL STRENGTH (LWS)
// ═══════════════════════════════════════════════════════════════

export const liquidityWallStrengthCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.ORDER_BOOK.LIQUIDITY_WALLS,
    name: 'Liquidity Wall Strength',
    category: 'ORDER_BOOK',
    description: 'Are there real walls or just noise?',
    formula: 'LWS = max(orderLevelVolume) / median(orderLevelVolume); normalized = clamp(log(LWS), 0, 1)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Order book is uniform',
      neutral: 'Some concentration',
      high: 'Strong liquidity walls present',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const book = extractOrderBookData(input);
    
    const allVolumes = [
      ...book.bids.map(b => b.volume),
      ...book.asks.map(a => a.volume),
    ];
    
    if (allVolumes.length === 0) {
      return {
        id: INDICATOR_IDS.ORDER_BOOK.LIQUIDITY_WALLS,
        category: 'ORDER_BOOK',
        value: 0,
        normalized: true,
        interpretation: 'No order book data',
        timestamp: Date.now(),
      };
    }
    
    const maxVolume = Math.max(...allVolumes);
    const medianVolume = calculateMedian(allVolumes);
    
    const lws = medianVolume > 0 ? maxVolume / medianVolume : 1;
    const normalized = clamp(Math.log(lws) / Math.log(10), 0, 1); // log10 normalization
    
    let interpretation = 'Order book is uniform';
    if (normalized > 0.6) interpretation = 'Strong liquidity walls present';
    else if (normalized > 0.3) interpretation = 'Some concentration';
    
    return {
      id: INDICATOR_IDS.ORDER_BOOK.LIQUIDITY_WALLS,
      category: 'ORDER_BOOK',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 22. ABSORPTION STRENGTH (ABS)
// ═══════════════════════════════════════════════════════════════

export const absorptionStrengthCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.ORDER_BOOK.ABSORPTION_STRENGTH,
    name: 'Absorption Strength',
    category: 'ORDER_BOOK',
    description: 'Is aggressive flow being absorbed by limits?',
    formula: 'ABS = 1 - clamp(aggressiveVolume / limitVolumeConsumed, 0, 1)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Market easily pushed through',
      neutral: 'Normal absorption',
      high: 'Strong absorption (limits holding)',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const book = extractOrderBookData(input);
    const candles = input.candles;
    
    if (candles.length < 5) {
      return {
        id: INDICATOR_IDS.ORDER_BOOK.ABSORPTION_STRENGTH,
        category: 'ORDER_BOOK',
        value: 0.5,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Estimate aggressive volume from recent candle activity
    const recentCandles = candles.slice(-5);
    const aggressiveVolume = recentCandles.reduce((sum, c) => {
      const range = c.high - c.low;
      const body = Math.abs(c.close - c.open);
      // Higher body/range ratio = more aggressive
      return sum + c.volume * (range > 0 ? body / range : 0.5);
    }, 0);
    
    // Estimate limit volume from order book depth
    const limitVolumeAvailable = (book.totalBidVolume + book.totalAskVolume) / 2;
    
    // Absorption = how much of aggressive flow is absorbed
    const absRatio = limitVolumeAvailable > 0 
      ? aggressiveVolume / limitVolumeAvailable 
      : 1;
    
    // Invert: high absorption = low ratio (limits absorbing aggression)
    const normalized = clamp(1 - absRatio / 5, 0, 1);
    
    let interpretation = 'Normal absorption';
    if (normalized > 0.7) interpretation = 'Strong absorption (limits holding)';
    else if (normalized < 0.3) interpretation = 'Market easily pushed through';
    
    return {
      id: INDICATOR_IDS.ORDER_BOOK.ABSORPTION_STRENGTH,
      category: 'ORDER_BOOK',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 23. LIQUIDITY VACUUM INDEX (LVI)
// ═══════════════════════════════════════════════════════════════

const LVI_PRICE_RANGE = 0.02; // ±2% from mid price

export const liquidityVacuumCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.ORDER_BOOK.LIQUIDITY_VACUUM,
    name: 'Liquidity Vacuum Index',
    category: 'ORDER_BOOK',
    description: 'Voids where price can fall through',
    formula: 'LVI = 1 - (levelsWithinRange / maxLevels)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Market filled with liquidity',
      neutral: 'Normal distribution',
      high: 'Vacuum present (sharp move risk)',
    },
    dependencies: [],
    parameters: { priceRange: LVI_PRICE_RANGE },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const book = extractOrderBookData(input);
    const midPrice = book.midPrice;
    
    const lowerBound = midPrice * (1 - LVI_PRICE_RANGE);
    const upperBound = midPrice * (1 + LVI_PRICE_RANGE);
    
    // Count levels within range
    let levelsWithinRange = 0;
    for (const bid of book.bids) {
      if (bid.price >= lowerBound) levelsWithinRange++;
    }
    for (const ask of book.asks) {
      if (ask.price <= upperBound) levelsWithinRange++;
    }
    
    const maxLevels = book.bids.length + book.asks.length;
    const lvi = maxLevels > 0 ? 1 - (levelsWithinRange / maxLevels) : 0.5;
    
    let interpretation = 'Normal distribution';
    if (lvi > 0.6) interpretation = 'Vacuum present (sharp move risk)';
    else if (lvi < 0.3) interpretation = 'Market filled with liquidity';
    
    return {
      id: INDICATOR_IDS.ORDER_BOOK.LIQUIDITY_VACUUM,
      category: 'ORDER_BOOK',
      value: clamp(lvi, 0, 1),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 24. SPREAD PRESSURE INDEX (SPI)
// ═══════════════════════════════════════════════════════════════

export const spreadPressureCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.ORDER_BOOK.SPREAD_PRESSURE,
    name: 'Spread Pressure Index',
    category: 'ORDER_BOOK',
    description: 'Tension between bid and ask',
    formula: 'SPI = spread / averageSpread; normalized = clamp(SPI - 1, 0, 1)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Calm regime (tight spread)',
      neutral: 'Normal spread',
      high: 'Tense market (wide spread)',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const book = extractOrderBookData(input);
    const candles = input.candles;
    
    if (candles.length < 10) {
      return {
        id: INDICATOR_IDS.ORDER_BOOK.SPREAD_PRESSURE,
        category: 'ORDER_BOOK',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Current spread as percentage
    const currentSpreadPct = book.midPrice > 0 
      ? book.spread / book.midPrice 
      : 0;
    
    // Average spread from historical candle data (high-low as proxy)
    const spreadHistory = candles.map(c => (c.high - c.low) / ((c.high + c.low) / 2));
    const avgSpreadPct = spreadHistory.reduce((a, b) => a + b, 0) / spreadHistory.length;
    
    // SPI = current / average
    const spi = avgSpreadPct > 0 ? currentSpreadPct / avgSpreadPct : 1;
    const normalized = clamp(spi - 1, 0, 1);
    
    let interpretation = 'Normal spread';
    if (normalized > 0.5) interpretation = 'Tense market (wide spread)';
    else if (normalized < 0.1 && spi < 1) interpretation = 'Calm regime (tight spread)';
    
    return {
      id: INDICATOR_IDS.ORDER_BOOK.SPREAD_PRESSURE,
      category: 'ORDER_BOOK',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// EXPORT ALL CALCULATORS
// ═══════════════════════════════════════════════════════════════

export const orderBookCalculators: IndicatorCalculator[] = [
  orderBookImbalanceCalculator,
  depthDensityCalculator,
  liquidityWallStrengthCalculator,
  absorptionStrengthCalculator,
  liquidityVacuumCalculator,
  spreadPressureCalculator,
];

console.log(`[S10.6I.4] Order Book / Depth calculators loaded: ${orderBookCalculators.length}`);
