/**
 * BLOCK 2.11 — Feature Registry
 * ==============================
 * Defines all 40+ indicators in a modular way.
 */

export interface SymbolRawData {
  price: number;
  volumeUsd24h?: number;

  ohlc?: {
    close1hAgo?: number;
    close24hAgo?: number;
    high24h?: number;
    low24h?: number;
  };

  // Derivatives
  oiUsd?: number;
  oiUsd1hAgo?: number;

  fundingRate?: number;
  fundingAnnualized?: number;

  liquidationsUsd1h?: number;
  longShortRatio?: number;

  // Microstructure
  buySellImbalance1h?: number;
  bookImbalance?: number;

  // Volatility
  atr?: number;
  volatility24h?: number;

  // Momentum indicators
  rsi?: number;
  rsiOverride?: number;

  // Order flow
  cvd?: number;           // Cumulative Volume Delta
  takerBuyRatio?: number;
}

export interface FeatureCtx {
  raw: SymbolRawData;
  nowPrice: number;
}

export interface FeatureDef {
  key: string;
  requires?: (keyof SymbolRawData)[];
  compute: (ctx: FeatureCtx) => number | null;
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  // ═══════════════════════════════════════════════════════════════
  // PRICE FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'ret_1h',
    requires: ['ohlc'],
    compute: ({ raw, nowPrice }) => {
      const p = raw.ohlc?.close1hAgo;
      return p ? (nowPrice - p) / p : null;
    },
  },
  {
    key: 'ret_24h',
    requires: ['ohlc'],
    compute: ({ raw, nowPrice }) => {
      const p = raw.ohlc?.close24hAgo;
      return p ? (nowPrice - p) / p : null;
    },
  },
  {
    key: 'range_24h',
    requires: ['ohlc'],
    compute: ({ raw }) => {
      const h = raw.ohlc?.high24h;
      const l = raw.ohlc?.low24h;
      if (!h || !l || l === 0) return null;
      return (h - l) / l;
    },
  },
  {
    key: 'distance_from_high',
    requires: ['ohlc'],
    compute: ({ raw, nowPrice }) => {
      const h = raw.ohlc?.high24h;
      if (!h || h === 0) return null;
      return (h - nowPrice) / h;
    },
  },
  {
    key: 'distance_from_low',
    requires: ['ohlc'],
    compute: ({ raw, nowPrice }) => {
      const l = raw.ohlc?.low24h;
      if (!l || l === 0) return null;
      return (nowPrice - l) / l;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // FUNDING FEATURES (CRITICAL for Block 2.8)
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'funding_rate',
    requires: ['fundingRate'],
    compute: ({ raw }) => raw.fundingRate ?? null,
  },
  {
    key: 'funding_annualized',
    requires: ['fundingAnnualized'],
    compute: ({ raw }) => raw.fundingAnnualized ?? null,
  },
  {
    key: 'funding_abs',
    requires: ['fundingRate'],
    compute: ({ raw }) => raw.fundingRate != null ? Math.abs(raw.fundingRate) : null,
  },
  {
    key: 'funding_sign',
    requires: ['fundingRate'],
    compute: ({ raw }) => raw.fundingRate != null ? Math.sign(raw.fundingRate) : null,
  },

  // ═══════════════════════════════════════════════════════════════
  // OPEN INTEREST FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'oi_usd',
    requires: ['oiUsd'],
    compute: ({ raw }) => raw.oiUsd ?? null,
  },
  {
    key: 'oi_chg_1h',
    requires: ['oiUsd', 'oiUsd1hAgo'],
    compute: ({ raw }) => {
      if (!raw.oiUsd || !raw.oiUsd1hAgo || raw.oiUsd1hAgo === 0) return null;
      return (raw.oiUsd - raw.oiUsd1hAgo) / raw.oiUsd1hAgo;
    },
  },
  {
    key: 'oi_per_volume',
    requires: ['oiUsd', 'volumeUsd24h'],
    compute: ({ raw }) => {
      if (!raw.oiUsd || !raw.volumeUsd24h || raw.volumeUsd24h === 0) return null;
      return raw.oiUsd / raw.volumeUsd24h;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // LIQUIDATION FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'liq_1h',
    requires: ['liquidationsUsd1h'],
    compute: ({ raw }) => raw.liquidationsUsd1h ?? null,
  },
  {
    key: 'liq_to_oi_ratio',
    requires: ['liquidationsUsd1h', 'oiUsd'],
    compute: ({ raw }) => {
      if (!raw.liquidationsUsd1h || !raw.oiUsd || raw.oiUsd === 0) return null;
      return raw.liquidationsUsd1h / raw.oiUsd;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // LONG/SHORT RATIO
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'ls_ratio',
    requires: ['longShortRatio'],
    compute: ({ raw }) => raw.longShortRatio ?? null,
  },
  {
    key: 'ls_skew',
    requires: ['longShortRatio'],
    compute: ({ raw }) => {
      if (raw.longShortRatio == null) return null;
      return raw.longShortRatio - 1; // Positive = more longs
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // VOLUME FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'volume_24h',
    requires: ['volumeUsd24h'],
    compute: ({ raw }) => raw.volumeUsd24h ?? null,
  },
  {
    key: 'volume_log',
    requires: ['volumeUsd24h'],
    compute: ({ raw }) => {
      if (!raw.volumeUsd24h || raw.volumeUsd24h <= 0) return null;
      return Math.log10(raw.volumeUsd24h);
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // VOLATILITY FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'volatility_24h',
    requires: ['volatility24h'],
    compute: ({ raw }) => raw.volatility24h ?? null,
  },
  {
    key: 'atr',
    requires: ['atr'],
    compute: ({ raw }) => raw.atr ?? null,
  },

  // ═══════════════════════════════════════════════════════════════
  // MOMENTUM FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'rsi',
    requires: ['rsi'],
    compute: ({ raw }) => raw.rsi ?? null,
  },
  {
    key: 'rsi_oversold',
    requires: ['rsi'],
    compute: ({ raw }) => raw.rsi != null && raw.rsi < 30 ? 1 : 0,
  },
  {
    key: 'rsi_overbought',
    requires: ['rsi'],
    compute: ({ raw }) => raw.rsi != null && raw.rsi > 70 ? 1 : 0,
  },

  // ═══════════════════════════════════════════════════════════════
  // ORDER FLOW FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'buy_sell_imb',
    requires: ['buySellImbalance1h'],
    compute: ({ raw }) => raw.buySellImbalance1h ?? null,
  },
  {
    key: 'book_imb',
    requires: ['bookImbalance'],
    compute: ({ raw }) => raw.bookImbalance ?? null,
  },
  {
    key: 'cvd',
    requires: ['cvd'],
    compute: ({ raw }) => raw.cvd ?? null,
  },
  {
    key: 'taker_buy_ratio',
    requires: ['takerBuyRatio'],
    compute: ({ raw }) => raw.takerBuyRatio ?? null,
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPOSITE FEATURES
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'momentum_score',
    requires: ['rsi', 'ohlc'],
    compute: ({ raw, nowPrice }) => {
      const rsi = raw.rsi ?? 50;
      const ret24h = raw.ohlc?.close24hAgo
        ? (nowPrice - raw.ohlc.close24hAgo) / raw.ohlc.close24hAgo
        : 0;
      return (rsi - 50) / 50 * 0.5 + ret24h * 0.5;
    },
  },
  {
    key: 'squeeze_score',
    requires: ['fundingRate', 'oiUsd', 'liquidationsUsd1h'],
    compute: ({ raw }) => {
      const fundingAbs = Math.abs(raw.fundingRate ?? 0);
      const liqRatio = raw.oiUsd && raw.liquidationsUsd1h
        ? raw.liquidationsUsd1h / raw.oiUsd
        : 0;
      return fundingAbs * 100 + liqRatio * 10;
    },
  },
  {
    key: 'crowdedness',
    requires: ['fundingRate', 'longShortRatio'],
    compute: ({ raw }) => {
      const funding = raw.fundingRate ?? 0;
      const lsSkew = (raw.longShortRatio ?? 1) - 1;
      return Math.abs(funding) * 50 + Math.abs(lsSkew) * 0.5;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // DERIVED SCORES (for ML)
  // ═══════════════════════════════════════════════════════════════
  {
    key: 'score_up',
    compute: ({ raw, nowPrice }) => {
      // Simplified: positive when momentum and funding align
      const ret1h = raw.ohlc?.close1hAgo
        ? (nowPrice - raw.ohlc.close1hAgo) / raw.ohlc.close1hAgo
        : 0;
      const funding = raw.fundingRate ?? 0;
      // Positive return + negative funding = squeeze up potential
      return 0.5 + ret1h * 10 - funding * 50;
    },
  },
  {
    key: 'score_down',
    compute: ({ raw, nowPrice }) => {
      const ret1h = raw.ohlc?.close1hAgo
        ? (nowPrice - raw.ohlc.close1hAgo) / raw.ohlc.close1hAgo
        : 0;
      const funding = raw.fundingRate ?? 0;
      // Negative return + positive funding = squeeze down potential
      return 0.5 - ret1h * 10 + funding * 50;
    },
  },
];

console.log(`[FeatureRegistry] ${FEATURE_REGISTRY.length} features defined`);
