/**
 * COMBINED TERMINAL — BTC×SPX Intelligence
 * 
 * BLOCK C — Combined Terminal Configuration
 * 
 * Maximum integration of BTC and SPX signals.
 * This is a separate product that never affects BTC/SPX Final terminals.
 * 
 * Rules:
 * - Combined can read from btc/* and spx/* (read-only)
 * - Combined has its own decision kernel
 * - BTC Final and SPX Final are never modified by Combined
 * - SPX influence can be toggled ON/OFF
 * 
 * Integration Layers:
 * - L1: Macro Gate (hard filters)
 * - L2: Sizing & Risk Controller
 * - L3: Direction Arbitration
 * - L4: Learning Coupling
 * 
 * Contract Version: COMBINED_V2.1.0
 */

export type IntegrationLayer = 'L1' | 'L2' | 'L3' | 'L4';
export type IntegrationProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export const COMBINED_CONFIG = {
  productName: 'Combined Terminal',
  version: 'COMBINED_V2.1.0',
  apiPrefix: '/api/combined/v2.1',
  status: 'BUILDING',
  
  // Assets
  primaryAsset: 'BTC',
  macroAsset: 'SPX',
  
  // Collections
  collections: {
    decisions: 'combined_decisions',
    intelTimeline: 'combined_intel_timeline',
    alerts: 'combined_alerts',
    learningHistory: 'combined_learning_history',
  },
  
  // Integration layers
  layers: {
    L1: {
      name: 'Macro Gate',
      description: 'Hard filters - SPX can block BTC entries in risk-off',
      enabled: true,
    },
    L2: {
      name: 'Sizing & Risk Controller',
      description: 'SPX influences position sizing and risk penalties',
      enabled: true,
    },
    L3: {
      name: 'Direction Arbitration',
      description: 'SPX can override BTC direction in Combined decision',
      enabled: true,
    },
    L4: {
      name: 'Learning Coupling',
      description: 'Cross-asset learning and policy proposals',
      enabled: true,
    },
  },
  
  // Default profile
  defaultProfile: 'AGGRESSIVE' as IntegrationProfile, // Max integration by default
  
  // Influence toggle
  spxInfluence: {
    enabled: true,
    canDisable: true, // User can turn OFF SPX influence
  },
  
  // Safety rules
  safety: {
    structuralLockPrecedence: true, // If BTC structural lock = ON, Combined respects it
    divergenceClamp: true, // Don't override when BTC divergence is high
    crisisMode: true, // Special rules during crisis
  },
};

export default COMBINED_CONFIG;
