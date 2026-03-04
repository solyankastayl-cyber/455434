/**
 * PHASE 1 — HTTP Client Factory
 * ===============================
 * 
 * Creates axios clients with proper proxy configuration.
 * All exchange providers MUST use this factory.
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getNetworkConfig, getActiveProxyUrl } from './network.config.service.js';

// ═══════════════════════════════════════════════════════════════
// PROXY PARSING
// ═══════════════════════════════════════════════════════════════

interface ParsedProxy {
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
}

function parseProxyUrl(url: string): ParsedProxy | null {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 80,
      auth: parsed.username ? {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password || ''),
      } : undefined,
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HTTP CLIENT FACTORY
// ═══════════════════════════════════════════════════════════════

export interface HttpClientOptions {
  baseURL?: string;
  timeout?: number;
  provider?: 'binance' | 'bybit' | 'default';
}

/**
 * Create HTTP client with current network config
 */
export async function createHttpClient(options: HttpClientOptions = {}): Promise<AxiosInstance> {
  const config = await getNetworkConfig();
  const proxyUrl = await getActiveProxyUrl();
  
  // Determine timeout
  let timeout = options.timeout || config.defaultTimeoutMs;
  if (options.provider === 'binance') timeout = config.binanceTimeoutMs;
  if (options.provider === 'bybit') timeout = config.bybitTimeoutMs;
  
  const axiosConfig: AxiosRequestConfig = {
    baseURL: options.baseURL,
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
    },
  };
  
  // Configure proxy
  if (proxyUrl) {
    const agent = new HttpsProxyAgent(proxyUrl);
    axiosConfig.httpsAgent = agent;
    axiosConfig.httpAgent = agent;
    
    // For axios proxy config (some cases)
    const parsed = parseProxyUrl(proxyUrl);
    if (parsed) {
      axiosConfig.proxy = false; // Disable axios proxy, use agent instead
    }
  }
  
  const client = axios.create(axiosConfig);
  
  // Add retry interceptor
  client.interceptors.response.use(
    response => response,
    async error => {
      const originalRequest = error.config;
      
      // Don't retry if already retried
      if (originalRequest._retryCount >= config.retry.attempts) {
        throw error;
      }
      
      originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
      
      // Calculate backoff
      const backoff = Math.min(
        config.retry.backoffMs * Math.pow(2, originalRequest._retryCount - 1),
        config.retry.maxBackoffMs
      );
      
      await new Promise(resolve => setTimeout(resolve, backoff));
      
      return client(originalRequest);
    }
  );
  
  return client;
}

/**
 * Create client for specific provider
 */
export async function createBinanceClient(): Promise<AxiosInstance> {
  return createHttpClient({
    baseURL: 'https://fapi.binance.com',
    provider: 'binance',
  });
}

export async function createBybitClient(): Promise<AxiosInstance> {
  return createHttpClient({
    baseURL: 'https://api.bybit.com',
    provider: 'bybit',
  });
}

console.log('[Phase 1] HTTP Client Factory loaded');
