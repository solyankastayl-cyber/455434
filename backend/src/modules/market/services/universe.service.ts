/**
 * UNIVERSE SERVICE
 * ================
 * 
 * BLOCK B1: Multi-Asset Ranking - Universe Definition
 * 
 * Defines the asset universes for ranking computations:
 * - core: Top 10 most traded assets
 * - extended: Additional 10 alt assets
 * 
 * Universe can be expanded later via configuration.
 */

export type UniverseType = 'core' | 'extended';

// Core universe: Most liquid and popular assets
const CORE_SYMBOLS = [
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'XRP',
  'ADA',
  'AVAX',
  'LINK',
  'DOGE',
  'MATIC',
];

// Extended universe: Additional alt assets
const EXTENDED_SYMBOLS = [
  ...CORE_SYMBOLS,
  'DOT',
  'ATOM',
  'NEAR',
  'APT',
  'ARB',
  'OP',
  'INJ',
  'SUI',
  'TIA',
  'RUNE',
];

export class UniverseService {
  /**
   * Get list of symbols for a given universe
   */
  static getUniverse(type: UniverseType = 'core'): string[] {
    if (type === 'extended') return EXTENDED_SYMBOLS;
    return CORE_SYMBOLS;
  }

  /**
   * Get all available universes
   */
  static getAvailableUniverses(): UniverseType[] {
    return ['core', 'extended'];
  }

  /**
   * Check if a symbol is in a universe
   */
  static isInUniverse(symbol: string, type: UniverseType = 'core'): boolean {
    const universe = this.getUniverse(type);
    return universe.includes(symbol.toUpperCase());
  }
}

console.log('[UniverseService] Module loaded');
