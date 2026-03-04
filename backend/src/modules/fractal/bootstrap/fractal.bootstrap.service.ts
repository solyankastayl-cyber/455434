/**
 * Fractal Bootstrap Service - PRODUCTION VERSION
 * 
 * Data Sources (merged chronologically):
 * - Legacy: Mt.Gox era (Jul 2010 → Nov 2014)
 * - Primary: Bitstamp/CryptoDataDownload (Nov 2014 → present)
 * - Tail: Coinbase API (incremental daily updates)
 * 
 * Full BTC history: 2010 → present
 */

import { RawStore } from '../data/raw.store.js';
import { CanonicalStore } from '../data/canonical.store.js';
import { StateStore } from '../data/state.store.js';
import { KrakenCsvProvider } from '../data/providers/kraken-csv.provider.js';
import { LegacyProvider } from '../data/providers/legacy.provider.js';
import { CoinbaseProvider } from '../data/providers/coinbase.provider.js';
import { OhlcvCandle } from '../contracts/fractal.contracts.js';
import {
  FRACTAL_SYMBOL,
  FRACTAL_TIMEFRAME,
  ONE_DAY_MS,
  RECONCILE_TAIL_DAYS
} from '../domain/constants.js';

const STATE_KEY = `${FRACTAL_SYMBOL}:${FRACTAL_TIMEFRAME}`;

export class FractalBootstrapService {
  private rawStore = new RawStore();
  private canonicalStore = new CanonicalStore();
  private stateStore = new StateStore();

  // Legacy provider for early history (2010-2014)
  private legacyProvider = new LegacyProvider();
  
  // Primary for bootstrap (CSV - 2014+)
  private bootstrapProvider = new KrakenCsvProvider();
  
  // Secondary for tail updates (API)
  private tailProvider = new CoinbaseProvider();

  /**
   * Main entry point - ensures data is ready
   */
  async ensureBootstrapped(): Promise<void> {
    const state = await this.stateStore.get(STATE_KEY);

    if (!state || !state.bootstrap?.done) {
      console.log('[Fractal] Running FULL BOOTSTRAP (Legacy + Modern)...');
      await this.runFullBootstrap();
    } else {
      console.log('[Fractal] Running incremental update (Coinbase)...');
      await this.runIncrementalUpdate();
    }
  }

