/**
 * БЛОК 1.3 — Funding Service
 * ===========================
 * Объединяет адаптеры, нормализацию и классификацию
 */

import type { Db } from 'mongodb';
import type { FundingVenue, FundingReadResult } from './contracts/funding.types.js';
import type { NormalizedFunding } from './contracts/funding.normalized.js';
import type { FundingContext } from './contracts/funding.context.js';
import { FundingRegistry } from './funding.registry.js';
import { FundingNormalizer } from './funding.normalizer.js';
import { FundingContextClassifier } from './funding.context.classifier.js';
import { FundingStore } from './funding.store.js';
import { binanceFundingAdapter } from './adapters/binance.funding.adapter.js';
import { bybitFundingAdapter } from './adapters/bybit.funding.adapter.js';
import { hyperliquidFundingAdapter } from './adapters/hyperliquid.funding.adapter.js';
import { coinbaseFundingAdapter } from './adapters/coinbase.funding.adapter.js';

export class FundingService {
  private registry: FundingRegistry;
  private normalizer: FundingNormalizer;
  private classifier: FundingContextClassifier;
  private store: FundingStore | null = null;

  constructor() {
    this.registry = new FundingRegistry([
      binanceFundingAdapter,
      bybitFundingAdapter,
      hyperliquidFundingAdapter,
      coinbaseFundingAdapter,
    ]);
    this.normalizer = new FundingNormalizer();
    this.classifier = new FundingContextClassifier();
  }

  /**
   * Initialize with database
   */
  init(db: Db) {
    this.store = new FundingStore(db);
  }

  /**
   * Read funding from all venues for symbols
   */
  async readAllVenues(symbols: string[]): Promise<FundingReadResult[]> {
    const adapters = this.registry.all();
    const results: FundingReadResult[] = [];

    // Parallel fetch from all venues
    const promises = adapters.map(async (adapter) => {
      try {
        return await adapter.readFunding({ symbols });
      } catch (e) {
        console.warn(`[Funding] ${adapter.venue()} failed:`, e);
        return null;
      }
    });

    const resolved = await Promise.all(promises);
    for (const r of resolved) {
      if (r) results.push(r);
    }

    return results;
  }

  /**
   * Get normalized funding for symbols
   */
  async getNormalized(symbols: string[]): Promise<NormalizedFunding[]> {
    const results = await this.readAllVenues(symbols);
    return this.normalizer.normalize(results);
  }

  /**
   * Get full context (normalized + classified)
   */
  async getContext(symbols: string[]): Promise<FundingContext[]> {
    if (!this.store) {
      throw new Error('FundingService not initialized with DB');
    }

    const normalized = await this.getNormalized(symbols);
    const prevMap = await this.store.latestBulk(symbols);
    const contexts: FundingContext[] = [];

    for (const n of normalized) {
      const prev = prevMap.get(n.symbol) ?? null;
      const ctx = this.classifier.classify(n, prev);
      contexts.push(ctx);

      // Save to DB
      await this.store.upsertLatest(ctx);
    }

    return contexts;
  }

  /**
   * Get context for single symbol
   */
  async getContextOne(symbol: string): Promise<FundingContext | null> {
    const contexts = await this.getContext([symbol]);
    return contexts[0] ?? null;
  }

  /**
   * Health check all venues
   */
  async healthCheck(): Promise<Record<FundingVenue, { ok: boolean; message?: string }>> {
    const result: Record<string, { ok: boolean; message?: string }> = {};

    for (const adapter of this.registry.all()) {
      result[adapter.venue()] = await adapter.healthCheck();
    }

    return result as Record<FundingVenue, { ok: boolean; message?: string }>;
  }

  /**
   * Get historical context from store
   */
  async getTimeline(symbol: string, limit = 100): Promise<FundingContext[]> {
    if (!this.store) return [];
    return this.store.timeline(symbol, limit);
  }

  /**
   * Get batch context (alias for getContext) 
   */
  async batchContext(symbols: string[]): Promise<FundingContext[]> {
    return this.getContext(symbols);
  }
}

export const fundingService = new FundingService();

console.log('[Funding] Service loaded');
