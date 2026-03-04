/**
 * ALT SCANNER SERVICE
 * ====================
 * 
 * Main orchestrator for the Alt Scanner feature.
 * Combines: Market Data → Indicators → Clustering → Ranking
 */

import type {
  IndicatorVector,
  AltOpportunity,
  AltRadarResponse,
  AltClusterDetailResponse,
  Venue,
  Timeframe,
  Direction,
  AltFacet,
} from './types.js';
import type { IMarketDataPort } from './market-data.port.js';
import { MockMarketDataAdapter } from './adapters/mock-market.adapter.js';
import { LiveMarketDataAdapter } from './adapters/live-market.adapter.js';
import { indicatorEngine } from './indicators/index.js';
import { patternClusteringService, type ClusteringResult } from './clustering/index.js';
import { opportunityRankingService, type RankingResult } from './ranking/index.js';
import { ALT_DEFAULT_UNIVERSE } from './constants.js';

// Check if we should use live data
const USE_LIVE_DATA = process.env.ALT_SCANNER_LIVE !== 'false';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ScannerConfig {
  venue: Venue;
  timeframe: Timeframe;
  universe: string[];
  candleLimit: number;
  parallel: number;
}

export interface ScanResult {
  radar: AltRadarResponse;
  clustering: ClusteringResult;
  ranking: RankingResult;
  performance: {
    dataFetchMs: number;
    indicatorMs: number;
    clusteringMs: number;
    rankingMs: number;
    totalMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// ALT SCANNER SERVICE
// ═══════════════════════════════════════════════════════════════

export class AltScannerService {
  private marketData: IMarketDataPort;
  private config: ScannerConfig;
  
  // Cache for recent results
  private lastScan: ScanResult | null = null;
  private lastScanTime = 0;
  private cacheTtlMs = 60_000; // 1 minute cache

  constructor(
    marketDataPort?: IMarketDataPort,
    config?: Partial<ScannerConfig>
  ) {
    // Use Live adapter by default, fallback to Mock
    if (marketDataPort) {
      this.marketData = marketDataPort;
    } else if (USE_LIVE_DATA) {
      this.marketData = new LiveMarketDataAdapter('BYBIT', 'BYBIT');
      console.log('[AltScanner] Using LIVE market data (Bybit primary, Binance fallback)');
    } else {
      this.marketData = new MockMarketDataAdapter();
      console.log('[AltScanner] Using MOCK market data');
    }
    
    // Determine venue from adapter
    const venue: Venue = USE_LIVE_DATA ? 'BYBIT' : 'MOCK';
    
    this.config = {
      venue,
      timeframe: '1h',
      universe: ALT_DEFAULT_UNIVERSE,
      candleLimit: 100,
      parallel: 5,
      ...config,
    };

    console.log(`[AltScanner] Initialized with ${this.config.universe.length} assets, venue=${this.config.venue}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN SCAN METHOD
  // ═══════════════════════════════════════════════════════════════

  async scan(forceRefresh = false): Promise<ScanResult> {
    const startTime = Date.now();

    // Check cache
    if (!forceRefresh && this.lastScan && Date.now() - this.lastScanTime < this.cacheTtlMs) {
      console.log('[AltScanner] Returning cached result');
      return this.lastScan;
    }

    console.log(`[AltScanner] Starting scan of ${this.config.universe.length} assets...`);

    // PHASE 1: Fetch market data
    const dataStart = Date.now();
    const marketDataResults = await this.fetchAllMarketData();
    const dataFetchMs = Date.now() - dataStart;
    console.log(`[AltScanner] Data fetch: ${dataFetchMs}ms (${marketDataResults.length} assets)`);

    // PHASE 2: Build indicator vectors
    const indicatorStart = Date.now();
    const vectorResult = await indicatorEngine.buildBatch(
      marketDataResults.map(d => ({
        symbol: d.symbol,
        venue: this.config.venue,
        candles: d.candles,
        derivatives: d.derivatives,
      })),
      this.config.timeframe
    );
    const indicatorMs = Date.now() - indicatorStart;
    console.log(`[AltScanner] Indicators: ${indicatorMs}ms (${vectorResult.stats.success} success)`);

    // PHASE 3: Cluster vectors
    const clusterStart = Date.now();
    const vectors = Array.from(vectorResult.vectors.values());
    const clusteringResult = patternClusteringService.cluster(
      vectors,
      this.config.venue,
      this.config.timeframe
    );
    const clusteringMs = Date.now() - clusterStart;
    console.log(`[AltScanner] Clustering: ${clusteringMs}ms (${clusteringResult.stats.clusterCount} clusters)`);

    // PHASE 4: Rank opportunities
    const rankingStart = Date.now();
    const rankingResult = opportunityRankingService.rank({
      vectors: vectorResult.vectors,
      clusters: clusteringResult.clusters,
      memberships: clusteringResult.memberships,
    });
    const rankingMs = Date.now() - rankingStart;
    console.log(`[AltScanner] Ranking: ${rankingMs}ms (${rankingResult.stats.totalOpportunities} opportunities)`);

    // Build radar response
    const radar = this.buildRadarResponse(
      vectorResult.vectors,
      clusteringResult,
      rankingResult
    );

    const totalMs = Date.now() - startTime;

    const result: ScanResult = {
      radar,
      clustering: clusteringResult,
      ranking: rankingResult,
      performance: {
        dataFetchMs,
        indicatorMs,
        clusteringMs,
        rankingMs,
        totalMs,
      },
    };

    // Cache result
    this.lastScan = result;
    this.lastScanTime = Date.now();

    console.log(`[AltScanner] Scan complete in ${totalMs}ms`);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════════════════════════════════

  private async fetchAllMarketData(): Promise<Array<{
    symbol: string;
    candles: Awaited<ReturnType<IMarketDataPort['getOHLCV']>>;
    derivatives?: Awaited<ReturnType<IMarketDataPort['getDerivativesSnapshot']>>;
  }>> {
    const results: Array<{
      symbol: string;
      candles: Awaited<ReturnType<IMarketDataPort['getOHLCV']>>;
      derivatives?: Awaited<ReturnType<IMarketDataPort['getDerivativesSnapshot']>>;
    }> = [];

    // Fetch in parallel batches
    for (let i = 0; i < this.config.universe.length; i += this.config.parallel) {
      const batch = this.config.universe.slice(i, i + this.config.parallel);

      const batchPromises = batch.map(async (symbol) => {
        try {
          const [candles, derivatives] = await Promise.all([
            this.marketData.getOHLCV({
              symbol,
              timeframe: this.config.timeframe,
              limit: this.config.candleLimit,
            }),
            this.marketData.getDerivativesSnapshot({ symbol }),
          ]);

          return { symbol, candles, derivatives };
        } catch (error: any) {
          console.warn(`[AltScanner] Failed to fetch ${symbol}:`, error.message);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD RADAR RESPONSE
  // ═══════════════════════════════════════════════════════════════

  private buildRadarResponse(
    vectors: Map<string, IndicatorVector>,
    clustering: ClusteringResult,
    ranking: RankingResult
  ): AltRadarResponse {
    // Determine market context from BTC/ETH if available
    const btcVector = vectors.get('BTCUSDT');
    const marketContext = btcVector ? {
      btcBias: this.inferBtcBias(btcVector),
      overallSentiment: this.calculateOverallSentiment(vectors),
      dominantFacet: this.findDominantFacet(ranking.opportunities),
    } : undefined;

    // Find hot clusters (those with recent good performance)
    const hotClusters = clustering.clusters
      .filter(c => c.size >= 3)
      .slice(0, 5);

    return {
      ok: true,
      asOf: Date.now(),
      venue: this.config.venue,
      universeSize: vectors.size,
      topLongs: ranking.topLongs,
      topShorts: ranking.topShorts,
      topMeanReversion: ranking.topMeanReversion,
      clusters: clustering.clusters,
      hotClusters,
      marketContext,
    };
  }

  private inferBtcBias(btcVector: IndicatorVector): Direction {
    const trend = btcVector.trend_score ?? 0;
    if (trend > 0.3) return 'UP';
    if (trend < -0.3) return 'DOWN';
    return 'FLAT';
  }

  private calculateOverallSentiment(vectors: Map<string, IndicatorVector>): number {
    let sum = 0;
    let count = 0;
    
    for (const vector of vectors.values()) {
      sum += vector.trend_score ?? 0;
      count++;
    }
    
    return count > 0 ? sum / count : 0;
  }

  private findDominantFacet(opportunities: AltOpportunity[]): AltFacet {
    const facetCounts = new Map<AltFacet, number>();
    
    for (const opp of opportunities) {
      facetCounts.set(opp.facet, (facetCounts.get(opp.facet) ?? 0) + 1);
    }
    
    let dominant: AltFacet = 'MOMENTUM';
    let maxCount = 0;
    
    for (const [facet, count] of facetCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = facet;
      }
    }
    
    return dominant;
  }

  // ═══════════════════════════════════════════════════════════════
  // CLUSTER DETAIL
  // ═══════════════════════════════════════════════════════════════

  async getClusterDetail(clusterId: string): Promise<AltClusterDetailResponse | null> {
    const scan = this.lastScan ?? await this.scan();
    
    const cluster = scan.clustering.clusters.find(c => c.clusterId === clusterId);
    if (!cluster) return null;

    const memberships = scan.clustering.memberships.filter(m => m.clusterId === clusterId);
    
    const members = memberships.map(m => {
      const opportunity = scan.ranking.opportunities.find(o => o.symbol === m.symbol);
      const vector = scan.ranking.opportunities.find(o => o.symbol === m.symbol)?.vector;
      
      return {
        symbol: m.symbol,
        similarity: m.similarity,
        currentReturn: vector?.momentum_24h ?? 0,
        opportunity: opportunity ?? null,
      };
    });

    return {
      ok: true,
      cluster,
      members,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  setMarketDataPort(port: IMarketDataPort): void {
    this.marketData = port;
    this.lastScan = null; // Clear cache
  }

  updateConfig(config: Partial<ScannerConfig>): void {
    this.config = { ...this.config, ...config };
    this.lastScan = null; // Clear cache
  }

  getConfig(): ScannerConfig {
    return { ...this.config };
  }

  getLastScanTime(): number {
    return this.lastScanTime;
  }

  clearCache(): void {
    this.lastScan = null;
    this.lastScanTime = 0;
  }
}

// Singleton instance
export const altScannerService = new AltScannerService();

console.log('[ExchangeAlt] Alt Scanner Service loaded');
