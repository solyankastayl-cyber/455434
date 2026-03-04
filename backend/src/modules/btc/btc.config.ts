/**
 * BTC TERMINAL — FINAL PRODUCT
 * 
 * BLOCK A — BTC Isolation Layer
 * 
 * This module wraps the Fractal core for BTC-specific operations.
 * BTC Terminal is a frozen, production-ready product.
 * 
 * Rules:
 * - BTC module can only import from core/* (shared utils/types)
 * - BTC module CANNOT import from spx/* or combined/*
 * - All BTC data is stored in btc_* collections
 * - API namespace: /api/btc/v2.1/*
 * - UI route: /btc
 * 
 * Contract Version: BTC_V2.1.0_FINAL
 */

export const BTC_CONFIG = {
  symbol: 'BTC',
  contractVersion: 'BTC_V2.1.0_FINAL',
  apiPrefix: '/api/btc/v2.1',
  frozen: true,
  
  // Collection prefixes (for future isolation)
  collections: {
    snapshots: 'btc_snapshots',
    outcomes: 'btc_outcomes',
    consensusHistory: 'btc_consensus_history',
    intelTimeline: 'btc_intel_timeline_daily',
    intelAlerts: 'btc_intel_event_alerts',
    driftAlerts: 'btc_drift_alerts',
    driftIntelHistory: 'btc_drift_intel_history',
    policyProposals: 'btc_policy_proposals',
    policyApplications: 'btc_policy_applications',
    opsRuns: 'btc_ops_runs',
  },
  
  // Horizons (locked for BTC Final)
  horizons: [7, 14, 30, 90, 180, 365],
  
  // Governance
  governance: {
    liveOnlyApply: true,
    minSamplesForApply: 30,
    minSamplesForAlerts: 15,
  },
};

export default BTC_CONFIG;
