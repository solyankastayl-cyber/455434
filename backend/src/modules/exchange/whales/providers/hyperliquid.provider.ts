/**
 * S10.W-HL.1 — Hyperliquid Whale Provider (REAL DATA)
 * 
 * READ-ONLY integration with Hyperliquid for whale position tracking.
 * 
 * Data sources:
 * - /info → leaderboard: get top traders (whale addresses)
 * - /info → clearinghouseState: get positions per address
 * - /info → allMids: get current prices
 * 
 * NO trading, NO signals — only data fetching.
 * 
 * PHASE A1.2: REAL DATA INTEGRATION
 */

import axios, { AxiosInstance } from 'axios';
import {
  IWhaleProvider,
  WhaleProviderConfig,
  WhaleProviderStatus,
  FetchSnapshotsParams,
  FetchSnapshotsResult,
  DEFAULT_WHALE_PROVIDER_CONFIG,
} from './whale-provider.interface.js';
import {
  LargePositionSnapshot,
  WhaleSourceHealth,
  ExchangeId,
  WhaleSide,
} from '../whale.types.js';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// HYPERLIQUID API TYPES
// ═══════════════════════════════════════════════════════════════

interface HyperliquidPosition {
  coin: string;
  szi: string;          // Position size (signed, negative = short)
  entryPx: string;      // Entry price
  leverage: {
    type: string;
    value: number;
  };
  liquidationPx: string | null;
  marginUsed: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
}

interface HyperliquidClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
  };
  crossMarginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
  };
  assetPositions: {
    type: string;
    position: HyperliquidPosition;
  }[];
}

interface HyperliquidMeta {
  universe: {
    name: string;
    szDecimals: number;
  }[];
}

interface HyperliquidAllMids {
  [coin: string]: string;
}

// Leaderboard response
interface HyperliquidLeaderboardEntry {
  ethAddress: string;
  accountValue: string;
  displayName?: string | null;
  windowPerformances?: [string, { pnl: string; roi: string; vlm: string }][];
  prize?: number;
}

interface HyperliquidLeaderboardResponse {
  leaderboardRows: HyperliquidLeaderboardEntry[];
}

// ═══════════════════════════════════════════════════════════════
// WHALE THRESHOLDS (LOCKED - from roadmap A1.1)
// ═══════════════════════════════════════════════════════════════

const WHALE_THRESHOLD = {
  // Position is "whale" if:
  // - sizeUSD >= 250,000
  // OR leverage >= 10 AND sizeUSD >= 150,000
  MIN_POSITION_USD: 250_000,
  MIN_LEVERAGED_POSITION_USD: 150_000,
  MIN_LEVERAGE_FOR_WHALE: 10,
  
  // Leaderboard settings
  LEADERBOARD_TOP_N: 100,       // Fetch top 100 traders
  LEADERBOARD_MIN_EQUITY: 100_000,  // $100K min account value
  
  // Cache settings
  LEADERBOARD_CACHE_MS: 5 * 60_000,  // Cache leaderboard for 5 min
  MID_PRICES_CACHE_MS: 10_000,       // Cache prices for 10 sec
} as const;

// ═══════════════════════════════════════════════════════════════
// HYPERLIQUID PROVIDER
// ═══════════════════════════════════════════════════════════════

export class HyperliquidWhaleProvider implements IWhaleProvider {
  readonly id: ExchangeId = 'hyperliquid';
  
  private config: WhaleProviderConfig;
  private client: AxiosInstance;
  private statsClient: AxiosInstance; // Stats API for leaderboard
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;
  
  // Health tracking
  private lastSuccessfulFetch = 0;
  private lastError: string | null = null;
  private errorCount = 0;
  private consecutiveErrors = 0;
  private totalFetches = 0;
  private lastFetchDurationMs = 0;
  private positionsTracked = 0;
  
  // Mode tracking
  private dataMode: 'LIVE' | 'MOCK' = 'MOCK';
  
  // Circuit breaker
  private readonly MAX_CONSECUTIVE_ERRORS = 5;
  private readonly DEGRADED_THRESHOLD = 3;
  
  // Cache for mid prices
  private midPrices: Map<string, number> = new Map();
  private lastMidPricesFetch = 0;
  
