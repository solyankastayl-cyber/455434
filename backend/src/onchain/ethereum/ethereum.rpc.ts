/**
 * Ethereum RPC Client with Load Balancing
 * Communicates with Ethereum node via JSON-RPC (Infura + Ankr)
 */

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: RpcError;
}

export interface EthBlock {
  number: string;
  hash: string;
  timestamp: string;
  transactions: string[];
}

export interface EthLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
}

export interface GetLogsParams {
  fromBlock: string;
  toBlock: string;
  address?: string | string[];
  topics?: (string | string[] | null)[];
}

/**
 * Ethereum RPC Client Class with Load Balancing
 */
export class EthereumRpc {
  private requestId = 0;
  private urls: string[];
  private currentIndex = 0;
  private failureCounts: Map<string, number> = new Map();

  constructor(primaryUrl: string, secondaryUrl?: string) {
    if (!primaryUrl) {
      throw new Error('RPC URL is required');
    }
    this.urls = [primaryUrl];
    if (secondaryUrl) {
      this.urls.push(secondaryUrl);
    }
    console.log(`[RPC] Initialized with ${this.urls.length} provider(s)`);
  }

  /**
   * Get next URL (round-robin with failure tracking)
   */
  private getNextUrl(): string {
    // Skip URLs with too many failures
    let attempts = 0;
    while (attempts < this.urls.length) {
      const url = this.urls[this.currentIndex];
      const failures = this.failureCounts.get(url) || 0;
      
      this.currentIndex = (this.currentIndex + 1) % this.urls.length;
      
      // Allow URL if failures < 3 or all URLs have failures
      if (failures < 3) {
        return url;
      }
      attempts++;
    }
    
    // Reset failure counts and return first URL
    this.failureCounts.clear();
    return this.urls[0];
  }

  /**
   * Record failure for URL
   */
  private recordFailure(url: string): void {
    const current = this.failureCounts.get(url) || 0;
    this.failureCounts.set(url, current + 1);
  }

  /**
   * Record success for URL (reset failures)
   */
  private recordSuccess(url: string): void {
    this.failureCounts.set(url, 0);
  }

  /**
   * Make JSON-RPC call with retry logic and load balancing
   */
  async call<T>(method: string, params: unknown[], retries = 3): Promise<T> {
    this.requestId++;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      const url = this.getNextUrl();
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: this.requestId,
            method,
            params,
          }),
        });

        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
          this.recordFailure(url);
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`[RPC] Rate limited on ${url.substring(0, 30)}..., waiting ${waitTime}ms`);
          await this.sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          this.recordFailure(url);
          throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
        }

        const json = (await response.json()) as RpcResponse<T>;

        if (json.error) {
          // Check if it's a retriable error
          if (json.error.code === -32602 || json.error.message.includes('max results')) {
            throw new Error(`RPC error: ${json.error.message} (code: ${json.error.code})`);
          }
          this.recordFailure(url);
          throw new Error(`RPC error: ${json.error.message} (code: ${json.error.code})`);
        }

        this.recordSuccess(url);
        return json.result as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.recordFailure(url);
        
        // Retry on network errors
        if (attempt < retries - 1) {
          const waitTime = Math.pow(2, attempt) * 500;
          await this.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error('RPC call failed after retries');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const hex = await this.call<string>('eth_blockNumber', []);
    return parseInt(hex, 16);
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number, includeTransactions = false): Promise<EthBlock | null> {
    const hex = '0x' + blockNumber.toString(16);
    return this.call<EthBlock | null>('eth_getBlockByNumber', [hex, includeTransactions]);
  }

  /**
   * Get logs (events) with filter
   */
  async getLogs(params: GetLogsParams): Promise<EthLog[]> {
    return this.call<EthLog[]>('eth_getLogs', [params]);
  }

  /**
   * Get block timestamp
   */
  async getBlockTimestamp(blockNumber: number): Promise<Date> {
    const block = await this.getBlock(blockNumber);
    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }
    const timestamp = parseInt(block.timestamp, 16);
    return new Date(timestamp * 1000);
  }

  /**
   * Helper: Convert number to hex
   */
  static toHex(num: number): string {
    return '0x' + num.toString(16);
  }

  /**
   * Helper: Convert hex to number
   */
  static fromHex(hex: string): number {
    return parseInt(hex, 16);
  }
}
