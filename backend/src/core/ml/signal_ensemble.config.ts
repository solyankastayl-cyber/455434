/**
 * P3.2 Signal Ensemble Config
 * 
 * Configuration for combining multiple signals
 */

export const SIGNAL_ENSEMBLE_CONFIG = {
  // Signal thresholds
  thresholds: {
    side: { 
      buy: 0.15,   // score >= 0.15 = BUY
      sell: -0.15  // score <= -0.15 = SELL
    },
    strength: { 
      strong: 0.55, // |score| >= 0.55 = STRONG
      medium: 0.30  // |score| >= 0.30 = MEDIUM
    }
  },
  
  // Component weights (must sum to ~1)
  weights: {
    exchangePressure: 0.45,  // CEX flow signals
    zones: 0.35,             // Accumulation/Distribution zones
    mlMarket: 0.20,          // ML market predictor
    smartMoney: 0.0          // Actor-based (disabled for now)
  },
  
  // Default confidence when component unavailable
  defaultConfidence: 0.5,
  
  // Interpretation thresholds for reasons
  interpretation: {
    exchangePressure: {
      strong: 0.15,
      description: {
        positive: 'CEX net inflow dominates (sell pressure)',
        negative: 'CEX net outflow dominates (buy pressure)'
      }
    },
    zones: {
      strong: 0.2,
      description: {
        positive: 'Accumulation zones outweigh distribution',
        negative: 'Distribution zones outweigh accumulation'
      }
    },
    mlMarket: {
      strong: 0.4,
      description: {
        positive: 'ML expects upside continuation',
        negative: 'ML expects downside continuation'
      }
    }
  }
};

export default SIGNAL_ENSEMBLE_CONFIG;