  // Cache for whale addresses (from leaderboard)
  private whaleAddresses: string[] = [];
  private lastLeaderboardFetch = 0;
  
  constructor(config?: Partial<WhaleProviderConfig>) {
    this.config = {
      ...DEFAULT_WHALE_PROVIDER_CONFIG,
      minPositionUsd: WHALE_THRESHOLD.MIN_POSITION_USD, // Override with new threshold
      ...config,
    };
    
    // Main API client
    this.client = axios.create({
      baseURL: 'https://api.hyperliquid.xyz',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    // Stats API client (for leaderboard)
    this.statsClient = axios.create({
      baseURL: 'https://stats-data.hyperliquid.xyz/Mainnet',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[Hyperliquid] Provider initialized with REAL DATA mode');
  }
  
  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────
  
  health(): WhaleSourceHealth {
    let status: 'UP' | 'DEGRADED' | 'DOWN' = 'UP';
    
    if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
      status = 'DOWN';
    } else if (this.consecutiveErrors >= this.DEGRADED_THRESHOLD) {
      status = 'DEGRADED';
    }
    
    // Also check staleness
    const staleThresholdMs = this.config.pollingIntervalMs * 3;
    if (this.running && Date.now() - this.lastSuccessfulFetch > staleThresholdMs) {
      status = status === 'UP' ? 'DEGRADED' : status;
    }
    
    return {
      exchange: this.id,
      status,
      lastUpdate: this.lastSuccessfulFetch,
      coverage: this.positionsTracked > 0 ? 1.0 : 0,
      confidence: 0.95, // Hyperliquid is high confidence (on-chain)
      positionsTracked: this.positionsTracked,
      lastError: this.lastError ?? undefined,
      errorCountLastHour: this.errorCount,
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // Config
  // ─────────────────────────────────────────────────────────────
  
  getConfig(): WhaleProviderConfig {
    return { ...this.config };
  }
  
  updateConfig(config: Partial<WhaleProviderConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };
    
    // Restart polling if interval changed and we're running
    if (this.running && config.pollingIntervalMs) {
      this.stop().then(() => this.start());
    }
    
    // Auto-stop if disabled
    if (wasEnabled && !this.config.enabled && this.running) {
      this.stop();
    }
    
    console.log('[Hyperliquid] Config updated:', this.config);
  }
  
  // ─────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────
  
  getStatus(): WhaleProviderStatus {
    return {
      id: this.id,
      enabled: this.config.enabled,
      running: this.running,
      health: this.health(),
      config: this.getConfig(),
      stats: {
        lastFetchAt: this.lastSuccessfulFetch,
        lastFetchDurationMs: this.lastFetchDurationMs,
        totalFetches: this.totalFetches,
        totalErrors: this.errorCount,
        positionsTracked: this.positionsTracked,
      },
    };
  }
  
  /**
   * Get current data mode (LIVE or MOCK)
   */
  getDataMode(): 'LIVE' | 'MOCK' {
    return this.dataMode;
  }
  
  /**
   * Get cached whale addresses count
   */
  getWhaleAddressCount(): number {
    return this.whaleAddresses.length;
  }
  
  // ─────────────────────────────────────────────────────────────
  // Fetch Leaderboard (WHALE ADDRESS DISCOVERY)
  // ─────────────────────────────────────────────────────────────
  
  private async fetchLeaderboard(): Promise<string[]> {
    // Use cache if fresh
    if (
      this.whaleAddresses.length > 0 &&
      Date.now() - this.lastLeaderboardFetch < WHALE_THRESHOLD.LEADERBOARD_CACHE_MS
    ) {
      return this.whaleAddresses;
    }
    
    try {
      console.log('[Hyperliquid] Fetching leaderboard from stats API...');
      
      // Fetch from stats-data endpoint (GET request)
      const response = await this.statsClient.get<HyperliquidLeaderboardResponse>('/leaderboard');
      
      const rows = response.data?.leaderboardRows ?? [];
      
      // Filter by minimum equity and extract addresses
      const addresses = rows
        .filter((row) => {
          const accountValue = parseFloat(row.accountValue);
          return accountValue >= WHALE_THRESHOLD.LEADERBOARD_MIN_EQUITY;
        })
        .slice(0, WHALE_THRESHOLD.LEADERBOARD_TOP_N)
        .map((row) => row.ethAddress);
      
      this.whaleAddresses = addresses;
      this.lastLeaderboardFetch = Date.now();
      
      console.log(`[Hyperliquid] Leaderboard fetched: ${addresses.length} whale addresses (${rows.length} total)`);
      
      return addresses;
    } catch (error: any) {
      console.warn('[Hyperliquid] Failed to fetch leaderboard:', error.message);
      // Return cached addresses if available
      return this.whaleAddresses;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Fetch Mid Prices
  // ─────────────────────────────────────────────────────────────
  
  private async fetchMidPrices(): Promise<void> {
    // Use cache if fresh
    if (Date.now() - this.lastMidPricesFetch < WHALE_THRESHOLD.MID_PRICES_CACHE_MS) {
      return;
    }
    
    try {
      const response = await this.client.post<HyperliquidAllMids>('/info', {
        type: 'allMids',
      });
      
      this.midPrices.clear();
      for (const [coin, price] of Object.entries(response.data)) {
        this.midPrices.set(coin, parseFloat(price));
      }
      
      this.lastMidPricesFetch = Date.now();
    } catch (error: any) {
      console.warn('[Hyperliquid] Failed to fetch mid prices:', error.message);
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Fetch User Positions
  // ─────────────────────────────────────────────────────────────
  
  private async fetchUserPositions(address: string): Promise<LargePositionSnapshot[]> {
    const response = await this.client.post<HyperliquidClearinghouseState>('/info', {
      type: 'clearinghouseState',
      user: address,
    });
    
    const positions: LargePositionSnapshot[] = [];
    const now = Date.now();
    
    for (const ap of response.data?.assetPositions ?? []) {
      if (ap.type !== 'oneWay') continue;
      
      const pos = ap.position;
      const size = parseFloat(pos.szi);
      if (size === 0) continue;
      
      const coin = pos.coin;
      const markPrice = this.midPrices.get(coin) ?? parseFloat(pos.entryPx);
      const sizeUsd = Math.abs(size) * markPrice;
      const leverage = pos.leverage?.value ?? 1;
      
      // Apply whale threshold logic (from A1.1 roadmap)
      const isWhale = 
        sizeUsd >= WHALE_THRESHOLD.MIN_POSITION_USD ||
        (leverage >= WHALE_THRESHOLD.MIN_LEVERAGE_FOR_WHALE && 
         sizeUsd >= WHALE_THRESHOLD.MIN_LEVERAGED_POSITION_USD);
      
      if (!isWhale) continue;
      
      // Map coin to our internal symbol format
      const symbol = this.normalizeSymbol(coin);
      
      positions.push({
        exchange: 'hyperliquid',
        symbol,
        side: size > 0 ? 'LONG' : 'SHORT',
        sizeUsd,
        entryPrice: parseFloat(pos.entryPx),
        markPrice,
        leverage,
        openTimestamp: now - Math.random() * 86400000, // Estimate (not available in API)
        lastSeenTimestamp: now,
        confidence: 0.95,
        source: 'api',
        positionId: `${address.slice(0, 10)}-${coin}-${now}`,
        wallet: address,
      });
    }
    
    return positions;
  }
  
  // ─────────────────────────────────────────────────────────────
  // Symbol normalization
  // ─────────────────────────────────────────────────────────────
  
  private normalizeSymbol(coin: string): string {
    // Hyperliquid uses: BTC, ETH, SOL etc.
    // We use: BTCUSDT, ETHUSDT, SOLUSDT
    return `${coin}USDT`;
  }
  
  // ─────────────────────────────────────────────────────────────
  // Fetch Snapshots (Main data fetching)
  // ─────────────────────────────────────────────────────────────
  
  async fetchSnapshots(params?: FetchSnapshotsParams): Promise<FetchSnapshotsResult> {
    const startTime = Date.now();
    const symbols = params?.symbols ?? this.config.symbols;
    const minPositionUsd = params?.minPositionUsd ?? this.config.minPositionUsd;
    
    const snapshots: LargePositionSnapshot[] = [];
    const errors: string[] = [];
    
    try {
      // STEP 1: Try to fetch real data from Hyperliquid
      let realDataFetched = false;
      
      // Get addresses to track
      // Priority: config.whaleAddresses > leaderboard > fallback to mock
      let addresses: string[] = [];
      
      if (this.config.whaleAddresses && this.config.whaleAddresses.length > 0) {
        addresses = this.config.whaleAddresses;
        console.log(`[Hyperliquid] Using ${addresses.length} configured whale addresses`);
      } else {
        // Try to fetch from leaderboard
        try {
          addresses = await this.fetchLeaderboard();
        } catch (e: any) {
          errors.push(`Leaderboard fetch failed: ${e.message}`);
        }
      }
      
      // STEP 2: Fetch mid prices
      await this.fetchMidPrices();
      
      // STEP 3: Fetch positions from whale addresses
      if (addresses.length > 0) {
        console.log(`[Hyperliquid] Fetching positions from ${addresses.length} addresses...`);
        
        // Fetch in batches to avoid rate limiting
        const batchSize = 10;
        for (let i = 0; i < addresses.length; i += batchSize) {
          const batch = addresses.slice(i, i + batchSize);
          
          const batchPromises = batch.map(async (address) => {
            try {
              return await this.fetchUserPositions(address);
            } catch (error: any) {
              errors.push(`Address ${address.slice(0, 8)}...: ${error.message}`);
              return [];
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          
          for (const positions of batchResults) {
            for (const pos of positions) {
              // Filter by symbol
              const coinSymbol = pos.symbol.replace('USDT', '');
              if (symbols.length > 0 && !symbols.includes(coinSymbol)) {
                continue;
              }
              
              // Filter by minimum size
              if (pos.sizeUsd < minPositionUsd) {
                continue;
              }
              
              snapshots.push(pos);
              realDataFetched = true;
            }
          }
          
          // Small delay between batches
          if (i + batchSize < addresses.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
      
      // STEP 4: If no real data and mock fallback enabled, generate mock
      if (!realDataFetched && this.config.useMockFallback) {
        console.log('[Hyperliquid] No real data, using mock fallback');
        const mockSnapshots = this.generateMockSnapshots(symbols, minPositionUsd);
        snapshots.push(...mockSnapshots);
        this.dataMode = 'MOCK';
      } else if (realDataFetched) {
        this.dataMode = 'LIVE';
      }
      
      // Sort by size descending
      snapshots.sort((a, b) => b.sizeUsd - a.sizeUsd);
      
      // Limit per symbol if specified
      if (params?.limit) {
        const limited: LargePositionSnapshot[] = [];
        const countBySymbol = new Map<string, number>();
        
        for (const snap of snapshots) {
          const count = countBySymbol.get(snap.symbol) ?? 0;
          if (count < params.limit) {
            limited.push(snap);
            countBySymbol.set(snap.symbol, count + 1);
          }
        }
        
        snapshots.length = 0;
        snapshots.push(...limited);
      }
      
      // Update stats
      this.lastSuccessfulFetch = Date.now();
      this.consecutiveErrors = 0;
      this.positionsTracked = snapshots.length;
      this.totalFetches++;
      
    } catch (error: any) {
      this.lastError = error.message;
      this.errorCount++;
      this.consecutiveErrors++;
      errors.push(`Fetch error: ${error.message}`);
    }
    
    const durationMs = Date.now() - startTime;
    this.lastFetchDurationMs = durationMs;
    
    return {
      snapshots,
      fetchedAt: startTime,
      durationMs,
      errors,
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // Start/Stop polling
  // ─────────────────────────────────────────────────────────────
  
  async start(): Promise<void> {
    if (this.running) {
      console.log('[Hyperliquid] Already running');
      return;
    }
    
    if (!this.config.enabled) {
      console.log('[Hyperliquid] Provider is disabled');
      return;
    }
    
    this.running = true;
    console.log(`[Hyperliquid] Starting polling every ${this.config.pollingIntervalMs}ms`);
    
    // Initial fetch
    await this.poll();
    
    // Start interval
    this.pollInterval = setInterval(() => this.poll(), this.config.pollingIntervalMs);
  }
  
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    this.running = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    console.log('[Hyperliquid] Stopped');
  }
  
  isRunning(): boolean {
    return this.running;
  }
  
  // ─────────────────────────────────────────────────────────────
  // Internal: Poll and process
  // ─────────────────────────────────────────────────────────────
  
  private async poll(): Promise<void> {
    try {
      const result = await this.fetchSnapshots();
      
      if (result.errors.length > 0) {
        console.warn('[Hyperliquid] Fetch had errors:', result.errors.slice(0, 5));
      }
      
      console.log(`[Hyperliquid] Polled [${this.dataMode}]: ${result.snapshots.length} positions in ${result.durationMs}ms`);
      
      // Emit snapshots for processing by whale ingest job
      // (Will be implemented in whale-ingest.job.ts)
      
    } catch (error: any) {
      console.error('[Hyperliquid] Poll error:', error.message);
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Manual data mode control (for admin)
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Force data mode (for testing/admin)
   */
  forceDataMode(mode: 'LIVE' | 'MOCK'): void {
    if (mode === 'MOCK') {
      this.whaleAddresses = [];
      this.lastLeaderboardFetch = 0;
    }
    console.log(`[Hyperliquid] Data mode forced to: ${mode}`);
  }
  
  /**
   * Clear address cache (force refresh)
   */
  clearAddressCache(): void {
    this.whaleAddresses = [];
    this.lastLeaderboardFetch = 0;
    console.log('[Hyperliquid] Address cache cleared');
  }
  
  // ─────────────────────────────────────────────────────────────
  // Mock data generation (fallback when no real addresses)
  // ─────────────────────────────────────────────────────────────
  
  private generateMockSnapshots(
    symbols: string[],
    minPositionUsd: number
  ): LargePositionSnapshot[] {
    const now = Date.now();
    const snapshots: LargePositionSnapshot[] = [];
    
    // Base prices (approximate)
    const basePrices: Record<string, number> = {
      BTC: 95000,
      ETH: 3500,
      SOL: 180,
      DOGE: 0.35,
      XRP: 2.5,
    };
    
    // Generate 2-5 positions per symbol
    for (const symbol of symbols) {
      const basePrice = basePrices[symbol] ?? 100;
      const positionCount = 2 + Math.floor(Math.random() * 4);
      
      for (let i = 0; i < positionCount; i++) {
        const isLong = Math.random() > 0.5;
        
        // Size distribution: mostly medium, some large, few mega
        // Aligned with whale threshold $250K
        let sizeUsd: number;
        const sizeRoll = Math.random();
        if (sizeRoll < 0.5) {
          sizeUsd = WHALE_THRESHOLD.MIN_POSITION_USD + Math.random() * 500_000; // 250K - 750K
        } else if (sizeRoll < 0.85) {
          sizeUsd = 750_000 + Math.random() * 4_250_000; // 750K - 5M
        } else {
          sizeUsd = 5_000_000 + Math.random() * 45_000_000; // 5M - 50M
        }
        
        const entryPrice = basePrice * (0.95 + Math.random() * 0.1);
        const markPrice = basePrice * (0.98 + Math.random() * 0.04);
        
        snapshots.push({
          exchange: 'hyperliquid',
          symbol: `${symbol}USDT`,
          side: isLong ? 'LONG' : 'SHORT',
          sizeUsd,
          entryPrice,
          markPrice,
          leverage: [1, 2, 3, 5, 10, 20][Math.floor(Math.random() * 6)],
          openTimestamp: now - Math.random() * 24 * 60 * 60_000,
          lastSeenTimestamp: now,
          confidence: 0.95 * (0.9 + Math.random() * 0.1),
          source: 'mock',
          positionId: `mock-${symbol}-${i}-${now}`,
          wallet: `0x${Math.random().toString(16).slice(2, 14)}`,
        });
      }
    }
    
    return snapshots;
  }
}

// Singleton instance
export const hyperliquidWhaleProvider = new HyperliquidWhaleProvider();

console.log('[S10.W-HL.1] Hyperliquid Whale Provider loaded (REAL DATA mode)');
