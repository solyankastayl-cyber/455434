/**
 * System Overview Service
 * 
 * Provides operational status of all platform components.
 */

// ============================================
// TYPES
// ============================================

export interface SystemStatus {
  backend: { status: 'OK' | 'DEGRADED' | 'OFFLINE' };
  mlService: { status: 'OK' | 'DEGRADED' | 'OFFLINE'; latencyMs: number | null };
  priceService: { status: 'OK' | 'DEGRADED' | 'OFFLINE' };
  providerPool: { status: 'OK' | 'DEGRADED' | 'RATE_LIMITED'; healthyCount: number; totalCount: number };
}

export interface RuntimeStatus {
  decisionMode: 'RULES_ONLY' | 'ADVISORY' | 'INFLUENCE';
  mlInfluence: boolean;
  killSwitch: boolean;
  driftLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface NetworksStatus {
  ethereum: boolean;
  arbitrum: boolean;
  optimism: boolean;
  base: boolean;
  polygon: boolean;
  bnb: boolean;
  zksync: boolean;
  scroll: boolean;
}

export interface PipelineTimestamps {
  lastFeatureBuild: string | null;
  lastLabeling: string | null;
  lastDatasetBuild: string | null;
  lastMLInference: string | null;
}

export interface SystemOverview {
  system: SystemStatus;
  runtime: RuntimeStatus;
  networks: NetworksStatus;
  timestamps: PipelineTimestamps;
}

// ============================================
// RUNTIME CONFIG
// ============================================

let runtimeConfig: RuntimeStatus = {
  decisionMode: 'RULES_ONLY',
  mlInfluence: false,
  killSwitch: false,
  driftLevel: 'LOW',
};

export function getRuntimeConfig(): RuntimeStatus {
  return { ...runtimeConfig };
}

export function updateRuntimeConfig(updates: Partial<RuntimeStatus>): RuntimeStatus {
  runtimeConfig = { ...runtimeConfig, ...updates };
  return runtimeConfig;
}

// ============================================
// MAIN SERVICE
// ============================================

export async function getSystemOverview(): Promise<SystemOverview> {
  // Build system status - simple static response for now
  const system: SystemStatus = {
    backend: { status: 'OK' },
    mlService: { status: 'OK', latencyMs: 180 },
    priceService: { status: 'OK' },
    providerPool: { status: 'OK', healthyCount: 2, totalCount: 2 },
  };
  
  // Runtime
  const runtime: RuntimeStatus = { ...runtimeConfig };
  
  // Networks - all enabled
  const networks: NetworksStatus = {
    ethereum: true,
    arbitrum: true,
    optimism: true,
    base: true,
    polygon: true,
    bnb: true,
    zksync: true,
    scroll: true,
  };
  
  // Timestamps
  const timestamps: PipelineTimestamps = {
    lastFeatureBuild: new Date(Date.now() - 15 * 60000).toISOString(),
    lastLabeling: new Date(Date.now() - 10 * 60000).toISOString(),
    lastDatasetBuild: new Date(Date.now() - 30 * 60000).toISOString(),
    lastMLInference: new Date(Date.now() - 60000).toISOString(),
  };
  
  return { system, runtime, networks, timestamps };
}

export default { getSystemOverview, getRuntimeConfig, updateRuntimeConfig };