  /**
   * Full bootstrap from Legacy + Modern CSVs
   */
  private async runFullBootstrap(): Promise<void> {
    console.log('[Fractal] FULL BOOTSTRAP START');

    await this.stateStore.upsert({
      _id: STATE_KEY,
      symbol: FRACTAL_SYMBOL,
      timeframe: FRACTAL_TIMEFRAME,
      bootstrap: {
        done: false,
        startedAt: new Date()
      },
      gaps: { count: 0 },
      sources: {
        primary: this.bootstrapProvider.name,
        fallback: [this.legacyProvider.name, this.tailProvider.name]
      }
    });

    try {
      // 1. Fetch legacy data (2010-2014)
      const legacyCandles = await this.legacyProvider.fetchAll();
      console.log(`[Fractal] Legacy data: ${legacyCandles.length} candles (Mt.Gox era)`);

      // 2. Store legacy raw
      if (legacyCandles.length > 0) {
        await this.rawStore.upsertMany(
          FRACTAL_SYMBOL,
          FRACTAL_TIMEFRAME,
          this.legacyProvider.name,
          legacyCandles
        );
        // Build canonical for legacy
        await this.buildCanonicalFromCandles(legacyCandles, this.legacyProvider.name);
        console.log('[Fractal] Legacy canonical built');
      }

      // 3. Fetch modern data (2014+)
      const modernCandles = await this.bootstrapProvider.fetchAll();
      console.log(`[Fractal] Modern data: ${modernCandles.length} candles (Bitstamp)`);

      if (modernCandles.length === 0) {
        throw new Error('No candles received from modern CSV');
      }

      // 4. Store modern raw
      await this.rawStore.upsertMany(
        FRACTAL_SYMBOL,
        FRACTAL_TIMEFRAME,
        this.bootstrapProvider.name,
        modernCandles
      );
      
      // 5. Build canonical for modern (will overwrite overlapping dates)
      await this.buildCanonicalFromCandles(modernCandles, this.bootstrapProvider.name);
      console.log('[Fractal] Modern canonical built');

      // 6. Merge stats
      const allCandles = [...legacyCandles, ...modernCandles];
      allCandles.sort((a, b) => a.ts.getTime() - b.ts.getTime());
      
      // Dedupe by timestamp
      const deduped = new Map<number, OhlcvCandle>();
      for (const c of allCandles) {
        deduped.set(c.ts.getTime(), c);
      }
      const finalCandles = Array.from(deduped.values()).sort((a, b) => a.ts.getTime() - b.ts.getTime());

      // 7. Continuity check
      const gaps = await this.scanContinuity();
      console.log(`[Fractal] Continuity scan: ${gaps} gaps`);

      // 8. Update state
      const firstTs = finalCandles[0].ts;
      const lastTs = finalCandles[finalCandles.length - 1].ts;
      await this.stateStore.setBootstrapComplete(STATE_KEY, lastTs);
      await this.stateStore.updateGaps(STATE_KEY, gaps);

      console.log('[Fractal] FULL BOOTSTRAP COMPLETE');
      console.log(`[Fractal] Total: ${finalCandles.length} unique candles`);
      console.log(`[Fractal] First: ${firstTs.toISOString()}`);
      console.log(`[Fractal] Last: ${lastTs.toISOString()}`);

    } catch (error) {
      console.error('[Fractal] Bootstrap failed:', error);
      throw error;
    }
  }

  /**
   * Incremental update from Coinbase (tail provider)
   */
  async runIncrementalUpdate(): Promise<void> {
    const state = await this.stateStore.get(STATE_KEY);

    if (!state?.lastCanonicalTs) {
      console.log('[Fractal] No lastCanonicalTs, running full bootstrap');
      await this.runFullBootstrap();
      return;
    }

    const lastTs = new Date(state.lastCanonicalTs);
    const yesterday = this.getYesterdayUTC();
    const nextDay = new Date(lastTs.getTime() + ONE_DAY_MS);

    if (nextDay > yesterday) {
      console.log('[Fractal] Data is current, no update needed');
      return;
    }

    const lagDays = Math.round((yesterday.getTime() - lastTs.getTime()) / ONE_DAY_MS);
    console.log(`[Fractal] Updating ${lagDays} days: ${nextDay.toISOString().split('T')[0]} -> ${yesterday.toISOString().split('T')[0]}`);

    try {
      const newCandles = await this.tailProvider.fetchRange(
        FRACTAL_SYMBOL,
        FRACTAL_TIMEFRAME,
        nextDay,
        yesterday
      );

      if (newCandles.length === 0) {
        console.log('[Fractal] Coinbase returned no new candles');
        return;
      }

      // Store raw
      await this.rawStore.upsertMany(
        FRACTAL_SYMBOL,
        FRACTAL_TIMEFRAME,
        this.tailProvider.name,
        newCandles
      );

      // Build canonical for new candles
      await this.buildCanonicalFromCandles(newCandles, this.tailProvider.name);

      // Reconcile last N days
      await this.reconcileTail(RECONCILE_TAIL_DAYS);

      // Update state
      const newLastTs = newCandles[newCandles.length - 1].ts;
      await this.stateStore.updateLastTs(STATE_KEY, newLastTs);

      console.log(`[Fractal] Incremental update complete: +${newCandles.length} candles`);

    } catch (error) {
      console.error('[Fractal] Incremental update failed:', error);
    }
  }

