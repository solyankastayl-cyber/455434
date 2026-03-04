/**
 * P3.3 Topology Configuration
 */

export const TOPOLOGY_CONFIG = {
  // Safety limits
  limits: {
    maxNodesForTopology: 5000,
    maxEdgesForTopology: 20000,
  },

  // Default settings
  defaults: {
    windows: ['24h', '7d'] as const,
    defaultSort: 'pagerank' as const,
    defaultLimit: 100,
  },

  // Allowed sort fields
  allowedSort: [
    'pagerank',
    'hubScore',
    'brokerScore',
    'kCore',
    'netFlowUsd',
    'degIn',
    'degOut',
  ] as const,

  // Role hint thresholds
  roleHintThresholds: {
    routerHubScore: 0.7,
    routerEntropy: 0.6,
    accumulatorEntropy: 0.4,
    distributorEntropy: 0.6,
  },

  // Market regime thresholds
  regimeThresholds: {
    centralizedGini: 0.7,
    centralizedEntropy: 0.4,
    distributedGini: 0.4,
    distributedEntropy: 0.6,
  },

  // PageRank parameters
  pagerank: {
    damping: 0.85,
    iterations: 25,
  },
};

export default TOPOLOGY_CONFIG;
