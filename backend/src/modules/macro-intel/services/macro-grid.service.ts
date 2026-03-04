/**
 * Macro Grid Service
 * 
 * Provides the full 8-regime grid for UI display
 */

import {
  MacroGridCell,
  MacroGrid,
  MarketRegime,
  REGIME_DEFINITIONS,
  REGIME_ID_MAP,
} from '../contracts/macro-intel.types.js';

import { getMacroIntelSnapshot } from './macro-intel.snapshot.service.js';

/**
 * Build a single grid cell from regime definition
 */
function buildGridCell(regime: MarketRegime): MacroGridCell {
  const def = REGIME_DEFINITIONS[regime];
  
  // Determine historical bias based on regime characteristics
  let historicalBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (regime === MarketRegime.ALT_SEASON || regime === MarketRegime.ALT_ROTATION || regime === MarketRegime.BTC_LEADS_ALT_FOLLOW) {
    historicalBias = 'BULLISH';
  } else if (regime === MarketRegime.PANIC_SELL_OFF || regime === MarketRegime.FULL_RISK_OFF || regime === MarketRegime.CAPITAL_EXIT) {
    historicalBias = 'BEARISH';
  }
  
  return {
    regime,
    regimeId: REGIME_ID_MAP[regime],
    title: def.title,
    description: def.description,
    interpretation: def.interpretation,
    riskLevel: def.riskLevel,
    marketBias: def.marketBias,
    historicalBias,
    labsSignals: def.labsSignals,
  };
}

/**
 * Build the full 8-regime grid
 */
export function buildMacroGrid(): MacroGrid {
  return Object.values(MarketRegime).map(regime => buildGridCell(regime));
}

/**
 * Get current active regime cell
 */
export async function getActiveRegimeCell(): Promise<MacroGridCell & { isCurrent: true }> {
  const snapshot = await getMacroIntelSnapshot();
  const cell = buildGridCell(snapshot.state.regime);
  return { ...cell, isCurrent: true };
}

/**
 * Get full grid with current regime highlighted
 */
export async function getMacroGridWithActive(): Promise<{
  grid: MacroGrid;
  activeRegime: MarketRegime;
  activeCell: MacroGridCell;
}> {
  const snapshot = await getMacroIntelSnapshot();
  const grid = buildMacroGrid();
  const activeCell = grid.find(cell => cell.regime === snapshot.state.regime)!;
  
  return {
    grid,
    activeRegime: snapshot.state.regime,
    activeCell,
  };
}

console.log('[MacroGrid] Service loaded');
