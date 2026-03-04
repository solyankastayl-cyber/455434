/**
 * Detector Registry — Central registry for all pattern detectors
 * 
 * Manages detector lifecycle and pattern detection pipeline.
 * 
 * Phase 8: Added reversal detectors
 * Phase R: Added expanded pattern detectors (R4-R7)
 * Phase R8-R10: Elliott, Gaps, MA, Divergences, Pitchfork, Broadening
 */

import { Detector, TAContext, CandidatePattern } from '../domain/types.js';
import { TriangleDetector, DEFAULT_TRIANGLE_CONFIG } from '../core/triangle.detector.js';
import { FlagDetector, DEFAULT_FLAG_CONFIG } from '../core/flag.detector.js';
import { ChannelDetector, DEFAULT_CHANNEL_CONFIG } from '../core/channel.detector.js';
import { DoubleDetector, DEFAULT_DOUBLE_CONFIG } from './reversal/double.detector.js';
import { HSDetector, DEFAULT_HS_CONFIG } from './reversal/hs.detector.js';
import { BreakoutRetestDetector, DEFAULT_BREAKOUT_CONFIG } from './reversal/breakout_retest.detector.js';
import { CandlePackDetector, DEFAULT_CANDLE_CONFIG } from './reversal/candle_pack.detector.js';
import { DivergenceDetector, DEFAULT_DIVERGENCE_CONFIG } from './reversal/divergence.detector.js';
import { ABCDDetector, DEFAULT_ABCD_CONFIG } from './reversal/abcd.detector.js';
import { PHASE_R_DETECTORS } from './phase_r_adapter.js';
import { PHASE_R8_R10_DETECTORS } from './phase_r8_r10_adapter.js';
import { PHASE_T_DETECTORS } from './phase_t/index.js';

/**
 * Singleton registry for all detectors
 */
class DetectorRegistry {
  private detectors: Map<string, Detector> = new Map();
  
  /**
   * Register a detector
   */
  register(detector: Detector): void {
    this.detectors.set(detector.id, detector);
    console.log(`[TA] Registered detector: ${detector.name} v${detector.version} (${detector.types.join(', ')})`);
  }
  
  /**
   * Unregister a detector
   */
  unregister(id: string): void {
    this.detectors.delete(id);
  }
  
  /**
   * Get a detector by ID
   */
  get(id: string): Detector | undefined {
    return this.detectors.get(id);
  }
  
  /**
   * Get all registered detectors
   */
  getAll(): Detector[] {
    return Array.from(this.detectors.values());
  }
  
  /**
   * Run all detectors on context
   */
  detectAll(ctx: TAContext): CandidatePattern[] {
    const allPatterns: CandidatePattern[] = [];
    
    for (const detector of this.detectors.values()) {
      try {
        const patterns = detector.detect(ctx);
        allPatterns.push(...patterns);
      } catch (err) {
        console.error(`[TA] Detector ${detector.id} failed:`, err);
      }
    }
    
    // Sort by total score descending
    return allPatterns.sort((a, b) => 
      (b.metrics?.totalScore ?? 0) - (a.metrics?.totalScore ?? 0)
    );
  }
  
  /**
   * Get detector count
   */
  count(): number {
    return this.detectors.size;
  }
  
  /**
   * List all detector IDs
   */
  listIds(): string[] {
    return Array.from(this.detectors.keys());
  }

  /**
   * List all detector info
   */
  listInfo(): Array<{ id: string; name: string; types: string[]; version: string }> {
    return this.getAll().map(d => ({
      id: d.id,
      name: d.name,
      types: d.types,
      version: d.version,
    }));
  }
}

// Singleton instance
export const detectorRegistry = new DetectorRegistry();

/**
 * Register a detector
 */
export function registerDetector(detector: Detector): void {
  detectorRegistry.register(detector);
}

/**
 * Get the detector registry
 */
export function getDetectorRegistry(): DetectorRegistry {
  return detectorRegistry;
}

/**
 * Initialize all built-in detectors
 */
