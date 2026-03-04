/**
 * Sector Definitions - PART 2
 * 
 * Sector = группировка токенов, НЕ narrative
 * 
 * SectorNarrative = Narrative WHERE involvedTokens ⊆ Sector.tokens
 */

// ============================================================================
// SECTOR DEFINITIONS
// ============================================================================

export interface Sector {
  id: string;
  label: string;
  tokens: string[]; // Token addresses (lowercase)
}

/**
 * Базовые секторы для MVP
 * 
 * ВАЖНО:
 * - Это просто группировка токенов
 * - НЕ ranking
 * - НЕ hot/cold
 * - НЕ intent
 */
export const SECTORS: Record<string, Sector> = {
  stablecoins: {
    id: 'stablecoins',
    label: 'Stablecoins',
    tokens: [
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
      '0x4fabb145d64652a948d72533023f6e7a623c7c53', // BUSD
      '0x853d955acef822db058eb8505911ed77f175b99e', // FRAX
    ],
  },
  
  defi: {
    id: 'defi',
    label: 'DeFi',
    tokens: [
      '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
      '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
      '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
      '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
      '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', // YFI
      '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
      '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
    ],
  },
  
  infra: {
    id: 'infra',
    label: 'Infrastructure',
    tokens: [
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
      '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // stETH
      '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', // MATIC
    ],
  },
  
  meme: {
    id: 'meme',
    label: 'Meme',
    tokens: [
      '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', // SHIB
      '0x4d224452801aced8b2f0aebe155379bb5d594381', // APE
      '0xba11d00c5f74255f56a5e366f4f77f5a186d7f55', // BAND
    ],
  },
  
  ai: {
    id: 'ai',
    label: 'AI',
    tokens: [
      '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', // MANA (близко к AI/Metaverse)
      // Добавим больше AI токенов по мере появления
    ],
  },
};

// ============================================================================
// SECTOR DETECTION
// ============================================================================

/**
 * Определяет sector для токена
 * 
 * @param tokenAddress - lowercase token address
 * @param symbol - token symbol (optional, для stablecoin heuristic)
 * @returns sector id или null
 */
export function detectSector(tokenAddress: string, symbol?: string): string | null {
  const normalized = tokenAddress.toLowerCase();
  
  // Check each sector
  for (const [sectorId, sector] of Object.entries(SECTORS)) {
    if (sector.tokens.includes(normalized)) {
      return sectorId;
    }
  }
  
  // Heuristic: если symbol известен как stablecoin
  if (symbol) {
    const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD', 'FRAX', 'USDD', 'TUSD'];
    if (stablecoins.includes(symbol.toUpperCase())) {
      return 'stablecoins';
    }
  }
  
  return null;
}

/**
 * Получить все токены из sector
 */
export function getSectorTokens(sectorId: string): string[] {
  return SECTORS[sectorId]?.tokens || [];
}

/**
 * Получить label для sector
 */
export function getSectorLabel(sectorId: string): string {
  return SECTORS[sectorId]?.label || sectorId;
}

/**
 * Получить все секторы
 */
export function getAllSectors(): Sector[] {
  return Object.values(SECTORS);
}
