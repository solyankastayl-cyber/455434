/**
 * G3 AML/KYT Configuration
 * 
 * Thresholds and weights for AML risk assessment
 */

export const G3_CONFIG = {
  windowDefault: '30d' as const,

  /**
   * Weights for risk score composition (total max: 100)
   */
  scoreWeights: {
    sanctions: 100,        // hard stop to CRITICAL (handled separately)
    mixerExposure: 55,     // mixer interaction weight
    sanctionedExposure: 70, // sanctioned counterparty weight
    highRiskExposure: 40,  // high-risk actor weight
    bridgeExposure: 18,    // bridge usage weight
    unknownExposure: 10,   // unknown counterparty weight
  },

  /**
   * Verdict thresholds (risk score ranges)
   */
  verdictThresholds: {
    LOW: 0,
    MEDIUM: 25,
    HIGH: 50,
    CRITICAL: 75,
  },

  /**
   * Exposure flag thresholds (share of total volume)
   */
  exposureThresholds: {
    mixerHigh: 0.10,        // 10% mixer exposure triggers flag
    mixerCritical: 0.25,    // 25% mixer exposure is critical
    bridgeHigh: 0.30,       // 30% bridge exposure
    sanctionedAny: 0.001,   // any sanctioned exposure (0.1%)
    highRiskHigh: 0.15,     // 15% high-risk exposure
  },

  /**
   * Top counterparties list size
   */
  topCounterparties: 12,

  /**
   * Relation query limits (safety)
   */
  maxRelations: 5000,
};