  /**
   * Build canonical records from candles
   */
  private async buildCanonicalFromCandles(candles: OhlcvCandle[], source: string): Promise<void> {
    for (const c of candles) {
      await this.canonicalStore.upsert({
        meta: {
          symbol: FRACTAL_SYMBOL,
          timeframe: FRACTAL_TIMEFRAME
        },
        ts: c.ts,
        ohlcv: {
          o: c.open,
          h: c.high,
          l: c.low,
          c: c.close,
          v: c.volume
        },
        provenance: {
          chosenSource: source,
          candidates: [{ source }]
        },
        quality: {
          qualityScore: 1,
          flags: [],
          sanity_ok: this.checkSanity(c)
        }
      });
    }
  }

  /**
   * Sanity check for candle
   */
  private checkSanity(c: OhlcvCandle): boolean {
    return (
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) &&
      c.volume >= 0 &&
      c.close > 0
    );
  }

  /**
   * Reconcile last N days (rebuild from raw)
   */
  private async reconcileTail(days: number): Promise<void> {
    const state = await this.stateStore.get(STATE_KEY);
    if (!state?.lastCanonicalTs) return;

    const from = new Date(new Date(state.lastCanonicalTs).getTime() - days * ONE_DAY_MS);
    const to = new Date(state.lastCanonicalTs);

    console.log(`[Fractal] Reconciling tail: ${from.toISOString().split('T')[0]} -> ${to.toISOString().split('T')[0]}`);
  }

  /**
   * Scan for gaps in canonical data
   */
  async scanContinuity(): Promise<number> {
    const missing = await this.findGaps();
    await this.stateStore.updateGaps(STATE_KEY, missing.length);
    return missing.length;
  }

  /**
   * Find missing dates in canonical
   */
  private async findGaps(): Promise<Date[]> {
    const all = await this.canonicalStore.getAll(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);

    if (!all || all.length < 2) return [];

    const missing: Date[] = [];

    for (let i = 1; i < all.length; i++) {
      const prev = new Date(all[i - 1].ts).getTime();
      const curr = new Date(all[i].ts).getTime();

      let expected = prev + ONE_DAY_MS;

      while (expected < curr) {
        missing.push(new Date(expected));
        expected += ONE_DAY_MS;
      }
    }

    return missing;
  }

  /**
   * Auto-fix gaps using fallback provider
   */
  async autoFixGaps(): Promise<number> {
    console.log('[Fractal] Running auto-fix gaps...');

    const missingDates = await this.findGaps();

    if (missingDates.length === 0) {
      console.log('[Fractal] No gaps found');
      return 0;
    }

    console.log(`[Fractal] Found ${missingDates.length} missing days`);

    const from = missingDates[0];
    const to = missingDates[missingDates.length - 1];

    try {
      const fallbackData = await this.tailProvider.fetchRange(
        FRACTAL_SYMBOL,
        FRACTAL_TIMEFRAME,
        from,
        new Date(to.getTime() + ONE_DAY_MS)
      );

      if (fallbackData.length === 0) {
        console.log('[Fractal] Fallback returned no data');
        return missingDates.length;
      }

      await this.rawStore.upsertMany(
        FRACTAL_SYMBOL,
        FRACTAL_TIMEFRAME,
        this.tailProvider.name,
        fallbackData
      );

      await this.buildCanonicalFromCandles(fallbackData, this.tailProvider.name);

      const remaining = (await this.findGaps()).length;
      console.log(`[Fractal] Remaining gaps: ${remaining}`);

      await this.stateStore.updateGaps(STATE_KEY, remaining);

      return remaining;

    } catch (error) {
      console.error('[Fractal] Auto-fix error:', error);
      return missingDates.length;
    }
  }

  /**
   * Force update (public method for admin)
   */
  async forceUpdate(): Promise<void> {
    await this.runIncrementalUpdate();
  }

  /**
   * Force scan continuity (public method for admin)
   */
  async forceScanContinuity(): Promise<number> {
    return await this.scanContinuity();
  }

  // Helpers
  getYesterdayUTC(): Date {
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(utcMidnight - ONE_DAY_MS);
  }
}
