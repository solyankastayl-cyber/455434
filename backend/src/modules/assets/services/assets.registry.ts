/**
 * CANONICAL ASSET REGISTRY
 * ========================
 * 
 * Registry of all tracked assets with venue availability.
 * This is the source of truth for "what assets exist".
 */

import type {
  CanonicalAsset,
  VenueId,
  VenueConfig,
  LiquidityProfile,
  AssetUniverse,
} from '../contracts/assets.types.js';

// ═══════════════════════════════════════════════════════════════
// INITIAL UNIVERSE (TOP ASSETS)
// ═══════════════════════════════════════════════════════════════

const INITIAL_ASSETS: CanonicalAsset[] = [
  {
    assetId: 'BTC',
    symbol: 'BTC',
    name: 'Bitcoin',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['BTCUSDT', 'BTCBUSD'], primaryPair: 'BTCUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['BTCUSDT'], primaryPair: 'BTCUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['BTC-USD'], primaryPair: 'BTC-USD' },
      HYPERLIQUID: { status: 'ACTIVE', pairs: ['BTC'], primaryPair: 'BTC' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer1', rank: 1 },
  },
  {
    assetId: 'ETH',
    symbol: 'ETH',
    name: 'Ethereum',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['ETHUSDT', 'ETHBUSD'], primaryPair: 'ETHUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['ETHUSDT'], primaryPair: 'ETHUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['ETH-USD'], primaryPair: 'ETH-USD' },
      HYPERLIQUID: { status: 'ACTIVE', pairs: ['ETH'], primaryPair: 'ETH' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer1', rank: 2 },
  },
  {
    assetId: 'SOL',
    symbol: 'SOL',
    name: 'Solana',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['SOLUSDT'], primaryPair: 'SOLUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['SOLUSDT'], primaryPair: 'SOLUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['SOL-USD'], primaryPair: 'SOL-USD' },
      HYPERLIQUID: { status: 'ACTIVE', pairs: ['SOL'], primaryPair: 'SOL' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer1', rank: 5 },
  },
  {
    assetId: 'XRP',
    symbol: 'XRP',
    name: 'Ripple',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['XRPUSDT'], primaryPair: 'XRPUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['XRPUSDT'], primaryPair: 'XRPUSDT' },
      COINBASE: { status: 'INACTIVE', pairs: [] },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'payment', rank: 4 },
  },
  {
    assetId: 'DOGE',
    symbol: 'DOGE',
    name: 'Dogecoin',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['DOGEUSDT'], primaryPair: 'DOGEUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['DOGEUSDT'], primaryPair: 'DOGEUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['DOGE-USD'], primaryPair: 'DOGE-USD' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'meme', rank: 8 },
  },
  {
    assetId: 'ADA',
    symbol: 'ADA',
    name: 'Cardano',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['ADAUSDT'], primaryPair: 'ADAUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['ADAUSDT'], primaryPair: 'ADAUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['ADA-USD'], primaryPair: 'ADA-USD' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer1', rank: 9 },
  },
  {
    assetId: 'AVAX',
    symbol: 'AVAX',
    name: 'Avalanche',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['AVAXUSDT'], primaryPair: 'AVAXUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['AVAXUSDT'], primaryPair: 'AVAXUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['AVAX-USD'], primaryPair: 'AVAX-USD' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer1', rank: 12 },
  },
  {
    assetId: 'LINK',
    symbol: 'LINK',
    name: 'Chainlink',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['LINKUSDT'], primaryPair: 'LINKUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['LINKUSDT'], primaryPair: 'LINKUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['LINK-USD'], primaryPair: 'LINK-USD' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'oracle', rank: 14 },
  },
  {
    assetId: 'DOT',
    symbol: 'DOT',
    name: 'Polkadot',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['DOTUSDT'], primaryPair: 'DOTUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['DOTUSDT'], primaryPair: 'DOTUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['DOT-USD'], primaryPair: 'DOT-USD' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer0', rank: 15 },
  },
  {
    assetId: 'MATIC',
    symbol: 'MATIC',
    name: 'Polygon',
    venues: {
      BINANCE: { status: 'ACTIVE', pairs: ['MATICUSDT'], primaryPair: 'MATICUSDT' },
      BYBIT: { status: 'ACTIVE', pairs: ['MATICUSDT'], primaryPair: 'MATICUSDT' },
      COINBASE: { status: 'ACTIVE', pairs: ['MATIC-USD'], primaryPair: 'MATIC-USD' },
    },
    primaryQuote: 'USDT',
    liquidityProfile: 'MULTI_VENUE',
    isTracked: true,
    meta: { category: 'layer2', rank: 16 },
  },
];

