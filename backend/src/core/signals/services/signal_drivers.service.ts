/**
 * U1.1 + U1.3 + A2 - Signal Drivers Service
 * 
 * Resolves ML attribution/stability into user-friendly signals A-F
 * This is the PRODUCT LAYER - no ML terminology exposed
 * 
 * U1.3 Integration: Uses SignalQualityService for reliable quality calculation
 * A2 Integration: Uses SignalGuardrailsService for safety rules
 */
import type {
  SignalDriversResponse,
  SignalDriver,
  SignalDecision,
  SignalQuality,
  SignalConfidence,
  SignalState,
  SignalStrength,
  DriverCode,
  STATE_SENTIMENT,
} from '../types/signal_driver.types.js';
import { DRIVER_META } from '../types/signal_driver.types.js';
import type { 
  StabilityVerdict, 
  AttributionVerdict, 
  IndexerMode 
} from '../types/signal_quality.types.js';
import type { IndexerState } from '../types/signal_guardrails.types.js';

// Import ML services for data
import { GroupAttributionService } from '../../ml_v3/services/group_attribution.service.js';
import { MlTrainingStabilityModel } from '../../ml_v3/models/ml_training_stability.model.js';

// U1.3 - Quality engine
import { SignalQualityService } from './signal_quality.service.js';
import { calculateDriverAgreement } from '../utils/driver_agreement.js';

// A2 - Guardrails
import { SignalGuardrailsService } from './signal_guardrails.service.js';

interface AttributionGroup {
  group: string;
  deltaF1: number;
  verdict: string;
  stability: string;
  confidence: number;
}

export class SignalDriversService {
  private readonly VERSION = 'v3.1'; // Updated for A2

  /**
   * Main entry point - resolve signals for a market asset
   */
  async resolveForMarket(asset: string, network: string = 'ethereum'): Promise<SignalDriversResponse> {
    // 1. Get latest attribution data
    const attribution = await this.getLatestAttribution(network);
    
    // 2. Get stability data
    const stability = await this.getLatestStability(network);

    // 3. Get indexer state (D4 integration)
    const { mode: indexerMode, state: indexerState, dataAgeSec } = await this.getIndexerStatus();

    // 4. Resolve each driver A-F
    const drivers: Record<DriverCode, SignalDriver> = {
      A: this.resolveExchangePressure(attribution),
      B: this.resolveZones(attribution),
      C: this.resolveCorridors(attribution),
      D: this.resolveLiquidity(attribution),
      E: this.resolveActors(attribution),
      F: this.resolveEvents(attribution),
    };

    // 5. Calculate overall decision
    const rawDecision = this.resolveDecision(drivers);
    
    // 6. U1.3 - Calculate quality using SignalQualityService
    const rawQuality = this.resolveQualityV2(attribution, stability, drivers, indexerMode);
    const confidence = this.resolveConfidence(stability);

    // 7. A2 - Apply guardrails
    const guardrailResult = SignalGuardrailsService.apply({
      decision: rawDecision,
      quality: rawQuality,
      drivers: this.driversToGuardrailFormat(drivers),
      indexerState,
      dataAgeSec,
    });

    return {
      asset,
      network,
      decision: guardrailResult.finalDecision,
      quality: guardrailResult.finalQuality,
      confidence,
      drivers,
      timestamp: Date.now(),
      version: this.VERSION,
      // A2 - Include guardrails info
      guardrails: {
        blocked: guardrailResult.blocked,
        blockedBy: guardrailResult.blockedBy,
        originalDecision: guardrailResult.blocked ? guardrailResult.originalDecision : undefined,
      },
    };
  }

  /**
   * Convert drivers to guardrail format
   */
  private driversToGuardrailFormat(drivers: Record<DriverCode, SignalDriver>): Record<string, { state: string; strength: 'HIGH' | 'MEDIUM' | 'LOW' }> {
    const result: Record<string, { state: string; strength: 'HIGH' | 'MEDIUM' | 'LOW' }> = {};
    for (const [code, driver] of Object.entries(drivers)) {
      result[code] = {
        state: driver.state,
        strength: driver.strength,
      };
    }
    return result;
  }

