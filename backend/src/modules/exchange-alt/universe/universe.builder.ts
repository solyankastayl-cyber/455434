/**
 * STAGE 2 — Universe Builder Service
 * ====================================
 * Builds and maintains the altcoin universe.
 * Binance-first, then other venues.
 */

import type { Db, Collection } from 'mongodb';
import type { Venue } from '../types.js';
import type { 
  UniverseAsset, 
  UniverseSnapshot, 
  EligibilityRules 
} from './universe.types.js';
import { DEFAULT_ELIGIBILITY_RULES, classifyTier } from './universe.types.js';

// Import data providers
import { binanceUSDMProvider } from '../../exchange/providers/binance.usdm.provider.js';
import { bybitUsdtPerpProvider } from '../../exchange/providers/bybit.usdtperp.provider.js';

export class UniverseBuilder {
  private col: Collection<UniverseAsset> | null = null;
  private snapshotCol: Collection<UniverseSnapshot> | null = null;
  private rules: EligibilityRules = DEFAULT_ELIGIBILITY_RULES;

  init(db: Db, rules?: EligibilityRules) {
    this.col = db.collection<UniverseAsset>('alt_universe');
    this.snapshotCol = db.collection<UniverseSnapshot>('alt_universe_snapshots');
    if (rules) this.rules = rules;
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ symbol: 1, venue: 1 }, { unique: true });
      await this.col.createIndex({ enabled: 1, venue: 1 });
      await this.col.createIndex({ tier: 1, venue: 1 });
      await this.col.createIndex({ tags: 1 });
    } catch (e) {
      console.warn('[UniverseBuilder] Index creation:', e);
    }
  }

  /**
   * Refresh universe from exchange data
   */
  async refresh(venue: Venue = 'BINANCE'): Promise<UniverseSnapshot> {
    console.log(`[UniverseBuilder] Refreshing ${venue} universe...`);
    
    // Get exchange info based on venue
    const assets = await this.fetchExchangeAssets(venue);
    
    // Apply eligibility rules
    const eligible = assets.filter(a => this.checkEligibility(a));
    
    // Classify tiers
    for (const asset of eligible) {
      asset.tier = classifyTier(asset);
      asset.enabled = true;
      asset.lastEligibilityCheck = Date.now();
    }

    // Persist to MongoDB
    if (this.col) {
      for (const asset of eligible) {
        await this.col.updateOne(
          { symbol: asset.symbol, venue: asset.venue },
          { $set: asset },
          { upsert: true }
        );
      }
      
      // Disable assets no longer eligible
      const eligibleSymbols = eligible.map(a => a.symbol);
      await this.col.updateMany(
        { venue, symbol: { $nin: eligibleSymbols }, enabled: true },
        { $set: { enabled: false, lastEligibilityCheck: Date.now() } }
      );
    }

    // Create snapshot
    const snapshot: UniverseSnapshot = {
      ts: Date.now(),
      venue,
      totalAssets: assets.length,
      eligibleAssets: eligible.length,
      assets: eligible,
      rules: this.rules,
    };

    // Save snapshot
    if (this.snapshotCol) {
      await this.snapshotCol.insertOne(snapshot);
    }

    console.log(`[UniverseBuilder] ${venue}: ${eligible.length}/${assets.length} eligible`);
    return snapshot;
  }

  /**
   * Fetch assets from exchange
   */
  private async fetchExchangeAssets(venue: Venue): Promise<UniverseAsset[]> {
    const assets: UniverseAsset[] = [];

    try {
      if (venue === 'BINANCE') {
        // Use existing Binance provider
        const symbols = await binanceUSDMProvider.getSymbols();
        
        for (const symbolInfo of symbols) {
          const base = symbolInfo.symbol.replace('USDT', '').replace('BUSD', '');
          
          assets.push({
            symbol: symbolInfo.symbol,
            base,
            quote: 'USDT',
            venue: 'BINANCE',
            enabled: false,
            tags: this.guessTags(base),
            avgVolume24h: 0, // Would need ticker
            avgOI: 0,
            hasFutures: true,
          });
        }
      } else if (venue === 'BYBIT') {
        // Use existing Bybit provider
        const symbols = await bybitUsdtPerpProvider.getSymbols();
        
        for (const symbolInfo of symbols) {
          const base = symbolInfo.symbol.replace('USDT', '');
          
          assets.push({
            symbol: symbolInfo.symbol,
            base,
            quote: 'USDT',
            venue: 'BYBIT',
            enabled: false,
            tags: this.guessTags(base),
            avgVolume24h: 0,
            avgOI: 0,
            hasFutures: true,
          });
        }
      }
    } catch (err) {
      console.error(`[UniverseBuilder] Error fetching ${venue}:`, err);
    }

    return assets;
  }

  /**
   * Check if asset meets eligibility rules
   */
  private checkEligibility(asset: UniverseAsset): boolean {
    const r = this.rules;
    
    // Volume check
    if ((asset.avgVolume24h ?? 0) < r.minVolume24h) return false;
    
    // OI check
    if ((asset.avgOI ?? 0) < r.minOpenInterest) return false;
    
    // Listing age check
    if (asset.listedAt) {
      const daysListed = (Date.now() - asset.listedAt) / (24 * 60 * 60 * 1000);
      if (daysListed < r.minDaysListed) return false;
    }
    
    // Spread check
    if (r.maxSpreadPct && (asset.avgSpread ?? 0) > r.maxSpreadPct) return false;
    
    // Tag exclusions
    if (r.excludeTags) {
      for (const tag of r.excludeTags) {
        if (asset.tags.includes(tag)) return false;
      }
    }
    
    // Tag inclusions
    if (r.includeTags && r.includeTags.length > 0) {
      const hasIncluded = r.includeTags.some(t => asset.tags.includes(t));
      if (!hasIncluded) return false;
    }
    
    // Market cap check
    if (r.minMarketCap && (asset.marketCap ?? 0) < r.minMarketCap) return false;
    
    return true;
  }

  /**
   * Guess tags based on symbol name (basic heuristic)
   */
  private guessTags(base: string): string[] {
    const tags: string[] = [];
    
    // Known classifications (extend as needed)
    const L1 = ['BTC', 'ETH', 'SOL', 'AVAX', 'NEAR', 'APT', 'SUI', 'SEI', 'TON', 'TIA'];
    const L2 = ['ARB', 'OP', 'MATIC', 'MANTA', 'STRK', 'ZK', 'SCROLL'];
    const DEFI = ['UNI', 'AAVE', 'LINK', 'MKR', 'SNX', 'CRV', 'COMP', 'SUSHI', 'YFI', 'DYDX'];
    const AI = ['FET', 'AGIX', 'OCEAN', 'RNDR', 'TAO', 'AR', 'AKT', 'WLD'];
    const MEME = ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'BRETT', 'MEME'];
    const GAMING = ['AXS', 'SAND', 'MANA', 'GALA', 'IMX', 'ENJ', 'ILV', 'PIXEL'];
    
    if (L1.includes(base)) tags.push('L1');
    if (L2.includes(base)) tags.push('L2');
    if (DEFI.includes(base)) tags.push('DEFI');
    if (AI.includes(base)) tags.push('AI');
    if (MEME.includes(base)) tags.push('MEME');
    if (GAMING.includes(base)) tags.push('GAMING');
    
    // Stablecoins
    if (['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD'].includes(base)) {
      tags.push('STABLECOIN');
    }
    
    return tags;
  }

  // ═══════════════════════════════════════════════════════════════
  // QUERY METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get enabled assets
   */
  async getEnabledAssets(venue?: Venue): Promise<UniverseAsset[]> {
    if (!this.col) return [];
    
    const query: any = { enabled: true };
    if (venue) query.venue = venue;
    
    return this.col.find(query, { projection: { _id: 0 } }).toArray();
  }

  /**
   * Get assets by tier
   */
  async getByTier(tier: 'TIER1' | 'TIER2' | 'TIER3', venue?: Venue): Promise<UniverseAsset[]> {
    if (!this.col) return [];
    
    const query: any = { enabled: true, tier };
    if (venue) query.venue = venue;
    
    return this.col.find(query, { projection: { _id: 0 } }).toArray();
  }

  /**
   * Get assets by tags
   */
  async getByTags(tags: string[], venue?: Venue): Promise<UniverseAsset[]> {
    if (!this.col) return [];
    
    const query: any = { enabled: true, tags: { $in: tags } };
    if (venue) query.venue = venue;
    
    return this.col.find(query, { projection: { _id: 0 } }).toArray();
  }

  /**
   * Get symbol list (just strings)
   */
  async getSymbols(venue: Venue = 'BINANCE'): Promise<string[]> {
    const assets = await this.getEnabledAssets(venue);
    return assets.map(a => a.symbol);
  }

  /**
   * Get latest snapshot
   */
  async getLatestSnapshot(venue: Venue = 'BINANCE'): Promise<UniverseSnapshot | null> {
    if (!this.snapshotCol) return null;
    return this.snapshotCol.find({ venue }).sort({ ts: -1 }).limit(1).next();
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    byVenue: Record<string, number>;
    byTier: Record<string, number>;
    byTag: Record<string, number>;
  }> {
    if (!this.col) return { byVenue: {}, byTier: {}, byTag: {} };

    const assets = await this.col.find({ enabled: true }, { projection: { _id: 0 } }).toArray();
    
    const byVenue: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    const byTag: Record<string, number> = {};

    for (const a of assets) {
      byVenue[a.venue] = (byVenue[a.venue] ?? 0) + 1;
      if (a.tier) byTier[a.tier] = (byTier[a.tier] ?? 0) + 1;
      for (const t of a.tags) {
        byTag[t] = (byTag[t] ?? 0) + 1;
      }
    }

    return { byVenue, byTier, byTag };
  }
}

export const universeBuilder = new UniverseBuilder();

console.log('[Universe] Builder service loaded');
