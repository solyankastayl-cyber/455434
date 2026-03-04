/**
 * BLOCK 2.9 — Asset Tags Model
 * ============================
 * Stores sector assignments for assets.
 */

import type { Db, Collection } from 'mongodb';
import type { AssetTagsDoc, Sector, AssetTag } from '../types/sector.types.js';

// Seed data - top assets with sector assignments
const SEED_ASSET_TAGS: Array<{ symbol: string; sector: Sector; tags: string[] }> = [
  // L1
  { symbol: 'BTCUSDT', sector: 'L1', tags: ['bitcoin', 'store-of-value'] },
  { symbol: 'ETHUSDT', sector: 'L1', tags: ['ethereum', 'smart-contracts'] },
  { symbol: 'SOLUSDT', sector: 'L1', tags: ['solana', 'high-tps'] },
  { symbol: 'AVAXUSDT', sector: 'L1', tags: ['avalanche', 'evm'] },
  { symbol: 'ATOMUSDT', sector: 'L1', tags: ['cosmos', 'interoperability'] },
  { symbol: 'NEARUSDT', sector: 'L1', tags: ['near', 'sharding'] },
  { symbol: 'APTUSDT', sector: 'L1', tags: ['aptos', 'move'] },
  { symbol: 'SUIUSDT', sector: 'L1', tags: ['sui', 'move'] },
  { symbol: 'SEIUSDT', sector: 'L1', tags: ['sei', 'trading'] },
  { symbol: 'INJUSDT', sector: 'L1', tags: ['injective', 'defi-chain'] },
  { symbol: 'TONUSDT', sector: 'L1', tags: ['ton', 'telegram'] },

  // L2
  { symbol: 'ARBUSDT', sector: 'L2', tags: ['arbitrum', 'optimistic-rollup'] },
  { symbol: 'OPUSDT', sector: 'L2', tags: ['optimism', 'op-stack'] },
  { symbol: 'MATICUSDT', sector: 'L2', tags: ['polygon', 'sidechain'] },
  { symbol: 'STXUSDT', sector: 'L2', tags: ['stacks', 'bitcoin-l2'] },
  { symbol: 'MANTAUSDT', sector: 'L2', tags: ['manta', 'modular'] },
  { symbol: 'METISUSDT', sector: 'L2', tags: ['metis', 'decentralized-sequencer'] },
  { symbol: 'ZKUSDT', sector: 'L2', tags: ['zksync', 'zk-rollup'] },
  { symbol: 'STRKUSDT', sector: 'L2', tags: ['starknet', 'zk-rollup'] },
  { symbol: 'IMXUSDT', sector: 'L2', tags: ['immutable', 'gaming'] },

  // DEFI
  { symbol: 'UNIUSDT', sector: 'DEFI', tags: ['uniswap', 'dex'] },
  { symbol: 'AAVEUSDT', sector: 'DEFI', tags: ['aave', 'lending'] },
  { symbol: 'MKRUSDT', sector: 'DEFI', tags: ['makerdao', 'stablecoin'] },
  { symbol: 'CRVUSDT', sector: 'DEFI', tags: ['curve', 'stableswap'] },
  { symbol: 'LDOUSDT', sector: 'DEFI', tags: ['lido', 'liquid-staking'] },
  { symbol: 'COMPUSDT', sector: 'DEFI', tags: ['compound', 'lending'] },
  { symbol: 'SUSHIUSDT', sector: 'DEFI', tags: ['sushi', 'dex'] },
  { symbol: 'SNXUSDT', sector: 'DEFI', tags: ['synthetix', 'derivatives'] },
  { symbol: 'DYDXUSDT', sector: 'DEFI', tags: ['dydx', 'perps'] },
  { symbol: '1INCHUSDT', sector: 'DEFI', tags: ['1inch', 'aggregator'] },
  { symbol: 'GMXUSDT', sector: 'DEFI', tags: ['gmx', 'perps'] },
  { symbol: 'PENDLEUSDT', sector: 'DEFI', tags: ['pendle', 'yield'] },
  { symbol: 'JUPUSDT', sector: 'DEFI', tags: ['jupiter', 'aggregator'] },
  { symbol: 'RNDRUSDT', sector: 'INFRA', tags: ['render', 'gpu'] },
  
  // AI
  { symbol: 'FETUSDT', sector: 'AI', tags: ['fetch', 'autonomous-agents'] },
  { symbol: 'AGIXUSDT', sector: 'AI', tags: ['singularitynet', 'ai-marketplace'] },
  { symbol: 'OCEANUSDT', sector: 'AI', tags: ['ocean', 'data-marketplace'] },
  { symbol: 'WLDUSDT', sector: 'AI', tags: ['worldcoin', 'identity'] },
  { symbol: 'TAOUSDT', sector: 'AI', tags: ['bittensor', 'ai-network'] },
  { symbol: 'ARKMUSDT', sector: 'AI', tags: ['arkm', 'analytics'] },
  { symbol: 'AIUSDT', sector: 'AI', tags: ['ai-token', 'ai'] },

  // MEME
  { symbol: 'DOGEUSDT', sector: 'MEME', tags: ['doge', 'og-meme'] },
  { symbol: 'SHIBUSDT', sector: 'MEME', tags: ['shiba', 'dog-meme'] },
  { symbol: 'PEPEUSDT', sector: 'MEME', tags: ['pepe', 'frog-meme'] },
  { symbol: 'FLOKIUSDT', sector: 'MEME', tags: ['floki', 'dog-meme'] },
  { symbol: 'BONKUSDT', sector: 'MEME', tags: ['bonk', 'solana-meme'] },
  { symbol: 'WIFUSDT', sector: 'MEME', tags: ['wif', 'dog-meme'] },
  { symbol: 'MEMEUSDT', sector: 'MEME', tags: ['meme', 'meme-coin'] },
  { symbol: 'MOGUSDT', sector: 'MEME', tags: ['mog', 'cat-meme'] },

  // GAMING
  { symbol: 'AXSUSDT', sector: 'GAMING', tags: ['axie', 'play-to-earn'] },
  { symbol: 'SANDUSDT', sector: 'GAMING', tags: ['sandbox', 'metaverse'] },
  { symbol: 'MANAUSDT', sector: 'GAMING', tags: ['decentraland', 'metaverse'] },
  { symbol: 'GALAUSDT', sector: 'GAMING', tags: ['gala', 'games'] },
  { symbol: 'ILVUSDT', sector: 'GAMING', tags: ['illuvium', 'gaming'] },
  { symbol: 'PIXELUSDT', sector: 'GAMING', tags: ['pixel', 'gaming'] },
  { symbol: 'XAIUSDT', sector: 'GAMING', tags: ['xai', 'gaming-l3'] },
  { symbol: 'PORTALUSDT', sector: 'GAMING', tags: ['portal', 'gaming'] },
  { symbol: 'RONUSDT', sector: 'GAMING', tags: ['ronin', 'gaming-chain'] },

  // ORACLE
  { symbol: 'LINKUSDT', sector: 'ORACLE', tags: ['chainlink', 'oracle'] },
  { symbol: 'BANDUSDT', sector: 'ORACLE', tags: ['band', 'oracle'] },
  { symbol: 'APIUSDT', sector: 'ORACLE', tags: ['api3', 'oracle'] },
  { symbol: 'PYTHUSDT', sector: 'ORACLE', tags: ['pyth', 'oracle'] },

  // INFRA
  { symbol: 'FILUSDT', sector: 'INFRA', tags: ['filecoin', 'storage'] },
  { symbol: 'ARUSDT', sector: 'INFRA', tags: ['arweave', 'storage'] },
  { symbol: 'GRTUSDT', sector: 'INFRA', tags: ['graph', 'indexing'] },
  { symbol: 'AKUSDT', sector: 'INFRA', tags: ['akash', 'compute'] },
  { symbol: 'TIAAUSDT', sector: 'INFRA', tags: ['celestia', 'modular'] },

  // RWA
  { symbol: 'ONDOUSDT', sector: 'RWA', tags: ['ondo', 'tokenized-securities'] },
  { symbol: 'PROUSDT', sector: 'RWA', tags: ['propy', 'real-estate'] },
];

