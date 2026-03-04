/**
 * G2 Cybercrime Hunter Configuration
 * 
 * Thresholds and parameters for cybercrime detectors
 */

export const G2_CONFIG = {
  /**
   * RAPID_DRAIN detector (transfers-based)
   * Detects fast, large outflows to many destinations
   */
  rapidDrain: {
    windowsSec: [900, 3600, 21600, 86400], // 15m, 1h, 6h, 24h
    minOutflowUsd: {
      900: 250_000,      // 15m: $250k
      3600: 750_000,     // 1h: $750k
      21600: 2_000_000,  // 6h: $2M
      86400: 5_000_000,  // 24h: $5M
    },
    minUniqueDests: {
      900: 8,            // 15m: 8 destinations
      3600: 12,          // 1h: 12 destinations
      21600: 20,         // 6h: 20 destinations
      86400: 30,         // 24h: 30 destinations
    },
    minOutToInRatio: 3.0,        // outflow must dominate inflow (3x)
    minConfidence: 0.55,          // minimum confidence threshold
  },

  /**
   * FUNNEL detector (relations-based)
   * Detects many-to-one-to-few patterns (scam collection)
   */
  funnel: {
    windowSec: 86400,             // 24h
    minUniqueSenders: 25,         // at least 25 unique incoming relations
    minOutflowUsd: 500_000,       // minimum total outflow
    maxTop1DestShare: 0.75,       // top destination shouldn't be >75% (avoid normal payouts)
    minInToOutRatio: 1.5,         // inflow should exceed outflow
    minConfidence: 0.55,
  },

  /**
   * BRIDGE_ESCAPE detector (transfers-based)
   * Detects large outflows to bridge contracts
   */
  bridgeEscape: {
    windowSec: 21600,             // 6h
    minBridgeOutflowUsd: 300_000, // minimum bridge outflow
    minBridgeShare: 0.25,         // at least 25% of outflow to bridges
    minConfidence: 0.55,
  },

  /**
   * DISPERSAL detector (relations-based)
   * Detects one-to-many rapid distribution patterns
   */
  dispersal: {
    windowSec: 86400,             // 24h
    minUniqueRecipients: 20,      // at least 20 unique outgoing relations
    minOutflowUsd: 250_000,       // minimum total outflow
    maxTop1DestShare: 0.30,       // top destination shouldn't dominate (max 30%)
    minConfidence: 0.55,
  },
};

/**
 * Window label mapping
 */
export function getWindowLabel(windowSec: number): '15m' | '1h' | '6h' | '24h' | '7d' | '30d' {
  if (windowSec <= 900) return '15m';
  if (windowSec <= 3600) return '1h';
  if (windowSec <= 21600) return '6h';
  if (windowSec <= 86400) return '24h';
  if (windowSec <= 604800) return '7d';
  return '30d';
}
