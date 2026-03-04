/**
 * Market Metrics Service (Phase 14A.2)
 * 
 * Calculates aggregated market metrics from price points.
 */
import { MarketMetricsModel, IMarketMetrics, MetricsWindow, getWindowMs, getValidityMs } from './market_metrics.model.js';
import { PricePointModel, parsePrice, formatPrice } from './price_points.model.js';

/**
 * Calculate volatility (standard deviation of log returns)
 */
export function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  
  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  
  if (returns.length === 0) return 0;
  
  // Calculate standard deviation
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  
  return Math.sqrt(variance);
}

/**
 * Calculate trend (slope of ln(price) regression)
 */
export function calculateTrend(prices: number[]): { slope: number; r2: number } {
  if (prices.length < 2) return { slope: 0, r2: 0 };
  
  // Transform to log prices
  const logPrices = prices.filter(p => p > 0).map(p => Math.log(p));
  if (logPrices.length < 2) return { slope: 0, r2: 0 };
  
  const n = logPrices.length;
  const x = Array.from({ length: n }, (_, i) => i);
  
  // Linear regression
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = logPrices.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * logPrices[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  // Calculate R²
  const meanY = sumY / n;
  const ssTotal = logPrices.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
  const ssResidual = logPrices.reduce((sum, y, i) => {
    const predicted = meanY + slope * (i - sumX / n);
    return sum + Math.pow(y - predicted, 2);
  }, 0);
  
  const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
  
  return { slope, r2: Math.max(0, Math.min(1, r2)) };
}

/**
 * Calculate max drawdown
 */
export function calculateMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return 0;
  
  let maxPrice = prices[0];
  let maxDrawdown = 0;
  
  for (const price of prices) {
    if (price > maxPrice) {
      maxPrice = price;
    }
    
    const drawdown = (maxPrice - price) / maxPrice;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown;
}

/**
 * Calculate and store market metrics for an asset
 */
export async function calculateMarketMetrics(
  assetAddress: string,
  chain: string,
  window: MetricsWindow
): Promise<IMarketMetrics | null> {
  const windowMs = getWindowMs(window);
  const now = new Date();
  const from = new Date(now.getTime() - windowMs);
  
  // Fetch price points
  const pricePoints = await PricePointModel.find({
    chain,
    assetAddress: assetAddress.toLowerCase(),
    timestamp: { $gte: from, $lte: now },
  }).sort({ timestamp: 1 });
  
  if (pricePoints.length < 2) {
    return null;
  }
  
  // Extract prices
  const prices = pricePoints.map(p => parsePrice(p.priceUsd));
  const confidences = pricePoints.map(p => p.confidence);
  
  // Calculate metrics
  const priceStart = prices[0];
  const priceEnd = prices[prices.length - 1];
  const priceHigh = Math.max(...prices);
  const priceLow = Math.min(...prices);
  const priceChange = priceStart > 0 ? ((priceEnd - priceStart) / priceStart) * 100 : 0;
  
  const volatility = calculateVolatility(prices);
  const { slope: trend, r2: trendStrength } = calculateTrend(prices);
  const maxDrawdown = calculateMaxDrawdown(prices);
  
  // Average confidence
  const priceConfidenceAvg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  
  // Liquidity score (simplified - based on average confidence)
  const liquidityScore = priceConfidenceAvg;
  
  // Store metrics
  const validityMs = getValidityMs(window);
  
  const metrics = await MarketMetricsModel.findOneAndUpdate(
    {
      chain,
      assetAddress: assetAddress.toLowerCase(),
      window,
    },
    {
      $set: {
        calculatedAt: now,
        validUntil: new Date(now.getTime() + validityMs),
        priceStart: formatPrice(priceStart),
        priceEnd: formatPrice(priceEnd),
        priceHigh: formatPrice(priceHigh),
        priceLow: formatPrice(priceLow),
        priceChange,
        volatility,
        trend,
        trendStrength,
        maxDrawdown,
        liquidityScore,
        priceConfidenceAvg,
        dataPointsCount: pricePoints.length,
      },
    },
    { upsert: true, new: true }
  );
  
  return metrics;
}

/**
 * Get market metrics for an asset
 */
export async function getMarketMetrics(
  assetAddress: string,
  chain: string = 'ethereum',
  window: MetricsWindow = '24h'
): Promise<IMarketMetrics | null> {
  const metrics = await MarketMetricsModel.findOne({
    chain,
    assetAddress: assetAddress.toLowerCase(),
    window,
  });
  
  // Check if valid
  if (metrics && metrics.validUntil > new Date()) {
    return metrics;
  }
  
  // Recalculate if expired or missing
  return calculateMarketMetrics(assetAddress, chain, window);
}

/**
 * Get top assets by metric
 */
export async function getTopAssets(
  window: MetricsWindow,
  sortBy: 'volatility' | 'trend' | 'liquidity' | 'priceChange' = 'volatility',
  limit: number = 20,
  chain: string = 'ethereum'
): Promise<IMarketMetrics[]> {
  const sortField = {
    volatility: 'volatility',
    trend: 'trend',
    liquidity: 'liquidityScore',
    priceChange: 'priceChange',
  }[sortBy];
  
  return MarketMetricsModel.find({
    chain,
    window,
    validUntil: { $gte: new Date() },
  })
    .sort({ [sortField]: -1 })
    .limit(limit);
}
