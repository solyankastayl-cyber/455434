/**
 * EVENTS SERVICE — Decision events for chart markers
 * ===================================================
 */

import type { ChartEvent, EventChartData, ChartRange } from '../contracts/chart.types.js';
import { getDb } from '../../../db/mongodb.js';

const RANGE_MS: Record<ChartRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

/**
 * Fetch decision change events from snapshots
 */
async function fetchDecisionEvents(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<ChartEvent[]> {
  try {
    const db = await getDb();
    const docs = await db.collection('decision_snapshots')
      .find({
        asset: symbol.replace('USDT', ''),
        timestamp: { $gte: startTime, $lte: endTime },
      })
      .sort({ timestamp: 1 })
      .toArray();
    
    const events: ChartEvent[] = [];
    let prevAction: string | null = null;
    
    for (const doc of docs) {
      const action = doc.finalDecision?.action;
      const confidence = doc.finalDecision?.confidence || 0.5;
      
      // Only record when decision changes
      if (action && action !== prevAction) {
        events.push({
          ts: doc.timestamp,
          type: action as 'BUY' | 'SELL' | 'AVOID',
          confidence,
          note: `Decision changed to ${action}`,
          prevType: prevAction as 'BUY' | 'SELL' | 'AVOID' | undefined,
        });
        prevAction = action;
      }
    }
    
    return events;
  } catch (error: any) {
    console.warn('[EventsService] DB fetch error:', error.message);
    return [];
  }
}

/**
 * Generate synthetic events for demo
 */
function generateMockEvents(range: ChartRange): ChartEvent[] {
  const now = Date.now();
  const rangeMs = RANGE_MS[range];
  const startTime = now - rangeMs;
  
  const events: ChartEvent[] = [];
  const actions: ('BUY' | 'SELL' | 'AVOID')[] = ['BUY', 'SELL', 'AVOID'];
  
  // Generate 3-8 events in the range
  const eventCount = 3 + Math.floor(Math.random() * 5);
  let prevType: 'BUY' | 'SELL' | 'AVOID' | undefined = undefined;
  
  for (let i = 0; i < eventCount; i++) {
    const ts = startTime + (rangeMs * (i + 1)) / (eventCount + 1);
    const type = actions[Math.floor(Math.random() * actions.length)];
    
    if (type !== prevType) {
      events.push({
        ts,
        type,
        confidence: 0.5 + Math.random() * 0.4,
        note: `Signal changed to ${type}`,
        prevType,
      });
      prevType = type;
    }
  }
  
  return events;
}

/**
 * Get event chart data
 */
export async function getEventChartData(
  symbol: string,
  range: ChartRange
): Promise<EventChartData> {
  const now = Date.now();
  const rangeMs = RANGE_MS[range];
  const startTime = now - rangeMs;
  
  // Fetch real events
  let events = await fetchDecisionEvents(symbol, startTime, now);
  
  // If no real events, generate mock
  if (events.length === 0) {
    events = generateMockEvents(range);
  }
  
  const buyCount = events.filter(e => e.type === 'BUY').length;
  const sellCount = events.filter(e => e.type === 'SELL').length;
  const avoidCount = events.filter(e => e.type === 'AVOID').length;
  
  return {
    symbol,
    range,
    events,
    meta: {
      totalEvents: events.length,
      buyCount,
      sellCount,
      avoidCount,
    },
  };
}

console.log('[EventsService] Loaded');
