/**
 * PHASE 2 — Timeline Service
 * ===========================
 * Emit and query system events
 */

import { TimelineEventModel } from '../storage/timeline.event.model.js';
import { TimelineEventDto, TimelineEventType, Severity } from '../contracts/observability.types.js';

class TimelineService {
  
  async emit(evt: {
    type: TimelineEventType;
    severity: Severity;
    message: string;
    ts?: string;
    symbol?: string;
    providerId?: string;
    data?: Record<string, any>;
  }): Promise<void> {
    const ts = evt.ts ? new Date(evt.ts) : new Date();
    
    try {
      await TimelineEventModel.create({
        ts,
        type: evt.type,
        severity: evt.severity,
        symbol: evt.symbol,
        providerId: evt.providerId,
        message: evt.message,
        data: evt.data ?? {},
      });
      
      // Log critical events
      if (evt.severity === 'CRITICAL') {
        console.error(`[Timeline] CRITICAL: ${evt.message}`);
      }
    } catch (err: any) {
      console.error('[Timeline] Failed to emit event:', err.message);
    }
  }
  
  async list(params: {
    limit?: number;
    cursor?: string;
    symbol?: string;
    type?: TimelineEventType;
    severity?: Severity;
  }): Promise<{ items: TimelineEventDto[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit ?? 200, 500);
    const query: any = {};
    
    if (params.cursor) {
      query.ts = { $lt: new Date(params.cursor) };
    }
    if (params.symbol) {
      query.symbol = params.symbol;
    }
    if (params.type) {
      query.type = params.type;
    }
    if (params.severity) {
      query.severity = params.severity;
    }
    
    const docs = await TimelineEventModel
      .find(query)
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    
    const items: TimelineEventDto[] = docs.map((d: any) => ({
      ts: new Date(d.ts).toISOString(),
      type: d.type,
      severity: d.severity,
      symbol: d.symbol,
      providerId: d.providerId,
      message: d.message,
      data: d.data ?? {},
    }));
    
    const nextCursor = items.length > 0
      ? items[items.length - 1].ts
      : null;
    
    return { items, nextCursor };
  }
  
  async countByType(hours: number = 24): Promise<Record<string, number>> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const result = await TimelineEventModel.aggregate([
      { $match: { ts: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    
    const counts: Record<string, number> = {};
    for (const r of result) {
      counts[r._id] = r.count;
    }
    return counts;
  }
  
  async countBySeverity(hours: number = 24): Promise<Record<string, number>> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const result = await TimelineEventModel.aggregate([
      { $match: { ts: { $gte: since } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]);
    
    const counts: Record<string, number> = {};
    for (const r of result) {
      counts[r._id] = r.count;
    }
    return counts;
  }
}

export const timelineService = new TimelineService();

console.log('[Phase 2] Timeline Service loaded');
