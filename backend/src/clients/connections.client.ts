/**
 * Connections Module HTTP Client
 * 
 * ═══════════════════════════════════════════════════════════════
 * ARCHITECTURE: LAYER 2 ISOLATION
 * ═══════════════════════════════════════════════════════════════
 * 
 * Connections Module is a STANDALONE service (port 8003).
 * This client provides HTTP-only access to Connections API.
 * 
 * RULES:
 * 1. NO direct imports from Connections module
 * 2. NO shared state
 * 3. Read-only enrichment (display-only badges)
 * 4. Forecast pipeline MUST NOT depend on this
 * 
 * If Connections service is down, Forecast continues working.
 * 
 * @example
 * const client = new ConnectionsClient();
 * const reality = await client.getRealityScore('BTC');
 * // { score: 0.78, sample: 156, confidence: 'high' }
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// ============================================
// TYPES
// ============================================

export interface RealityScoreResponse {
  ok: boolean;
  symbol: string;
  realityScore: number;
  sample: number;
  confidence: 'low' | 'medium' | 'high';
  verdictMix?: {
    true: number;
    fake: number;
    neutral: number;
  };
  lastEvent?: string;
  error?: string;
}

export interface InfluenceScoreResponse {
  ok: boolean;
  symbol: string;
  influenceScore: number;
  topInfluencers?: Array<{
    handle: string;
    score: number;
    followers: number;
  }>;
  clusterCount?: number;
  error?: string;
}

export interface ClusterAttentionResponse {
  ok: boolean;
  clusters: Array<{
    id: string;
    symbol: string;
    memberCount: number;
    momentum: number;
    direction: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
  }>;
  error?: string;
}

export interface BackersResponse {
  ok: boolean;
  backers: Array<{
    slug: string;
    name: string;
    type: 'vc' | 'foundation' | 'angel';
    portfolio: string[];
    totalInvestments: number;
    successRate?: number;
  }>;
  error?: string;
}

export interface ConnectionsHealthResponse {
  ok: boolean;
  service: string;
  version: string;
  uptime?: number;
  error?: string;
}

// ============================================
// CLIENT CONFIGURATION
// ============================================

interface ConnectionsClientConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
}

const DEFAULT_CONFIG: ConnectionsClientConfig = {
  baseUrl: process.env.CONNECTIONS_BASE_URL || 'http://localhost:8004',
  timeout: 5000,
  retries: 1,
};

// ============================================
// CONNECTIONS CLIENT
// ============================================

export class ConnectionsClient {
  private client: AxiosInstance;
  private config: ConnectionsClientConfig;
  private isAvailable: boolean = true;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 60000; // 1 minute

  constructor(config: Partial<ConnectionsClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'verdict-engine',
      },
    });
    
    console.log(`[ConnectionsClient] Initialized with baseUrl: ${this.config.baseUrl}`);
  }

  // ============================================
  // HEALTH CHECK
  // ============================================

  /**
   * Check if Connections service is available
   * Caches result for healthCheckInterval
   */
  async isHealthy(): Promise<boolean> {
    const now = Date.now();
    
    // Use cached result if recent
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isAvailable;
    }
    
    try {
      const response = await this.client.get<ConnectionsHealthResponse>('/api/connections/health');
      this.isAvailable = response.data?.ok === true;
      this.lastHealthCheck = now;
      return this.isAvailable;
    } catch (error) {
      this.isAvailable = false;
      this.lastHealthCheck = now;
      console.warn('[ConnectionsClient] Health check failed:', (error as Error).message);
      return false;
    }
  }

  /**
   * Get full health status
   */
  async getHealth(): Promise<ConnectionsHealthResponse> {
    try {
      const response = await this.client.get<ConnectionsHealthResponse>('/api/connections/health');
      return response.data;
    } catch (error) {
      return {
        ok: false,
        service: 'connections',
        version: 'unknown',
        error: (error as Error).message,
      };
    }
  }

  // ============================================
  // REALITY SCORE API
  // ============================================

  /**
   * Get Reality Score for a symbol
   * Reality Score = verified prediction accuracy of influencers
   * 
   * @param symbol Token symbol (e.g., 'BTC', 'ETH')
   * @returns Reality score data or null if unavailable
   */
  async getRealityScore(symbol: string): Promise<RealityScoreResponse | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get<RealityScoreResponse>(
        `/api/connections/reality/score`,
        { params: { symbol: symbol.toUpperCase() } }
      );
      return response.data;
    } catch (error) {
      this.handleError('getRealityScore', error);
      return null;
    }
  }

  /**
   * Get Reality Leaderboard
   * Top influencers ranked by prediction accuracy
   */
  async getRealityLeaderboard(limit: number = 20): Promise<any | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get(
        `/api/connections/reality/leaderboard`,
        { params: { limit } }
      );
      return response.data;
    } catch (error) {
      this.handleError('getRealityLeaderboard', error);
      return null;
    }
  }

  // ============================================
  // INFLUENCE SCORE API
  // ============================================

  /**
   * Get Influence Score for a symbol
   * Influence Score = aggregated social influence on token
   * 
   * @param symbol Token symbol
   * @returns Influence data or null if unavailable
   */
  async getInfluenceScore(symbol: string): Promise<InfluenceScoreResponse | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get<InfluenceScoreResponse>(
        `/api/connections/influence`,
        { params: { symbol: symbol.toUpperCase() } }
      );
      return response.data;
    } catch (error) {
      this.handleError('getInfluenceScore', error);
      return null;
    }
  }

  // ============================================
  // CLUSTER ATTENTION API
  // ============================================

  /**
   * Get active cluster attention data
   * Clusters = coordinated influencer groups
   */
  async getClusters(symbol?: string): Promise<ClusterAttentionResponse | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get<ClusterAttentionResponse>(
        `/api/connections/clusters`,
        { params: symbol ? { symbol: symbol.toUpperCase() } : {} }
      );
      return response.data;
    } catch (error) {
      this.handleError('getClusters', error);
      return null;
    }
  }

  // ============================================
  // BACKERS API
  // ============================================

  /**
   * Get VC/Foundation backers data
   */
  async getBackers(symbol?: string): Promise<BackersResponse | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get<BackersResponse>(
        `/api/connections/backers`,
        { params: symbol ? { symbol: symbol.toUpperCase() } : {} }
      );
      return response.data;
    } catch (error) {
      this.handleError('getBackers', error);
      return null;
    }
  }

  /**
   * Get single backer details
   */
  async getBacker(slug: string): Promise<any | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get(`/api/connections/backers/${slug}`);
      return response.data;
    } catch (error) {
      this.handleError('getBacker', error);
      return null;
    }
  }

  // ============================================
  // UNIFIED ACCOUNTS API
  // ============================================

  /**
   * Get unified influencer accounts
   */
  async getInfluencers(options: { limit?: number; sortBy?: string } = {}): Promise<any | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get(
        `/api/connections/unified`,
        { params: options }
      );
      return response.data;
    } catch (error) {
      this.handleError('getInfluencers', error);
      return null;
    }
  }

  // ============================================
  // GRAPH API
  // ============================================

  /**
   * Get network graph data
   */
  async getGraph(symbol?: string): Promise<any | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get(
        `/api/connections/graph/v2`,
        { params: symbol ? { symbol: symbol.toUpperCase() } : {} }
      );
      return response.data;
    } catch (error) {
      this.handleError('getGraph', error);
      return null;
    }
  }

  // ============================================
  // ALT SEASON API
  // ============================================

  /**
   * Get alt season monitor data
   */
  async getAltSeason(): Promise<any | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get(`/api/connections/alt-season`);
      return response.data;
    } catch (error) {
      this.handleError('getAltSeason', error);
      return null;
    }
  }

  // ============================================
  // LIFECYCLE API
  // ============================================

  /**
   * Get asset lifecycle data
   */
  async getLifecycle(symbol?: string): Promise<any | null> {
    if (!await this.isHealthy()) {
      return null;
    }
    
    try {
      const response = await this.client.get(
        `/api/connections/lifecycle`,
        { params: symbol ? { symbol: symbol.toUpperCase() } : {} }
      );
      return response.data;
    } catch (error) {
      this.handleError('getLifecycle', error);
      return null;
    }
  }

  // ============================================
  // TWEET INGESTION API (for Parser Integration)
  // ============================================

  /**
   * Ingest a parsed tweet into Connections service for author profile analysis
   * This builds AuthorProfiles from tweet data.
   * 
   * @param tweet Parsed tweet data from twitter-parser-v2
   * @returns Updated author profile or null on error
   */
  async ingestTweet(tweet: {
    id: string;
    text: string;
    author: {
      id: string;
      username: string;
      name: string;
      avatar?: string;
      verified?: boolean;
      followers: number;
    };
    likes?: number;
    reposts?: number;
    replies?: number;
    views?: number;
    createdAt?: string;
  }): Promise<any | null> {
    // Don't block on health check for ingestion
    try {
      const response = await this.client.post(
        '/api/connections/test/ingest',
        {
          tweet_id: tweet.id,
          text: tweet.text,
          author: {
            author_id: tweet.author.id,
            username: tweet.author.username,
            avatar_url: tweet.author.avatar || '',
            followers_count: tweet.author.followers || 0,
            following_count: 0,
          },
          engagement: {
            likes: tweet.likes || 0,
            reposts: tweet.reposts || 0,
            replies: tweet.replies || 0,
          },
          views: tweet.views || 0,
          created_at: tweet.createdAt,
        }
      );
      return response.data;
    } catch (error) {
      this.handleError('ingestTweet', error);
      return null;
    }
  }

  /**
   * Batch ingest tweets for efficiency
   * Processes tweets in parallel with limited concurrency
   * 
   * @param tweets Array of parsed tweets
   * @returns Array of results (null for failed ingestions)
   */
  async ingestTweetsBatch(tweets: Array<{
    id: string;
    text: string;
    author: {
      id: string;
      username: string;
      name: string;
      avatar?: string;
      verified?: boolean;
      followers: number;
    };
    likes?: number;
    reposts?: number;
    replies?: number;
    views?: number;
    createdAt?: string;
  }>): Promise<number> {
    if (tweets.length === 0) return 0;
    
    // Check if service is available before batch
    if (!await this.isHealthy()) {
      console.warn('[ConnectionsClient] Service unavailable, skipping batch ingestion');
      return 0;
    }
    
    let successCount = 0;
    const BATCH_SIZE = 5; // Process 5 at a time
    
    for (let i = 0; i < tweets.length; i += BATCH_SIZE) {
      const batch = tweets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(tweet => this.ingestTweet(tweet))
      );
      
      successCount += results.filter(r => r.status === 'fulfilled' && r.value).length;
    }
    
    console.log(`[ConnectionsClient] Batch ingested ${successCount}/${tweets.length} tweets`);
    return successCount;
  }

  // ============================================
  // ERROR HANDLING
  // ============================================

  private handleError(method: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNREFUSED') {
        console.warn(`[ConnectionsClient] ${method}: Service unavailable`);
        this.isAvailable = false;
      } else if (axiosError.response?.status === 503) {
        console.warn(`[ConnectionsClient] ${method}: Service temporarily unavailable`);
      } else {
        console.error(`[ConnectionsClient] ${method}: ${axiosError.message}`);
      }
    } else {
      console.error(`[ConnectionsClient] ${method}: Unknown error`, error);
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let clientInstance: ConnectionsClient | null = null;

/**
 * Get singleton ConnectionsClient instance
 */
export function getConnectionsClient(): ConnectionsClient {
  if (!clientInstance) {
    clientInstance = new ConnectionsClient();
  }
  return clientInstance;
}

/**
 * Reset client instance (for testing)
 */
export function resetConnectionsClient(): void {
  clientInstance = null;
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Quick check if Connections service is available
 */
export async function isConnectionsAvailable(): Promise<boolean> {
  return getConnectionsClient().isHealthy();
}

/**
 * Get Reality Score (convenience wrapper)
 */
export async function getRealityScore(symbol: string): Promise<RealityScoreResponse | null> {
  return getConnectionsClient().getRealityScore(symbol);
}

/**
 * Get Influence Score (convenience wrapper)
 */
export async function getInfluenceScore(symbol: string): Promise<InfluenceScoreResponse | null> {
  return getConnectionsClient().getInfluenceScore(symbol);
}
