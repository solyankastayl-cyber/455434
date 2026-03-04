// B3.1 - Mock Twitter Runtime
// Development engine - allows full system development without real Twitter

import {
  TwitterRuntime,
  TwitterTweet,
  TwitterAccount,
  SearchParams,
} from '../runtime.interface.js';
import { RuntimeResponse, RuntimeStatus } from '../runtime.types.js';

// Sample keywords for realistic mock data
const CRYPTO_KEYWORDS = [
  'BTC', 'ETH', 'SOL', 'DOGE', 'PEPE', 'WIF', 'BONK',
  'DeFi', 'NFT', 'airdrop', 'pump', 'moon', 'whale',
  'bullish', 'bearish', 'hodl', 'degen', 'alpha',
];

const SAMPLE_USERNAMES = [
  'CryptoWhale', 'DeFi_Degen', 'NFT_Hunter', 'SolanaNews',
  'ETH_Maxi', 'AlphaLeaks', 'MemeCoiner', 'OnChainWiz',
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMockTweet(keyword: string, index: number): TwitterTweet {
  const baseTime = Date.now() - index * 60000; // 1 min apart
  const hashtags = Array.from({ length: Math.floor(Math.random() * 3) + 1 })
    .map(() => `#${randomPick(CRYPTO_KEYWORDS)}`);

  return {
    id: `mock-${keyword.replace(/\s+/g, '-')}-${baseTime}-${index}`,
    text: `${randomPick([
      `🚀 Just saw major movement on $${keyword}!`,
      `Breaking: ${keyword} showing bullish signals`,
      `${keyword} analysis thread 🧵`,
      `Why ${keyword} might be the next big thing`,
      `$${keyword} whale alert 🐋`,
      `Don't sleep on ${keyword}`,
      `${keyword} to the moon? Let's analyze`,
    ])} ${hashtags.join(' ')}`,
    createdAt: baseTime,
    likes: Math.floor(Math.random() * 5000),
    reposts: Math.floor(Math.random() * 2000),
    replies: Math.floor(Math.random() * 500),
    views: Math.floor(Math.random() * 50000),
    author: {
      username: randomPick(SAMPLE_USERNAMES),
      displayName: randomPick(SAMPLE_USERNAMES).replace('_', ' '),
      verified: Math.random() > 0.7,
    },
  };
}

function generateMockAccount(username: string): TwitterAccount {
  return {
    username,
    displayName: username.replace(/_/g, ' '),
    bio: `${randomPick(['🚀', '📈', '💎', '🐋'])} Crypto enthusiast | ${randomPick(['DeFi', 'NFT', 'Trading'])} | NFA/DYOR`,
    followers: Math.floor(Math.random() * 500000) + 1000,
    following: Math.floor(Math.random() * 5000) + 100,
    verified: Math.random() > 0.6,
    avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${username}`,
  };
}

// P3 FREEZE - Fault Injection Config
export interface MockFaultConfig {
  rateLimit429: number;      // 0-1 probability
  timeout: number;           // 0-1 probability
  serverError: number;       // 0-1 probability
  randomLatencyMs: [number, number]; // [min, max]
}

const DEFAULT_FAULT_CONFIG: MockFaultConfig = {
  rateLimit429: 0.02,
  timeout: 0.01,
  serverError: 0.01,
  randomLatencyMs: [50, 500],
};

export class MockTwitterRuntime implements TwitterRuntime {
  readonly sourceType = 'MOCK';
  
  // P3 FREEZE - Configurable fault injection
  private faultConfig: MockFaultConfig = { ...DEFAULT_FAULT_CONFIG };

  // Set fault injection config (for SMOKE/STRESS tests)
  setFaultConfig(config: Partial<MockFaultConfig>): void {
    this.faultConfig = { ...this.faultConfig, ...config };
  }

  // Reset to defaults
  resetFaultConfig(): void {
    this.faultConfig = { ...DEFAULT_FAULT_CONFIG };
  }

  // Get current config
  getFaultConfig(): MockFaultConfig {
    return { ...this.faultConfig };
  }

  async getHealth(): Promise<RuntimeStatus> {
    // Mock is always healthy
    return 'OK';
  }

  private async simulateLatency(): Promise<void> {
    const [min, max] = this.faultConfig.randomLatencyMs;
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private checkFaults(): { shouldFail: boolean; error?: RuntimeResponse<any> } {
    // Check rate limit
    if (Math.random() < this.faultConfig.rateLimit429) {
      return {
        shouldFail: true,
        error: {
          ok: false,
          status: 'RATE_LIMITED',
          error: 'Mock rate limit for testing (429)',
        },
      };
    }

    // Check timeout
    if (Math.random() < this.faultConfig.timeout) {
      return {
        shouldFail: true,
        error: {
          ok: false,
          status: 'ERROR',
          error: 'Mock timeout for testing (ECONNABORTED)',
        },
      };
    }

    // Check server error
    if (Math.random() < this.faultConfig.serverError) {
      return {
        shouldFail: true,
        error: {
          ok: false,
          status: 'ERROR',
          error: 'Mock server error for testing (500)',
        },
      };
    }

    return { shouldFail: false };
  }

  async fetchTweetsByKeyword(
    params: SearchParams
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const { keyword, limit = 20 } = params;
    
    // Simulate latency
    await this.simulateLatency();
    
    // Check for faults
    const fault = this.checkFaults();
    if (fault.shouldFail) {
      return fault.error!;
    }

    // Generate mock tweets
    const tweets: TwitterTweet[] = Array.from({ length: limit }, (_, i) =>
      generateMockTweet(keyword, i)
    );

    return {
      ok: true,
      status: 'OK',
      data: tweets,
      meta: {
        source: 'MOCK',
        slotId: 'mock-slot',
        accountId: 'mock-account',
        duration: Math.floor(Math.random() * 200) + 50,
      },
    };
  }

  async fetchAccountSummary(
    username: string
  ): Promise<RuntimeResponse<TwitterAccount>> {
    // Simulate latency
    await this.simulateLatency();
    
    // Check for faults
    const fault = this.checkFaults();
    if (fault.shouldFail) {
      return fault.error!;
    }

    return {
      ok: true,
      status: 'OK',
      data: generateMockAccount(username),
      meta: {
        source: 'MOCK',
        slotId: 'mock-slot',
        accountId: 'mock-account',
        duration: Math.floor(Math.random() * 100) + 30,
      },
    };
  }

  async fetchAccountTweets(
    username: string,
    limit: number = 20
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    // Reuse keyword search with username as keyword
    const result = await this.fetchTweetsByKeyword({
      keyword: `@${username}`,
      limit,
    });

    // Override author to match requested username
    if (result.ok && result.data) {
      result.data = result.data.map((tweet) => ({
        ...tweet,
        author: {
          ...tweet.author,
          username,
        },
      }));
    }

    return result;
  }
}

// Singleton for easy access
export const mockRuntime = new MockTwitterRuntime();