  /**
   * D4 Integration - Get current indexer status
   */
  private async getIndexerStatus(): Promise<{ mode: IndexerMode; state: IndexerState; dataAgeSec: number }> {
    try {
      const DEX_INDEXER_URL = process.env.DEX_API_URL || 'http://localhost:7099';
      const response = await fetch(`${DEX_INDEXER_URL}/admin/status`, {
        signal: AbortSignal.timeout(2000),
      });
      
      if (response.ok) {
        const data = await response.json();
        const indexer = data.indexer || {};
        
        // Calculate data age from last update
        const lastUpdate = indexer.lastUpdate ? new Date(indexer.lastUpdate).getTime() : 0;
        const dataAgeSec = lastUpdate ? Math.floor((Date.now() - lastUpdate) / 1000) : 9999;
        
        // Map indexer status
        let state: IndexerState = 'RUNNING';
        if (indexer.runtimeStatus === 'DEGRADED') state = 'DEGRADED';
        else if (indexer.paused) state = 'PAUSED';
        else if (indexer.runtimeStatus === 'ERROR') state = 'ERROR';
        
        const mode = (indexer.mode || 'LIMITED') as IndexerMode;
        
        return { mode, state, dataAgeSec };
      }
    } catch (e) {
      console.warn('[SignalDrivers] Could not fetch indexer status:', (e as Error).message);
    }
    
    return { mode: 'LIMITED', state: 'DEGRADED', dataAgeSec: 9999 };
  }

  /**
   * Get attribution data from ML layer
   */
  private async getLatestAttribution(network: string): Promise<Map<string, AttributionGroup>> {
    const result = await GroupAttributionService.getLatest(network, 'market');
    const map = new Map<string, AttributionGroup>();

    if (result?.groups) {
      for (const g of result.groups) {
        map.set(g.group, {
          group: g.group,
          deltaF1: g.deltaF1,
          verdict: g.verdict,
          stability: g.stability,
          confidence: g.confidence,
        });
      }
    }

    return map;
  }

