/**
 * Flow Anomalies Service
 * 
 * Calculates z-score deviations for market flow metrics:
 * - Open Interest delta
 * - Net Flow delta
 * - Price delta
 * - Volume anomalies
 */
import { SignalModel } from '../signals/signals.model.js';
import * as metricsService from './market_metrics.service.js';
import * as priceService from './price.service.js';

export interface FlowAnomalyPoint {
  timestamp: Date;
  label: string;
  openInterest: number | null;
  netFlow: number | null;
  price: number | null;
  volume: number | null;
}

export interface FlowAnomaliesResponse {
  asset: string;
  chain: string;
  timeframe: '7d' | '14d' | '30d';
  dataPoints: FlowAnomalyPoint[];
  hasData: boolean;
  indexingStatus: 'ready' | 'indexing' | 'no_data';
  lastUpdated: Date;
}

/**
 * Calculate z-score for a value given mean and stddev
 */
function calculateZScore(value: number, mean: number, stddev: number): number {
  if (stddev === 0) return 0;
  return (value - mean) / stddev;
}

/**
 * Calculate mean and standard deviation
 */
function calculateStats(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  
  return { mean, stddev };
}

/**
 * Get flow anomalies for an asset
 */
export async function getFlowAnomalies(
  assetAddress: string,
  chain: string = 'ethereum',
  timeframe: '7d' | '14d' | '30d' = '7d'
): Promise<FlowAnomaliesResponse> {
  const addr = assetAddress.toLowerCase();
  const now = new Date();
  
  // Calculate timeframe bounds
  const days = timeframe === '7d' ? 7 : timeframe === '14d' ? 14 : 30;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  
  // Fetch signals for flow analysis
  const signals = await SignalModel.find({
    assetAddress: addr,
    timestamp: { $gte: startDate },
  })
    .sort({ timestamp: 1 })
    .lean()
    .catch(() => []);
  
  // Fetch price history for the period
  const priceHistory = await priceService.getPriceHistory(
    addr, 
    chain, 
    startDate, 
    now, 
    '1h'
  ).catch(() => []);
  
  // If no data at all, return empty response
  if (signals.length === 0 && priceHistory.length === 0) {
    return {
      asset: addr,
      chain,
      timeframe,
      dataPoints: [],
      hasData: false,
      indexingStatus: 'no_data',
      lastUpdated: now,
    };
  }
  
  // Group data by day
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dailyData = new Map<string, {
    flows: number[];
    prices: number[];
    volumes: number[];
    day: number;
  }>();
  
  // Initialize days
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split('T')[0];
    dailyData.set(key, {
      flows: [],
      prices: [],
      volumes: [],
      day: d.getDay(),
    });
  }
  
  // Aggregate signals into daily flows
  for (const signal of signals) {
    const key = new Date(signal.timestamp).toISOString().split('T')[0];
    const dayData = dailyData.get(key);
    if (dayData) {
      // Determine flow direction based on signal type
      const flowValue = signal.type === 'accumulation' || signal.type === 'buy' 
        ? (signal.value || 1) 
        : signal.type === 'distribution' || signal.type === 'sell'
          ? -(signal.value || 1)
          : 0;
      dayData.flows.push(flowValue);
      if (signal.volume) {
        dayData.volumes.push(signal.volume);
      }
    }
  }
  
  // Aggregate prices into daily averages
  for (const price of priceHistory) {
    const key = new Date(price.timestamp).toISOString().split('T')[0];
    const dayData = dailyData.get(key);
    if (dayData && price.priceUsd) {
      dayData.prices.push(parseFloat(price.priceUsd.toString()));
    }
  }
  
  // Calculate daily aggregates
  const dailyAggregates: Array<{
    date: string;
    dayName: string;
    netFlow: number;
    avgPrice: number;
    totalVolume: number;
  }> = [];
  
  for (const [date, data] of dailyData.entries()) {
    const netFlow = data.flows.reduce((a, b) => a + b, 0);
    const avgPrice = data.prices.length > 0 
      ? data.prices.reduce((a, b) => a + b, 0) / data.prices.length 
      : 0;
    const totalVolume = data.volumes.reduce((a, b) => a + b, 0);
    
    dailyAggregates.push({
      date,
      dayName: dayLabels[data.day],
      netFlow,
      avgPrice,
      totalVolume,
    });
  }
  
  // Sort by date
  dailyAggregates.sort((a, b) => a.date.localeCompare(b.date));
  
  // Calculate z-scores
  const flowValues = dailyAggregates.map(d => d.netFlow);
  const priceValues = dailyAggregates.map(d => d.avgPrice).filter(p => p > 0);
  const volumeValues = dailyAggregates.map(d => d.totalVolume).filter(v => v > 0);
  
  const flowStats = calculateStats(flowValues);
  const priceStats = calculateStats(priceValues);
  const volumeStats = calculateStats(volumeValues);
  
  // Calculate price changes for z-score
  const priceChanges: number[] = [];
  for (let i = 1; i < dailyAggregates.length; i++) {
    if (dailyAggregates[i].avgPrice > 0 && dailyAggregates[i-1].avgPrice > 0) {
      const change = (dailyAggregates[i].avgPrice - dailyAggregates[i-1].avgPrice) / dailyAggregates[i-1].avgPrice;
      priceChanges.push(change);
    }
  }
  const priceChangeStats = calculateStats(priceChanges);
  
  // Build data points with z-scores
  const dataPoints: FlowAnomalyPoint[] = dailyAggregates.slice(-7).map((d, i) => {
    const netFlowZ = calculateZScore(d.netFlow, flowStats.mean, flowStats.stddev);
    
    // Price z-score based on change from previous day
    let priceZ = 0;
    if (i > 0 && d.avgPrice > 0 && dailyAggregates[i-1]?.avgPrice > 0) {
      const change = (d.avgPrice - dailyAggregates[i-1].avgPrice) / dailyAggregates[i-1].avgPrice;
      priceZ = calculateZScore(change, priceChangeStats.mean, priceChangeStats.stddev);
    }
    
    const volumeZ = d.totalVolume > 0 
      ? calculateZScore(d.totalVolume, volumeStats.mean, volumeStats.stddev)
      : null;
    
    // Clamp z-scores to reasonable range
    const clamp = (v: number) => Math.max(-5, Math.min(5, v));
    
    return {
      timestamp: new Date(d.date),
      label: d.dayName,
      openInterest: null, // Would need OI data source
      netFlow: d.netFlow !== 0 || flowStats.stddev > 0 ? clamp(netFlowZ) : null,
      price: d.avgPrice > 0 ? clamp(priceZ) : null,
      volume: volumeZ !== null ? clamp(volumeZ) : null,
    };
  });
  
  const hasRealData = dataPoints.some(
    d => d.netFlow !== null || d.price !== null || d.volume !== null
  );
  
  return {
    asset: addr,
    chain,
    timeframe,
    dataPoints,
    hasData: hasRealData,
    indexingStatus: hasRealData ? 'ready' : signals.length > 0 ? 'indexing' : 'no_data',
    lastUpdated: now,
  };
}
