/**
 * SYMBOLS ROUTES
 * ==============
 * 
 * GET /api/market/symbols
 * 
 * Returns all supported trading symbols from the provider layer.
 * Used by AssetPicker component for dynamic symbol search.
 * 
 * Features:
 * - Normalized symbol format (BTCUSDT)
 * - Asset metadata (name, logo)
 * - Prioritized sorting (core assets first, then alphabetical)
 */

import { FastifyInstance } from 'fastify';
import { UniverseService } from '../services/universe.service.js';
import { extractBase, extractQuote } from '../symbol.normalizer.js';

// Asset metadata for UI display
const ASSET_META: Record<string, { name: string; logo: string }> = {
  BTC: { name: 'Bitcoin', logo: '/logos/btc.svg' },
  ETH: { name: 'Ethereum', logo: '/logos/eth.svg' },
  SOL: { name: 'Solana', logo: '/logos/sol.svg' },
  BNB: { name: 'BNB', logo: '/logos/bnb.svg' },
  XRP: { name: 'XRP', logo: '/logos/xrp.svg' },
  ADA: { name: 'Cardano', logo: '/logos/ada.svg' },
  AVAX: { name: 'Avalanche', logo: '/logos/avax.svg' },
  LINK: { name: 'Chainlink', logo: '/logos/link.svg' },
  DOGE: { name: 'Dogecoin', logo: '/logos/doge.svg' },
  MATIC: { name: 'Polygon', logo: '/logos/matic.svg' },
  DOT: { name: 'Polkadot', logo: '/logos/dot.svg' },
  ATOM: { name: 'Cosmos', logo: '/logos/atom.svg' },
  NEAR: { name: 'NEAR Protocol', logo: '/logos/near.svg' },
  APT: { name: 'Aptos', logo: '/logos/apt.svg' },
  ARB: { name: 'Arbitrum', logo: '/logos/arb.svg' },
  OP: { name: 'Optimism', logo: '/logos/op.svg' },
  INJ: { name: 'Injective', logo: '/logos/inj.svg' },
  SUI: { name: 'Sui', logo: '/logos/sui.svg' },
  TIA: { name: 'Celestia', logo: '/logos/tia.svg' },
  RUNE: { name: 'THORChain', logo: '/logos/rune.svg' },
  LTC: { name: 'Litecoin', logo: '/logos/ltc.svg' },
  UNI: { name: 'Uniswap', logo: '/logos/uni.svg' },
  AAVE: { name: 'Aave', logo: '/logos/aave.svg' },
  MKR: { name: 'Maker', logo: '/logos/mkr.svg' },
  CRV: { name: 'Curve', logo: '/logos/crv.svg' },
  FTM: { name: 'Fantom', logo: '/logos/ftm.svg' },
  SAND: { name: 'The Sandbox', logo: '/logos/sand.svg' },
  MANA: { name: 'Decentraland', logo: '/logos/mana.svg' },
  AXS: { name: 'Axie Infinity', logo: '/logos/axs.svg' },
  GALA: { name: 'Gala', logo: '/logos/gala.svg' },
};

// Priority list for sorting (core assets first)
const PRIORITY_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB'];

export interface MarketSymbol {
  symbol: string;  // Canonical: BTCUSDT
  base: string;    // BTC
  quote: string;   // USDT
  name: string;    // Bitcoin
  logo: string;    // /logos/btc.svg
}

export async function symbolsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/market/symbols
   * 
   * Returns all supported trading symbols
   */
  fastify.get('/api/market/symbols', async (request, reply) => {
    const t0 = Date.now();

    try {
      // Get symbols from UniverseService (extended includes all)
      const baseSymbols = UniverseService.getUniverse('extended');
      
      // Transform to MarketSymbol format
      const symbols: MarketSymbol[] = baseSymbols.map(base => {
        const canonical = `${base}USDT`;
        const meta = ASSET_META[base] || {};
        
        return {
          symbol: canonical,
          base,
          quote: 'USDT',
          name: meta.name || base,
          logo: meta.logo || `/logos/${base.toLowerCase()}.svg`,
        };
      });

      // Sort: priority assets first, then alphabetically
      symbols.sort((a, b) => {
        const prioA = PRIORITY_ASSETS.indexOf(a.base);
        const prioB = PRIORITY_ASSETS.indexOf(b.base);
        
        // Both in priority list
        if (prioA !== -1 && prioB !== -1) return prioA - prioB;
        
        // Only one in priority list
        if (prioA !== -1) return -1;
        if (prioB !== -1) return 1;
        
        // Neither in priority list - alphabetical
        return a.base.localeCompare(b.base);
      });

      return reply.send({
        ok: true,
        count: symbols.length,
        symbols,
        __timings: { totalMs: Date.now() - t0 },
      });

    } catch (error: any) {
      console.error('[Symbols] Error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: error.message,
        __timings: { totalMs: Date.now() - t0 },
      });
    }
  });

  console.log('[Symbols] Routes registered');
}

export default symbolsRoutes;
