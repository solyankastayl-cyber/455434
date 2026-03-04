/**
 * Phase O: Stream Service
 * 
 * Central service for publishing TA events
 */

import { Db } from 'mongodb';
import { EventBus } from './event_bus.js';
import { TAStreamEvent, TAStreamEventType } from './stream_types.js';
import { insertOutbox } from './outbox_store.js';

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export interface StreamServiceConfig {
  outboxEnabled: boolean;
}

export class TAStreamService {
  private bus: EventBus;
  private db: Db;
  private outboxEnabled: boolean;
  private emitCount = 0;

  constructor(deps: { bus: EventBus; db: Db; outboxEnabled?: boolean }) {
    this.bus = deps.bus;
    this.db = deps.db;
    this.outboxEnabled = deps.outboxEnabled ?? true;
  }

  /**
   * Emit a stream event
   */
  async emit(params: {
    type: TAStreamEventType;
    asset?: string;
    timeframe?: string;
    payload: any;
  }): Promise<string> {
    const event: TAStreamEvent = {
      id: `evt_${uid()}`,
      type: params.type,
      asset: params.asset,
      timeframe: params.timeframe,
      ts: Date.now(),
      payload: params.payload,
    };

    // Store in outbox for reliability
    if (this.outboxEnabled) {
      try {
        await insertOutbox(this.db, event);
      } catch (err) {
        console.warn('[Stream] Outbox insert error:', err);
      }
    }

    // Publish to live subscribers
    this.bus.publish(event);
    this.emitCount++;

    return event.id;
  }

  /**
   * Emit decision event
   */
  async emitDecision(params: {
    runId: string;
    asset: string;
    timeframe: string;
    topBias: string;
    topProbability: number;
    scenariosCount: number;
  }): Promise<string> {
    return this.emit({
      type: 'DECISION',
      asset: params.asset,
      timeframe: params.timeframe,
      payload: params,
    });
  }

  /**
   * Emit MTF decision event
   */
  async emitMTFDecision(params: {
    mtfRunId: string;
    asset: string;
    topBias: string;
    topProbability: number;
    confidence: string;
  }): Promise<string> {
    return this.emit({
      type: 'MTF_DECISION',
      asset: params.asset,
      timeframe: 'MTF',
      payload: params,
    });
  }

  /**
   * Emit regime update event
   */
  async emitRegimeUpdate(params: {
    asset: string;
    timeframe: string;
    marketRegime: string;
    volRegime: string;
    previousMarket?: string;
    previousVol?: string;
  }): Promise<string> {
    return this.emit({
      type: 'REGIME_UPDATE',
      asset: params.asset,
      timeframe: params.timeframe,
      payload: params,
    });
  }

  /**
   * Emit outcome update event
   */
  async emitOutcomeUpdate(params: {
    runId: string;
    scenarioId: string;
    asset: string;
    result: string;
    pnl?: number;
  }): Promise<string> {
    return this.emit({
      type: 'OUTCOME_UPDATE',
      asset: params.asset,
      payload: params,
    });
  }

  /**
   * Emit alert event
   */
  async emitAlert(params: {
    asset: string;
    alertType: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    data?: any;
  }): Promise<string> {
    return this.emit({
      type: 'ALERT',
      asset: params.asset,
      payload: params,
    });
  }

  /**
   * Get service stats
   */
  getStats(): { emitCount: number; outboxEnabled: boolean; busStats: any } {
    return {
      emitCount: this.emitCount,
      outboxEnabled: this.outboxEnabled,
      busStats: this.bus.getStats(),
    };
  }
}
