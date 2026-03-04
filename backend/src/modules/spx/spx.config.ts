/**
 * SPX TERMINAL — FINAL PRODUCT
 * 
 * BLOCK B — SPX Terminal Configuration
 * 
 * S&P 500 Index Fractal Terminal.
 * Parallel product to BTC Terminal with same architecture.
 * 
 * Rules:
 * - SPX module can only import from core/* (shared utils/types)
 * - SPX module CANNOT import from btc/* or combined/*
 * - All SPX data is stored in spx_* collections
 * - API namespace: /api/spx/v2.1/*
 * - UI route: /spx
 * 
 * Contract Version: SPX_V2.1.0_FINAL
 */

export const SPX_CONFIG = {
  symbol: 'SPX',
  contractVersion: 'SPX_V2.1.0_FINAL',
  apiPrefix: '/api/spx/v2.1',
  frozen: false, // Not frozen yet - still building
  status: 'BUILDING',
  
  // Collection prefixes
  collections: {
    snapshots: 'spx_snapshots',
    outcomes: 'spx_outcomes',
    consensusHistory: 'spx_consensus_history',
    intelTimeline: 'spx_intel_timeline_daily',
    intelAlerts: 'spx_intel_event_alerts',
    driftAlerts: 'spx_drift_alerts',
    driftIntelHistory: 'spx_drift_intel_history',
    policyProposals: 'spx_policy_proposals',
    policyApplications: 'spx_policy_applications',
    opsRuns: 'spx_ops_runs',
  },
  
  // Horizons (same as BTC for consistency)
  horizons: [7, 14, 30, 90, 180, 365],
  
  // Governance
  governance: {
    liveOnlyApply: true,
    minSamplesForApply: 30,
    minSamplesForAlerts: 15,
  },
  
  // Data source
  dataSource: {
    type: 'INDEX',
    name: 'S&P 500',
    ticker: 'SPX',
    timeframe: 'daily',
  },
};

export default SPX_CONFIG;