export class AssetTagsStore {
  private col: Collection<AssetTagsDoc> | null = null;

  init(db: Db) {
    this.col = db.collection<AssetTagsDoc>('asset_tags');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ symbol: 1 }, { unique: true });
      await this.col.createIndex({ sector: 1 });
    } catch (e) {
      console.warn('[AssetTags] Index error:', e);
    }
  }

  /**
   * Seed initial data
   */
  async seedInitialData(): Promise<{ added: number; skipped: number }> {
    if (!this.col) return { added: 0, skipped: 0 };

    let added = 0;
    let skipped = 0;
    const now = new Date();

    for (const tag of SEED_ASSET_TAGS) {
      try {
        await this.col.updateOne(
          { symbol: tag.symbol },
          {
            $setOnInsert: {
              symbol: tag.symbol,
              sector: tag.sector,
              tags: tag.tags,
              source: 'seed',
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true }
        );
        added++;
      } catch (e) {
        skipped++;
      }
    }

    return { added, skipped };
  }

  /**
   * Get sector for symbol
   */
  async getSector(symbol: string): Promise<Sector | null> {
    if (!this.col) return null;
    const doc = await this.col.findOne({ symbol });
    return doc?.sector ?? null;
  }

  /**
   * Get all symbols for sector
   */
  async getSymbolsBySector(sector: Sector): Promise<string[]> {
    if (!this.col) return [];
    const docs = await this.col.find({ sector }).toArray();
    return docs.map(d => d.symbol);
  }

  /**
   * Get all asset tags
   */
  async getAll(): Promise<AssetTagsDoc[]> {
    if (!this.col) return [];
    return this.col.find({}).toArray();
  }

  /**
   * Get sector distribution
   */
  async getSectorStats(): Promise<Record<Sector, number>> {
    if (!this.col) return {} as Record<Sector, number>;

    const pipeline = [
      { $group: { _id: '$sector', count: { $sum: 1 } } },
    ];

    const results = await this.col.aggregate(pipeline).toArray();
    const stats: Record<string, number> = {};

    for (const r of results) {
      stats[r._id] = r.count;
    }

    return stats as Record<Sector, number>;
  }

  /**
   * Add or update asset tag
   */
  async upsertTag(tag: AssetTag): Promise<void> {
    if (!this.col) return;
    const now = new Date();

    await this.col.updateOne(
      { symbol: tag.symbol },
      {
        $set: {
          sector: tag.sector,
          tags: tag.tags ?? [],
          source: tag.source ?? 'manual',
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
  }
}

export const assetTagsStore = new AssetTagsStore();

console.log('[Sector] Asset Tags Store loaded');