// ═══════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════

const assetRegistry: Map<string, CanonicalAsset> = new Map();

// Initialize with default assets
for (const asset of INITIAL_ASSETS) {
  assetRegistry.set(asset.assetId, asset);
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function getAsset(assetId: string): CanonicalAsset | null {
  return assetRegistry.get(assetId.toUpperCase()) || null;
}

export function getAssetBySymbol(symbol: string): CanonicalAsset | null {
  // Normalize: BTCUSDT -> BTC
  const normalized = symbol.replace(/USDT$|USD$|USDC$|BUSD$/i, '').toUpperCase();
  return assetRegistry.get(normalized) || null;
}

export function getAllAssets(): CanonicalAsset[] {
  return Array.from(assetRegistry.values());
}

export function getTrackedAssets(): CanonicalAsset[] {
  return getAllAssets().filter(a => a.isTracked);
}

export function getAssetsByVenue(venue: VenueId): CanonicalAsset[] {
  return getAllAssets().filter(a => {
    const venueConfig = a.venues[venue];
    return venueConfig && venueConfig.status === 'ACTIVE';
  });
}

export function getAssetPair(assetId: string, venue: VenueId): string | null {
  const asset = getAsset(assetId);
  if (!asset) return null;
  
  const venueConfig = asset.venues[venue];
  if (!venueConfig || venueConfig.status !== 'ACTIVE') return null;
  
  return venueConfig.primaryPair || venueConfig.pairs[0] || null;
}

export function getActiveVenues(assetId: string): VenueId[] {
  const asset = getAsset(assetId);
  if (!asset) return [];
  
  const venues: VenueId[] = [];
  for (const [venue, config] of Object.entries(asset.venues)) {
    if (config && config.status === 'ACTIVE') {
      venues.push(venue as VenueId);
    }
  }
  return venues;
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSE BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildAssetUniverse(): AssetUniverse {
  const assets = getAllAssets();
  
  const byProfile: Record<LiquidityProfile, number> = {
    SINGLE_VENUE: 0,
    MULTI_VENUE: 0,
    FRAGMENTED: 0,
    UNKNOWN: 0,
  };
  
  const byVenue: Partial<Record<VenueId, number>> = {};
  
  for (const asset of assets) {
    byProfile[asset.liquidityProfile]++;
    
    for (const [venue, config] of Object.entries(asset.venues)) {
      if (config && config.status === 'ACTIVE') {
        byVenue[venue as VenueId] = (byVenue[venue as VenueId] || 0) + 1;
      }
    }
  }
  
  return {
    version: 'v1.0',
    lastRebuild: Date.now(),
    totalAssets: assets.length,
    byProfile,
    byVenue,
    assets,
  };
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY MUTATIONS (admin only)
// ═══════════════════════════════════════════════════════════════

export function addAsset(asset: CanonicalAsset): void {
  assetRegistry.set(asset.assetId, asset);
  console.log(`[AssetRegistry] Added: ${asset.assetId}`);
}

export function updateVenueStatus(
  assetId: string,
  venue: VenueId,
  status: VenueConfig['status']
): boolean {
  const asset = assetRegistry.get(assetId);
  if (!asset) return false;
  
  if (asset.venues[venue]) {
    asset.venues[venue]!.status = status;
    asset.venues[venue]!.lastUpdate = Date.now();
    console.log(`[AssetRegistry] Updated ${assetId} ${venue} → ${status}`);
    return true;
  }
  return false;
}

export function setAssetTracked(assetId: string, tracked: boolean): boolean {
  const asset = assetRegistry.get(assetId);
  if (!asset) return false;
  
  asset.isTracked = tracked;
  return true;
}

console.log('[AssetRegistry] Loaded with', assetRegistry.size, 'assets');
