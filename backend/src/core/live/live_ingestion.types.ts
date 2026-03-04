/**
 * Live Ingestion Types
 * 
 * Shared type definitions for the LIVE ingestion system.
 */

// ==================== CANARY TOKENS ====================

export interface CanaryToken {
  symbol: string;
  address: string;
  decimals: number;
}

export const CANARY_TOKENS: CanaryToken[] = [
  {
    symbol: 'WETH',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
  },
  {
    symbol: 'USDT',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
  },
  {
    symbol: 'USDC',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
  },
  {
    symbol: 'DAI',
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    decimals: 18,
  },
  {
    symbol: 'LINK',
    address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    decimals: 18,
  },
];

// ==================== CHAIN CONFIG ====================

export const CHAIN_CONFIG = {
  CHAIN_ID: 1,                    // Ethereum mainnet
  CONFIRMATIONS: 12,              // Blocks behind head (safety)
  REWIND: 25,                     // Blocks to rewind on each cycle (reorg safety)
  MICRO_BACKFILL_HOURS: 6,        // Can be 2-6; default 6
  BLOCKS_PER_HOUR: 300,           // ~12s per block
};

// ==================== RANGE CONFIG ====================

export const RANGE_CONFIG = {
  RANGE_START: 1500,              // Initial range (blocks)
  RANGE_MIN: 50,                  // Minimum range if too many results
  RANGE_MAX: 5000,                // Maximum range for tailing
};

// ==================== RATE CONFIG ====================

export const RATE_CONFIG = {
  MAX_CONCURRENCY: 1,             // v1: Sequential processing
  POLLING_INTERVAL_MS: 60000,     // 60 seconds between cycles
  RPC_TIMEOUT_MS: 10000,          // 10s timeout per request
  MAX_RETRIES: 3,                 // Max retries per RPC call
};

// ==================== KILL SWITCH THRESHOLDS ====================

export const KILL_SWITCH_THRESHOLDS = {
  ERROR_RATE_MAX: 0.05,           // > 5% error rate
  RPC_LATENCY_P95_MAX: 1500,      // > 1500ms
  BACKLOG_BLOCKS_MAX: 5000,       // > 5000 blocks behind
  DUP_RATE_MAX: 0.01,             // > 1% duplicate rate
  MISSING_BLOCKS_MAX: 100,        // > 100 missing blocks
  PROVIDER_429_COUNT_MAX: 10,     // > 10 rate limit errors
};

// ==================== ERC20 TRANSFER TOPIC ====================

// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ==================== STATUS TYPES ====================

export interface LiveIngestionStatus {
  enabled: boolean;
  mode: 'OFF' | 'CANARY';
  lastBlock: number | null;
  safeHead: number | null;
  backlog: number | null;
  provider: 'infura' | 'ankr' | null;
  killSwitchArmed: boolean;
  killReason?: string;
  lastRun: Date | null;
  metrics: {
    eventsIngested24h: number;
    duplicateRate: number;
    errorRate: number;
    approvalPassRate?: number;
  };
  canaryTokens: string[];
}

export interface RunOnceResult {
  ok: boolean;
  summary?: {
    token: string;
    fromBlock: number;
    toBlock: number;
    fetched: number;
    inserted: number;
    duplicates: number;
    latency_ms: number;
    provider: string;
  };
  error?: string;
}

export interface ToggleResult {
  ok: boolean;
  enabled: boolean;
  updatedBy: 'operator' | 'system';
  updatedAt: Date;
}
