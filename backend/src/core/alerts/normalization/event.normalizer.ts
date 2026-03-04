/**
 * Event Normalizer Service (A0)
 * 
 * Purpose: Convert all signal types to NormalizedAlertEvent format
 * Makes events comparable for A1 (dedup), A2 (severity), A3 (grouping)
 * 
 * Architecture:
 * raw_signal → normalizeEvent() → NormalizedAlertEvent
 */
import { v4 as uuidv4 } from 'uuid';
import type { NormalizedAlertEvent, NormalizedEventMetrics } from './normalized_event.schema.js';
import { NormalizedAlertEventModel } from './normalized_event.model.js';

export class EventNormalizer {
  /**
   * Main normalization entry point
   * Dispatches to specific normalizer based on signal type
   */
  async normalize(rawSignal: any, ruleId: string, userId: string): Promise<NormalizedAlertEvent> {
    const signalType = rawSignal.type || rawSignal.signalType;
    
    // Dispatch to specific normalizer
    let normalized: NormalizedAlertEvent;
    
    switch (signalType) {
      case 'accumulation':
        normalized = this.normalizeAccumulation(rawSignal, ruleId, userId);
        break;
      
      case 'distribution':
        normalized = this.normalizeDistribution(rawSignal, ruleId, userId);
        break;
      
      case 'large_move':
        normalized = this.normalizeLargeMove(rawSignal, ruleId, userId);
        break;
      
      case 'smart_money_entry':
      case 'smart_money_exit':
        normalized = this.normalizeSmartMoney(rawSignal, ruleId, userId);
        break;
      
      case 'net_flow_spike':
        normalized = this.normalizeNetFlowSpike(rawSignal, ruleId, userId);
        break;
      
      case 'activity_spike':
        normalized = this.normalizeActivitySpike(rawSignal, ruleId, userId);
        break;
      
      default:
        // Generic normalization for unknown types
        normalized = this.normalizeGeneric(rawSignal, ruleId, userId);
    }
    
    // Store normalized event
    await this.store(normalized);
    
    return normalized;
  }

  /**
   * Normalize Accumulation signal
   */
  private normalizeAccumulation(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const netInflow = signal.netInflow || signal.value || 0;
    const threshold = signal.threshold || signal.rule?.threshold || 0;
    const baseline = signal.baseline || signal.avgInflow || threshold * 0.5; // Estimate if missing
    
    const deviation = baseline > 0 ? ((netInflow / baseline) - 1) * 100 : 0;
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: 'accumulation',
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address,
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain || 'Ethereum',
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value: netInflow,
        threshold,
        baseline,
        deviation,
        direction: 'in',
      },
      
      confidence: signal.confidence || 0.7,
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Normalize Distribution signal
   */
  private normalizeDistribution(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const netOutflow = Math.abs(signal.netOutflow || signal.value || 0);
    const threshold = Math.abs(signal.threshold || signal.rule?.threshold || 0);
    const baseline = signal.baseline || signal.avgOutflow || threshold * 0.5;
    
    const deviation = baseline > 0 ? ((netOutflow / baseline) - 1) * 100 : 0;
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: 'distribution',
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address,
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain || 'Ethereum',
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value: netOutflow,
        threshold,
        baseline,
        deviation,
        direction: 'out',
      },
      
      confidence: signal.confidence || 0.7,
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Normalize Large Move signal
   */
  private normalizeLargeMove(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const transferAmount = Math.abs(signal.amount || signal.value || 0);
    const threshold = signal.threshold || signal.rule?.threshold || 0;
    const baseline = signal.avgTransfer || threshold * 0.2; // Large moves typically 5x+ baseline
    
    const deviation = baseline > 0 ? ((transferAmount / baseline) - 1) * 100 : 0;
    
    // Infer direction from signal data
    const direction = signal.direction || (signal.toAddress ? 'out' : 'in');
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: 'large_move',
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address,
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain || 'Ethereum',
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value: transferAmount,
        threshold,
        baseline,
        deviation,
        direction: direction as 'in' | 'out',
      },
      
      confidence: signal.confidence || 0.8,
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Normalize Smart Money Entry/Exit
   */
  private normalizeSmartMoney(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const flowAmount = Math.abs(signal.totalFlow || signal.value || 0);
    const threshold = signal.threshold || signal.rule?.threshold || 0;
    const baseline = signal.avgSmartFlow || threshold * 0.4;
    
    const deviation = baseline > 0 ? ((flowAmount / baseline) - 1) * 100 : 0;
    
    const isEntry = signal.type === 'smart_money_entry' || signal.signalType === 'smart_money_entry';
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: signal.type || signal.signalType,
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address,
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain || 'Ethereum',
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value: flowAmount,
        threshold,
        baseline,
        deviation,
        direction: isEntry ? 'in' : 'out',
      },
      
      confidence: signal.confidence || 0.85, // Higher confidence for smart money
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Normalize Net Flow Spike
   */
  private normalizeNetFlowSpike(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const spikeAmount = Math.abs(signal.spikeValue || signal.value || 0);
    const threshold = signal.threshold || signal.rule?.threshold || 0;
    const baseline = signal.baseline || threshold * 0.5;
    
    const deviation = baseline > 0 ? ((spikeAmount / baseline) - 1) * 100 : 0;
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: 'net_flow_spike',
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address,
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain || 'Ethereum',
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value: spikeAmount,
        threshold,
        baseline,
        deviation,
        direction: signal.direction || 'in',
      },
      
      confidence: signal.confidence || 0.75,
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Normalize Activity Spike
   */
  private normalizeActivitySpike(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const activityCount = signal.transactionCount || signal.value || 0;
    const threshold = signal.threshold || signal.rule?.threshold || 0;
    const baseline = signal.avgActivity || threshold * 0.5;
    
    const deviation = baseline > 0 ? ((activityCount / baseline) - 1) * 100 : 0;
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: 'activity_spike',
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address,
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain || 'Ethereum',
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value: activityCount,
        threshold,
        baseline,
        deviation,
        direction: 'in', // Activity spikes are always inbound concept
      },
      
      confidence: signal.confidence || 0.7,
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Generic normalization for unknown signal types
   */
  private normalizeGeneric(signal: any, ruleId: string, userId: string): NormalizedAlertEvent {
    const value = signal.value || 0;
    const threshold = signal.threshold || 0;
    const baseline = signal.baseline || threshold * 0.5;
    
    const deviation = baseline > 0 ? ((value / baseline) - 1) * 100 : 0;
    
    return {
      eventId: uuidv4(),
      ruleId,
      userId,
      
      signalType: signal.type || signal.signalType || 'unknown',
      scope: signal.scope || 'token',
      targetId: signal.targetId || signal.address || 'unknown',
      targetMeta: {
        symbol: signal.symbol,
        name: signal.name,
        chain: signal.chain,
      },
      
      triggeredAt: signal.triggeredAt || new Date(),
      
      metrics: {
        value,
        threshold,
        baseline,
        deviation,
        direction: signal.direction || 'in',
      },
      
      confidence: signal.confidence || 0.5,
      
      marketContext: signal.marketContext,
      
      rawSignal: signal,
    };
  }

  /**
   * Store normalized event in database
   */
  private async store(event: NormalizedAlertEvent): Promise<void> {
    try {
      await NormalizedAlertEventModel.create(event);
    } catch (error) {
      console.error('[EventNormalizer] Failed to store normalized event:', error);
      // Non-blocking - continue even if storage fails
    }
  }
}

// Export singleton instance
export const eventNormalizer = new EventNormalizer();