export function initializeDetectors(): void {
  console.log('[TA] Initializing pattern detectors...');
  
  // ═══════════════════════════════════════════════════════════════
  // Continuation Patterns (Phase 3)
  // ═══════════════════════════════════════════════════════════════
  
  // Triangle/Wedge Detector
  const triangleDetector = new TriangleDetector(DEFAULT_TRIANGLE_CONFIG);
  detectorRegistry.register(triangleDetector);
  
  // Flag/Pennant Detector
  const flagDetector = new FlagDetector(DEFAULT_FLAG_CONFIG);
  detectorRegistry.register(flagDetector);
  
  // Channel/Trendline Detector
  const channelDetector = new ChannelDetector(DEFAULT_CHANNEL_CONFIG);
  detectorRegistry.register(channelDetector);
  
  // ═══════════════════════════════════════════════════════════════
  // Reversal Patterns (Phase 8)
  // ═══════════════════════════════════════════════════════════════
  
  // Double Top/Bottom Detector (8.1)
  const doubleDetector = new DoubleDetector(DEFAULT_DOUBLE_CONFIG);
  detectorRegistry.register(doubleDetector);
  
  // Head & Shoulders Detector (8.2)
  const hsDetector = new HSDetector(DEFAULT_HS_CONFIG);
  detectorRegistry.register(hsDetector);
  
  // Breakout/Retest Detector (8.3)
  const brDetector = new BreakoutRetestDetector(DEFAULT_BREAKOUT_CONFIG);
  detectorRegistry.register(brDetector);
  
  // Candle Pack Detector (8.4)
  const candleDetector = new CandlePackDetector(DEFAULT_CANDLE_CONFIG);
  detectorRegistry.register(candleDetector);
  
  // Divergence Detector (8.5)
  const divergenceDetector = new DivergenceDetector(DEFAULT_DIVERGENCE_CONFIG);
  detectorRegistry.register(divergenceDetector);
  
  // AB=CD Harmonic Detector (8.6)
  const abcdDetector = new ABCDDetector(DEFAULT_ABCD_CONFIG);
  detectorRegistry.register(abcdDetector);
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R: Expanded Pattern Detectors (R4-R7)
  // ═══════════════════════════════════════════════════════════════
  
  for (const detector of PHASE_R_DETECTORS) {
    detectorRegistry.register(detector);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R8-R10: Elliott, Gaps, Pitchfork, Broadening
  // ═══════════════════════════════════════════════════════════════
  
  for (const detector of PHASE_R8_R10_DETECTORS) {
    detectorRegistry.register(detector);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Phase T: Complete Registry Coverage (18 remaining patterns)
  // ═══════════════════════════════════════════════════════════════
  
  for (const detector of PHASE_T_DETECTORS) {
    detectorRegistry.register(detector);
  }
  
  console.log(`[TA] ✅ ${detectorRegistry.count()} detectors initialized`);
}

/**
 * Create configured detectors (alternative factory method)
 */
export function createDetectors(): Detector[] {
  return [
    // Continuation
    new TriangleDetector(DEFAULT_TRIANGLE_CONFIG),
    new FlagDetector(DEFAULT_FLAG_CONFIG),
    new ChannelDetector(DEFAULT_CHANNEL_CONFIG),
    // Reversal (Phase 8.1-8.3)
    new DoubleDetector(DEFAULT_DOUBLE_CONFIG),
    new HSDetector(DEFAULT_HS_CONFIG),
    new BreakoutRetestDetector(DEFAULT_BREAKOUT_CONFIG),
    // Advanced (Phase 8.4-8.6)
    new CandlePackDetector(DEFAULT_CANDLE_CONFIG),
    new DivergenceDetector(DEFAULT_DIVERGENCE_CONFIG),
    new ABCDDetector(DEFAULT_ABCD_CONFIG),
    // Phase R (R4-R7)
    ...PHASE_R_DETECTORS,
    // Phase R8-R10
    ...PHASE_R8_R10_DETECTORS,
    // Phase T (Complete Registry)
    ...PHASE_T_DETECTORS,
  ];
}
