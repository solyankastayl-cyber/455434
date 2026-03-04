/**
 * Base EVM Adapter (P2.3.1.A)
 * 
 * Universal template for EVM-compatible chains
 * Handles ERC20 Transfer events
 */

import axios from 'axios';
import type {
  ChainConfig,
  RawChainEvent,
  IChainAdapter,
  AdapterOptions
} from './types.js';
import type { UnifiedChainEvent } from '../../cross_chain/storage/unified_events.model.js';

// ERC20 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ============================================
// Base EVM Adapter
// ============================================

export abstract class EVMBaseAdapter implements IChainAdapter {
  protected config: ChainConfig;
  protected rpcUrl: string;
  protected rpcFallbacks: string[];
  protected options: AdapterOptions;
  
  constructor(config: ChainConfig, options: AdapterOptions = {}) {
    this.config = config;
    this.rpcUrl = options.rpcUrl || config.rpcUrls[0];
    this.rpcFallbacks = options.rpcFallbacks || config.rpcUrls.slice(1);
    this.options = {
      batchSize: options.batchSize || 1000,
      retries: options.retries || 3,
      timeout: options.timeout || 30000
    };
  }
  
  getConfig(): ChainConfig {
    return this.config;
  }
  
  /**
   * Make RPC call with fallback support
   */
  protected async rpcCall(method: string, params: any[]): Promise<any> {
    const urls = [this.rpcUrl, ...this.rpcFallbacks];
    let lastError: Error | null = null;
    
    for (const url of urls) {
      try {
        const response = await axios.post(
          url,
          {
            jsonrpc: '2.0',
            id: 1,
            method,
            params
          },
          {
            timeout: this.options.timeout,
            headers: { 'Content-Type': 'application/json' }
          }
        );
        
        if (response.data.error) {
          throw new Error(response.data.error.message);
        }
        
        return response.data.result;
        
      } catch (error: any) {
        console.error(`[${this.config.name}] RPC call failed on ${url}:`, error.message);
        lastError = error;
        continue;
      }
    }
    
    throw lastError || new Error('All RPC endpoints failed');
  }
  
  /**
   * Get latest block number
   */
  async getLatestBlockNumber(): Promise<number> {
    const blockNum = await this.rpcCall('eth_blockNumber', []);
    return parseInt(blockNum, 16);
  }
  
  /**
   * Get block by number
   */
  async getBlock(blockNumber: number): Promise<any> {
    const blockHex = '0x' + blockNumber.toString(16);
    return this.rpcCall('eth_getBlockByNumber', [blockHex, false]);
  }
  
  /**
   * Get block timestamp
   */
  async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.getBlock(blockNumber);
    return parseInt(block.timestamp, 16);
  }
  
  /**
   * Fetch ERC20 Transfer logs from block range
   */
  async fetchEvents(startBlock: number, endBlock: number): Promise<RawChainEvent[]> {
    const startBlockHex = '0x' + startBlock.toString(16);
    const endBlockHex = '0x' + endBlock.toString(16);
    
    try {
      const logs = await this.rpcCall('eth_getLogs', [{
        fromBlock: startBlockHex,
        toBlock: endBlockHex,
        topics: [TRANSFER_EVENT_SIGNATURE]
      }]);
      
      if (!logs || logs.length === 0) {
        return [];
      }
      
      // Get unique block numbers for timestamps
      const blockNumbers = [...new Set(logs.map((log: any) => parseInt(log.blockNumber, 16)))];
      const blockTimestamps = new Map<number, number>();
      
      // Fetch block timestamps in parallel
      await Promise.all(
        blockNumbers.map(async (blockNum) => {
          try {
            const timestamp = await this.getBlockTimestamp(blockNum);
            blockTimestamps.set(blockNum, timestamp);
          } catch (error) {
            console.error(`[${this.config.name}] Failed to get timestamp for block ${blockNum}`);
          }
        })
      );
      
      // Parse logs into raw events
      const rawEvents: RawChainEvent[] = [];
      
      for (const log of logs) {
        try {
          const blockNum = parseInt(log.blockNumber, 16);
          const timestamp = blockTimestamps.get(blockNum) || Math.floor(Date.now() / 1000);
          
          // Parse ERC20 Transfer event
          // topics[0] = event signature
          // topics[1] = from address
          // topics[2] = to address
          // data = amount
          
          if (log.topics.length < 3) continue;
          
          const from = '0x' + log.topics[1].slice(26); // Remove padding
          const to = '0x' + log.topics[2].slice(26);
          const value = log.data || '0x0';
          
          rawEvents.push({
            txHash: log.transactionHash,
            blockNumber: blockNum,
            timestamp,
            from,
            to,
            tokenAddress: log.address,
            value,
            logIndex: parseInt(log.logIndex, 16),
            transactionIndex: parseInt(log.transactionIndex, 16)
          });
          
        } catch (error) {
          console.error(`[${this.config.name}] Failed to parse log:`, error);
          continue;
        }
      }
      
      return rawEvents;
      
    } catch (error: any) {
      console.error(`[${this.config.name}] Error fetching events:`, error.message);
      return [];
    }
  }
  
  /**
   * Normalize raw events to unified format
   */
  normalizeEvents(rawEvents: RawChainEvent[]): Omit<UnifiedChainEvent, 'eventId' | 'createdAt'>[] {
    return rawEvents.map(event => ({
      chain: this.config.name,
      chainId: this.config.chainId,
      
      txHash: event.txHash.toLowerCase(),
      blockNumber: event.blockNumber,
      timestamp: event.timestamp,
      
      from: event.from.toLowerCase(),
      to: event.to.toLowerCase(),
      
      tokenAddress: event.tokenAddress?.toLowerCase(),
      tokenSymbol: event.tokenSymbol,
      
      amount: event.value,
      amountUsd: event.valueUsd,
      
      eventType: 'TRANSFER',
      ingestionSource: 'rpc'
    }));
  }
  
  /**
   * Fetch and normalize events in one call
   */
  async fetchAndNormalize(
    startBlock: number,
    endBlock: number
  ): Promise<Omit<UnifiedChainEvent, 'eventId' | 'createdAt'>[]> {
    const rawEvents = await this.fetchEvents(startBlock, endBlock);
    return this.normalizeEvents(rawEvents);
  }
}
