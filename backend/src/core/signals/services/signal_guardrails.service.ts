/**
 * A2 - Signal Guardrails Service
 * 
 * Safety layer that can BLOCK or CAP signal decisions.
 * Guardrails do NOT modify drivers A-F, only the final decision.
 * 
 * Rules (in order of priority):
 * - G1: Quality Gate → LOW quality forces NEUTRAL
 * - G2: Indexer Gate → DEGRADED/PAUSED forces NEUTRAL
 * - G3: Driver Conflict Gate → Strong disagreement forces NEUTRAL
 * - G4: Data Freshness Gate → Stale data forces NEUTRAL
 */
import type {
  GuardrailInput,
  GuardrailResult,
  GuardrailBlockReason,
  GuardrailConfig,
  DriverInfo,
  SignalDecision,
} from '../types/signal_guardrails.types.js';
import { DEFAULT_GUARDRAIL_CONFIG } from '../types/signal_guardrails.types.js';

// Bullish states
const BULLISH_STATES = new Set([
  'ACCUMULATION',
  'PERSISTENT',
  'ADDITION',
  'CONSOLIDATION',
  'GROWING',
  'ACTIVE',
  'SUPPORT',
]);

// Bearish states
const BEARISH_STATES = new Set([
  'DISTRIBUTION',
  'BREAKDOWN',
  'REMOVAL',
  'WEAK',
  'SHRINKING',
  'RESISTANCE',
]);

export class SignalGuardrailsService {
  private config: GuardrailConfig;

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...config };
  }

  /**
   * Apply all guardrails to a signal
   */
  apply(input: GuardrailInput): GuardrailResult {
    const blockedBy: GuardrailBlockReason[] = [];

    // G1 - Quality Gate
    if (this.config.enabled.qualityGate) {
      if (input.quality === 'LOW') {
        blockedBy.push('LOW_QUALITY');
      }
    }

    // G2 - Indexer Gate
    if (this.config.enabled.indexerGate) {
      if (input.indexerState === 'DEGRADED') {
        blockedBy.push('INDEXER_DEGRADED');
      }
      if (input.indexerState === 'PAUSED') {
        blockedBy.push('INDEXER_PAUSED');
      }
      if (input.indexerState === 'ERROR') {
        blockedBy.push('INDEXER_DEGRADED');
      }
    }

    // G3 - Driver Conflict Gate
    if (this.config.enabled.conflictGate) {
      if (this.hasDriverConflicts(input.drivers)) {
        blockedBy.push('DRIVER_CONFLICT');
      }
    }

    // G4 - Data Freshness Gate
    if (this.config.enabled.freshnessGate) {
      if (input.dataAgeSec > this.config.maxDataAgeSec) {
        blockedBy.push('STALE_DATA');
      }
    }

    // If any guardrail blocked, force NEUTRAL
    if (blockedBy.length > 0) {
      return {
        finalDecision: 'NEUTRAL',
        finalQuality: this.capQuality(input.quality, blockedBy),
        blocked: true,
        blockedBy,
        originalDecision: input.decision,
      };
    }

    // No blocks - pass through
    return {
      finalDecision: input.decision,
      finalQuality: input.quality,
      blocked: false,
      blockedBy: [],
      originalDecision: input.decision,
    };
  }

  /**
   * G3 - Check for driver conflicts
   * 
   * Conflicts occur when:
   * - Strong bullish drivers exist alongside strong bearish drivers
   * - Key drivers (A, B) disagree with each other
   */
  private hasDriverConflicts(drivers: Record<string, DriverInfo>): boolean {
    let bullishCount = 0;
    let bearishCount = 0;
    let bullishWeight = 0;
    let bearishWeight = 0;

    const strengthWeights = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    for (const [code, driver] of Object.entries(drivers)) {
      const weight = strengthWeights[driver.strength] || 1;

      if (BULLISH_STATES.has(driver.state)) {
        bullishCount++;
        bullishWeight += weight;
      } else if (BEARISH_STATES.has(driver.state)) {
        bearishCount++;
        bearishWeight += weight;
      }
    }

    // Conflict if both sides have strong signals
    // At least 2 drivers on each side with combined weight > 3
    const hasStrongConflict =
      bullishCount >= 2 &&
      bearishCount >= 2 &&
      bullishWeight >= 4 &&
      bearishWeight >= 4;

    return hasStrongConflict;
  }

  /**
   * Cap quality based on block reasons
   */
  private capQuality(
    originalQuality: 'HIGH' | 'MEDIUM' | 'LOW',
    blockedBy: GuardrailBlockReason[]
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    // LOW_QUALITY already forces LOW
    if (blockedBy.includes('LOW_QUALITY')) {
      return 'LOW';
    }

    // Indexer issues cap at MEDIUM
    if (
      blockedBy.includes('INDEXER_DEGRADED') ||
      blockedBy.includes('INDEXER_PAUSED')
    ) {
      return originalQuality === 'HIGH' ? 'MEDIUM' : originalQuality;
    }

    // Conflicts and stale data cap at MEDIUM
    if (blockedBy.includes('DRIVER_CONFLICT') || blockedBy.includes('STALE_DATA')) {
      return originalQuality === 'HIGH' ? 'MEDIUM' : originalQuality;
    }

    return originalQuality;
  }

  /**
   * Static convenience method
   */
  static apply(input: GuardrailInput): GuardrailResult {
    const service = new SignalGuardrailsService();
    return service.apply(input);
  }

  /**
   * Get default config (for admin display)
   */
  static getDefaultConfig(): GuardrailConfig {
    return { ...DEFAULT_GUARDRAIL_CONFIG };
  }
}

export default SignalGuardrailsService;
