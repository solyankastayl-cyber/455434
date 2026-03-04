/**
 * Paper Trading Module Exports (Phase 13.3)
 */
export * from './paper_portfolio.model.js';
export * from './paper_position.model.js';
export * from './paper.routes.js';

export {
  createPortfolio,
  getPortfolios,
  getPortfolioById,
  updatePortfolio,
  openPosition,
  closePosition,
  updatePositionPrice,
  getPositions,
  updatePortfolioStats,
  getPortfolioPerformance,
} from './paper.service.js';