  /**
   * Get stability data
   */
  private async getLatestStability(network: string): Promise<{ verdict: string; cv: number } | null> {
    const doc = await MlTrainingStabilityModel.findOne({
      network,
      task: 'market',
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!doc) return null;

    return {
      verdict: doc.verdict,
      cv: doc.stats?.cv?.f1 || 0,
    };
  }

  // ==========================================
  // DRIVER RESOLVERS (A-F)
  // ==========================================

  /**
   * A - Exchange Pressure (CEX flows)
   */
  private resolveExchangePressure(attr: Map<string, AttributionGroup>): SignalDriver {
    const cex = attr.get('CEX');
    
    if (!cex) {
      return this.neutralDriver('exchangePressure', 'No exchange data available');
    }

    // Interpret CEX attribution
    if (cex.verdict === 'CORE_POSITIVE' || cex.verdict === 'WEAK_POSITIVE') {
      return {
        key: 'exchangePressure',
        state: 'ACCUMULATION',
        strength: cex.verdict === 'CORE_POSITIVE' ? 'HIGH' : 'MEDIUM',
        summary: 'Sustained net outflow from exchanges',
      };
    }

    if (cex.verdict === 'NEGATIVE') {
      return {
        key: 'exchangePressure',
        state: 'DISTRIBUTION',
        strength: 'MEDIUM',
        summary: 'Net inflow to exchanges detected',
      };
    }

    return this.neutralDriver('exchangePressure', 'No strong exchange signal');
  }

  /**
   * B - Zones (accumulation/distribution zones)
   */
  private resolveZones(attr: Map<string, AttributionGroup>): SignalDriver {
    const zones = attr.get('ZONES');

    if (!zones) {
      return this.neutralDriver('zones', 'No zone data available');
    }

    if (zones.verdict === 'CORE_POSITIVE') {
      return {
        key: 'zones',
        state: 'ACCUMULATION',
        strength: 'HIGH',
        summary: 'Repeated buying in demand zones',
      };
    }

    if (zones.verdict === 'WEAK_POSITIVE') {
      return {
        key: 'zones',
        state: 'ACCUMULATION',
        strength: 'MEDIUM',
        summary: 'Some activity in demand zones',
      };
    }

    if (zones.verdict === 'NEGATIVE') {
      return {
        key: 'zones',
        state: 'DISTRIBUTION',
        strength: 'MEDIUM',
        summary: 'Selling pressure at supply zones',
      };
    }

    return this.neutralDriver('zones', 'No strong zone signal');
  }

  /**
   * C - Corridors (transaction paths)
   */
  private resolveCorridors(attr: Map<string, AttributionGroup>): SignalDriver {
    const corridors = attr.get('CORRIDORS');

    if (!corridors) {
      return this.neutralDriver('corridors', 'No corridor data available');
    }

    if (corridors.verdict === 'CORE_POSITIVE') {
      return {
        key: 'corridors',
        state: 'PERSISTENT',
        strength: 'HIGH',
        summary: 'Same transaction routes repeated over time',
      };
    }

    if (corridors.verdict === 'WEAK_POSITIVE') {
      return {
        key: 'corridors',
        state: 'PERSISTENT',
        strength: 'MEDIUM',
        summary: 'Some repeated corridor activity',
      };
    }

    if (corridors.verdict === 'NEGATIVE' || corridors.verdict === 'UNSTABLE') {
      return {
        key: 'corridors',
        state: 'WEAK',
        strength: 'LOW',
        summary: 'Corridor patterns breaking down',
      };
    }

    return this.neutralDriver('corridors', 'No persistent corridor behavior');
  }

  /**
   * D - Liquidity (LP movements)
   */
  private resolveLiquidity(attr: Map<string, AttributionGroup>): SignalDriver {
    const dex = attr.get('DEX');

    if (!dex) {
      return {
        key: 'liquidity',
        state: 'STABLE',
        strength: 'LOW',
        summary: 'Liquidity levels stable',
      };
    }

    if (dex.verdict === 'CORE_POSITIVE') {
      return {
        key: 'liquidity',
        state: 'ADDITION',
        strength: 'HIGH',
        summary: 'Significant liquidity being added',
      };
    }

    if (dex.verdict === 'NEGATIVE') {
      return {
        key: 'liquidity',
        state: 'REMOVAL',
        strength: 'MEDIUM',
        summary: 'Liquidity being removed from pools',
      };
    }

    return {
      key: 'liquidity',
      state: 'STABLE',
      strength: 'LOW',
      summary: 'No significant liquidity changes',
    };
  }

  /**
   * E - Actors (wallet behavior)
   */
  private resolveActors(attr: Map<string, AttributionGroup>): SignalDriver {
    // Actors derived from overall attribution pattern
    const hasPositive = Array.from(attr.values()).filter(
      a => a.verdict === 'CORE_POSITIVE' || a.verdict === 'WEAK_POSITIVE'
    ).length;

    const hasNegative = Array.from(attr.values()).filter(
      a => a.verdict === 'NEGATIVE'
    ).length;

    if (hasPositive >= 2) {
      return {
        key: 'actors',
        state: 'CONSOLIDATION',
        strength: hasPositive >= 3 ? 'HIGH' : 'MEDIUM',
        summary: 'Large holders reducing activity variance',
      };
    }

    if (hasNegative >= 2) {
      return {
        key: 'actors',
        state: 'DISTRIBUTION',
        strength: 'MEDIUM',
        summary: 'Key actors showing distribution patterns',
      };
    }

    return {
      key: 'actors',
      state: 'NEUTRAL',
      strength: 'LOW',
      summary: 'No clear actor behavior pattern',
    };
  }

  /**
   * F - Events (on-chain events)
   */
  private resolveEvents(attr: Map<string, AttributionGroup>): SignalDriver {
    // Events based on any UNSTABLE verdicts
    const unstable = Array.from(attr.values()).filter(
      a => a.verdict === 'UNSTABLE' || a.stability === 'UNSTABLE'
    ).length;

    if (unstable >= 2) {
      return {
        key: 'events',
        state: 'ALERT',
        strength: 'MEDIUM',
        summary: 'Unusual on-chain activity detected',
      };
    }

    return {
      key: 'events',
      state: 'QUIET',
      strength: 'LOW',
      summary: 'No abnormal on-chain events',
    };
  }

  // ==========================================
  // DECISION & QUALITY RESOLVERS
  // ==========================================

  /**
   * Calculate overall decision from drivers
   */
  private resolveDecision(drivers: Record<DriverCode, SignalDriver>): SignalDecision {
    let bullishScore = 0;
    let bearishScore = 0;

    const weights: Record<DriverCode, number> = {
      A: 3, // Exchange pressure most important
      B: 2,
      C: 2,
      D: 1,
      E: 2,
      F: 1,
    };

    for (const [code, driver] of Object.entries(drivers) as [DriverCode, SignalDriver][]) {
      const weight = weights[code];
      const strengthMultiplier = driver.strength === 'HIGH' ? 1.5 : driver.strength === 'MEDIUM' ? 1 : 0.5;

      if (this.isBullishState(driver.state)) {
        bullishScore += weight * strengthMultiplier;
      } else if (this.isBearishState(driver.state)) {
        bearishScore += weight * strengthMultiplier;
      }
    }

    const threshold = 3;

    if (bullishScore > bearishScore + threshold) return 'BUY';
    if (bearishScore > bullishScore + threshold) return 'SELL';
    return 'NEUTRAL';
  }

  /**
   * U1.3 - Calculate signal quality using SignalQualityService
   * 
   * Integrates:
   * - P1.1 Training Stability
   * - P1.2 Group Attribution
   * - D1-D4 Indexer State
   * - Driver Agreement
   */
  private resolveQualityV2(
    attr: Map<string, AttributionGroup>,
    stability: { verdict: string; cv: number } | null,
    drivers: Record<DriverCode, SignalDriver>,
    indexerMode: IndexerMode
  ): SignalQuality {
    // Convert stability to verdict
    let stabilityVerdict: StabilityVerdict = 'INSUFFICIENT_DATA';
    if (stability) {
      stabilityVerdict = stability.verdict === 'STABLE' ? 'STABLE' : 'UNSTABLE';
    }

    // Get dominant attribution verdict
    const attributionVerdict = this.getAttributionConsensus(attr);

    // Calculate driver agreement
    const driverAgreement = calculateDriverAgreement(drivers);

    // Use SignalQualityService
    const quality = SignalQualityService.fromFactors(
      stabilityVerdict,
      attributionVerdict,
      indexerMode,
      driverAgreement
    );

    return quality;
  }

  /**
   * Get consensus attribution verdict from all groups
   */
  private getAttributionConsensus(attr: Map<string, AttributionGroup>): AttributionVerdict {
    if (attr.size === 0) return 'NEUTRAL';

    const verdicts = Array.from(attr.values()).map(a => a.verdict);
    
    const corePositive = verdicts.filter(v => v === 'CORE_POSITIVE').length;
    const weakPositive = verdicts.filter(v => v === 'WEAK_POSITIVE').length;
    const negative = verdicts.filter(v => v === 'NEGATIVE').length;
    const unstable = verdicts.filter(v => v === 'UNSTABLE').length;

    // If any are unstable, whole consensus is unstable
    if (unstable >= 2) return 'UNSTABLE';

    // Determine dominant
    if (corePositive >= 2) return 'CORE_POSITIVE';
    if (negative >= 2) return 'NEGATIVE';
    if (corePositive + weakPositive >= 2) return 'WEAK_POSITIVE';

    return 'NEUTRAL';
  }

  /**
   * Legacy quality calculation (deprecated, kept for comparison)
   */
  private resolveQuality(
    attr: Map<string, AttributionGroup>,
    stability: { verdict: string; cv: number } | null
  ): SignalQuality {
    // Quality based on:
    // 1. How many groups have strong verdicts
    // 2. Stability of the model

    const strongVerdicts = Array.from(attr.values()).filter(
      a => a.verdict === 'CORE_POSITIVE' || a.verdict === 'NEGATIVE'
    ).length;

    const isStable = stability?.verdict === 'STABLE';

    if (strongVerdicts >= 2 && isStable) return 'HIGH';
    if (strongVerdicts >= 1 || isStable) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate confidence
   */
  private resolveConfidence(
    stability: { verdict: string; cv: number } | null
  ): SignalConfidence {
    if (!stability) return 'LOW';

    if (stability.verdict === 'STABLE' && stability.cv < 0.05) return 'HIGH';
    if (stability.verdict === 'STABLE') return 'MEDIUM';
    return 'LOW';
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private neutralDriver(key: string, summary: string): SignalDriver {
    return {
      key,
      state: 'NEUTRAL',
      strength: 'LOW',
      summary,
    };
  }

  private isBullishState(state: SignalState): boolean {
    return ['ACCUMULATION', 'PERSISTENT', 'ADDITION', 'CONSOLIDATION'].includes(state);
  }

  private isBearishState(state: SignalState): boolean {
    return ['DISTRIBUTION', 'BREAKDOWN', 'REMOVAL', 'WEAK'].includes(state);
  }
}

export default SignalDriversService;
