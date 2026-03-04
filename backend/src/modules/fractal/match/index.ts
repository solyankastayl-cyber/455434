/**
 * BLOCK 73 — Match Selection Module
 * 
 * Contains algorithms for selecting and ranking historical matches.
 */

export { 
  selectPrimaryMatch, 
  rankAllMatches,
  type PrimaryMatch,
  type SelectionWeights,
  type PrimarySelectionResult,
} from './primary-selector.service.js';
