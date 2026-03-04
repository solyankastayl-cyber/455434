/**
 * Signals Service
 * Business logic for signals (event layer)
 */
import {
  signalsRepository,
  SignalFilter,
} from './signals.repository.js';
import { 
  ISignal, 
  SignalType, 
  SignalSeverity
} from './signals.model.js';

/**
 * Format signal for API response
 */
export function formatSignal(signal: ISignal) {
  return {
    id: signal._id.toString(),
    entityType: signal.entityType,
    entityId: signal.entityId,
    signalType: signal.signalType,
    // Legacy flat fields (for backward compatibility)
    prevBundleType: signal.prevBundleType,
    newBundleType: signal.newBundleType,
    prevIntensity: signal.prevIntensity,
    newIntensity: signal.newIntensity,
    // Structured state (for UI diff, alerts templating, strategy)
    prevState: {
      bundleType: signal.prevBundleType,
      intensity: signal.prevIntensity,
    },
    newState: {
      bundleType: signal.newBundleType,
      intensity: signal.newIntensity,
    },
    confidence: signal.confidence,
    severityScore: signal.severityScore,
    severity: signal.severity,
    window: signal.window,
    chain: signal.chain,
    triggeredAt: signal.triggeredAt,
    explanation: signal.explanation,
    relatedAddresses: signal.relatedAddresses,
    acknowledged: signal.acknowledged,
  };
}

/**
 * Signals Service Class
 */
export class SignalsService {
  /**
   * Get signal by ID
   */
  async getById(id: string): Promise<ISignal | null> {
    return signalsRepository.findById(id);
  }

  /**
   * Get latest signals
   */
  async getLatest(
    options: {
      limit?: number;
      signalType?: SignalType;
      severity?: SignalSeverity;
      minSeverityScore?: number;
      window?: string;
      acknowledged?: boolean;
      since?: Date;
    } = {}
  ): Promise<ISignal[]> {
    return signalsRepository.findLatest(options);
  }

  /**
   * Get signals for address
   */
  async getForAddress(
    address: string,
    options: {
      limit?: number;
      signalType?: SignalType;
      severity?: SignalSeverity;
      since?: Date;
    } = {}
  ): Promise<{
    signals: ISignal[];
    summary: {
      total: number;
      critical: number;
      high: number;
      unacknowledged: number;
    };
  }> {
    const signals = await signalsRepository.findForAddress(address, options);

    // Calculate summary
    let critical = 0;
    let high = 0;
    let unacknowledged = 0;

    signals.forEach((s) => {
      if (s.severity === 'critical') critical++;
      if (s.severity === 'high') high++;
      if (!s.acknowledged) unacknowledged++;
    });

    return {
      signals,
      summary: {
        total: signals.length,
        critical,
        high,
        unacknowledged,
      },
    };
  }

  /**
   * Get signals for corridor
   */
  async getForCorridor(
    from: string,
    to: string,
    options: {
      limit?: number;
      signalType?: SignalType;
      since?: Date;
    } = {}
  ): Promise<ISignal[]> {
    return signalsRepository.findForCorridor(from, to, options);
  }

  /**
   * Query signals with filters
   */
  async query(
    filter: SignalFilter,
    limit: number = 50
  ): Promise<{ signals: ISignal[]; total: number }> {
    return signalsRepository.findMany(filter, undefined, { limit, offset: 0 });
  }

  /**
   * Acknowledge signal
   */
  async acknowledge(id: string): Promise<ISignal | null> {
    return signalsRepository.acknowledge(id);
  }

  /**
   * Bulk acknowledge signals
   */
  async bulkAcknowledge(ids: string[]): Promise<number> {
    return signalsRepository.bulkAcknowledge(ids);
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalSignals: number;
    unacknowledged: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    last24h: number;
  }> {
    return signalsRepository.getStats();
  }
}

// Export singleton instance
export const signalsService = new SignalsService();
