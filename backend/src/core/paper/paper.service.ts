/**
 * Paper Trading Service (Phase 13.3)
 */
import { PaperPortfolioModel, IPaperPortfolio, PaperRules } from './paper_portfolio.model.js';
import { PaperPositionModel, IPaperPosition, PositionStatus } from './paper_position.model.js';
import mongoose from 'mongoose';

/**
 * Create a paper portfolio
 */
export async function createPortfolio(
  userId: string,
  data: {
    name: string;
    description?: string;
    mode: 'copy_actor' | 'copy_strategy' | 'copy_token' | 'custom';
    targets: string[];
    rules?: Partial<PaperRules>;
  }
): Promise<IPaperPortfolio> {
  const portfolio = new PaperPortfolioModel({
    userId,
    name: data.name,
    description: data.description,
    mode: data.mode,
    targets: data.targets.map(t => t.toLowerCase()),
    rules: {
      maxPositions: 5,
      riskCap: 70,
      positionSizeUSD: 1000,
      slippageAssumption: 0.5,
      entrySignalTypes: ['intensity_spike', 'accumulation'],
      entryMinSeverity: 60,
      entryMinConfidence: 0.6,
      exitOnRiskSpike: true,
      exitOnSignalReversal: true,
      ...data.rules,
    },
    stats: {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnlUSD: 0,
      winRate: 0,
      avgPnlPct: 0,
      maxDrawdownPct: 0,
    },
    enabled: true,
  });
  
  await portfolio.save();
  return portfolio;
}

/**
 * Get user's portfolios
 */
export async function getPortfolios(
  userId: string,
  options?: { enabled?: boolean }
): Promise<IPaperPortfolio[]> {
  const query: any = { userId };
  if (options?.enabled !== undefined) {
    query.enabled = options.enabled;
  }
  return PaperPortfolioModel.find(query).sort({ createdAt: -1 });
}

/**
 * Get portfolio by ID
 */
export async function getPortfolioById(
  portfolioId: string,
  userId?: string
): Promise<IPaperPortfolio | null> {
  const query: any = { _id: portfolioId };
  if (userId) query.userId = userId;
  return PaperPortfolioModel.findOne(query);
}

/**
 * Update portfolio
 */
export async function updatePortfolio(
  portfolioId: string,
  userId: string,
  updates: Partial<IPaperPortfolio>
): Promise<IPaperPortfolio | null> {
  delete (updates as any)._id;
  delete (updates as any).userId;
  delete (updates as any).stats;
  
  return PaperPortfolioModel.findOneAndUpdate(
    { _id: portfolioId, userId },
    { $set: updates },
    { new: true }
  );
}

/**
 * Open a paper position
 * 
 * IMPORTANT (п.3.3): Checks for existing open position on same asset+portfolio
 * to prevent duplicate positions from job and manual entry
 */
export async function openPosition(
  portfolioId: string,
  userId: string,
  data: {
    assetAddress: string;
    assetSymbol?: string;
    entryPrice: number;
    entryPriceSource?: 'stub' | 'oracle' | 'dex' | 'cex' | 'manual';
    sizeUSD: number;
    entrySignalId?: string;
    entryReason: string;
  }
): Promise<IPaperPosition | null> {
  const portfolio = await PaperPortfolioModel.findOne({ _id: portfolioId, userId });
  if (!portfolio) return null;
  
  // Check for existing open position on same asset (п.3.3)
  const existingPosition = await PaperPositionModel.findOne({
    portfolioId: new mongoose.Types.ObjectId(portfolioId),
    assetAddress: data.assetAddress.toLowerCase(),
    status: 'open',
  });
  
  if (existingPosition) {
    throw new Error(`Already have open position for ${data.assetAddress} in this portfolio`);
  }
  
  // Check max positions
  const openCount = await PaperPositionModel.countDocuments({
    portfolioId: new mongoose.Types.ObjectId(portfolioId),
    status: 'open',
  });
  
  if (openCount >= portfolio.rules.maxPositions) {
    throw new Error(`Max positions (${portfolio.rules.maxPositions}) reached`);
  }
  
  const position = new PaperPositionModel({
    portfolioId: new mongoose.Types.ObjectId(portfolioId),
    userId,
    assetAddress: data.assetAddress.toLowerCase(),
    assetSymbol: data.assetSymbol,
    chain: 'ethereum',
    entryTimestamp: new Date(),
    entryPrice: data.entryPrice,
    entryPriceSource: data.entryPriceSource || 'stub',
    entryPriceTimestamp: new Date(),
    entrySignalId: data.entrySignalId,
    entryReason: data.entryReason,
    sizeUSD: data.sizeUSD,
    units: data.sizeUSD / data.entryPrice,
    status: 'open',
    currentPrice: data.entryPrice,
    currentPriceSource: data.entryPriceSource || 'stub',
    currentPriceTimestamp: new Date(),
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    maxPrice: data.entryPrice,
    minPrice: data.entryPrice,
    maxDrawdownPct: 0,
  });
  
  await position.save();
  
  // Update portfolio open positions count
  await PaperPortfolioModel.updateOne(
    { _id: portfolioId },
    { $inc: { openPositions: 1 } }
  );
  
  return position;
}

/**
 * Close a paper position
 * 
 * closeReason is REQUIRED and must be one of:
 * time_stop | signal_reversal | risk_spike | manual | profit_target | stop_loss | portfolio_disabled | max_drawdown
 */
export async function closePosition(
  positionId: string,
  userId: string,
  data: {
    exitPrice: number;
    exitPriceSource?: 'stub' | 'oracle' | 'dex' | 'cex' | 'manual';
    exitSignalId?: string;
    exitReason: 'time_stop' | 'signal_reversal' | 'risk_spike' | 'manual' | 'profit_target' | 'stop_loss' | 'portfolio_disabled' | 'max_drawdown';
  }
): Promise<IPaperPosition | null> {
  const position = await PaperPositionModel.findOne({ _id: positionId, userId, status: 'open' });
  if (!position) return null;
  
  // Calculate PnL
  const realizedPnl = (data.exitPrice - position.entryPrice) * position.units;
  const realizedPnlPct = ((data.exitPrice - position.entryPrice) / position.entryPrice) * 100;
  
  // Set status based on reason
  if (data.exitReason === 'profit_target') {
    position.status = 'take_profit';
  } else if (data.exitReason === 'stop_loss' || realizedPnl < 0) {
    position.status = 'stopped_out';
  } else {
    position.status = 'closed';
  }
  
  position.exitTimestamp = new Date();
  position.exitPrice = data.exitPrice;
  position.exitPriceSource = data.exitPriceSource || 'stub';
  position.exitSignalId = data.exitSignalId;
  position.exitReason = data.exitReason;
  position.realizedPnl = realizedPnl;
  position.realizedPnlPct = realizedPnlPct;
  
  await position.save();
  
  // Update portfolio stats
  await updatePortfolioStats(position.portfolioId.toString());
  
  return position;
}

/**
 * Update position price (for unrealized PnL)
 */
export async function updatePositionPrice(
  positionId: string,
  currentPrice: number
): Promise<IPaperPosition | null> {
  const position = await PaperPositionModel.findOne({ _id: positionId, status: 'open' });
  if (!position) return null;
  
  position.currentPrice = currentPrice;
  position.unrealizedPnl = (currentPrice - position.entryPrice) * position.units;
  position.unrealizedPnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  
  // Track max/min prices
  if (currentPrice > (position.maxPrice || 0)) {
    position.maxPrice = currentPrice;
  }
  if (currentPrice < (position.minPrice || Infinity)) {
    position.minPrice = currentPrice;
  }
  
  // Calculate drawdown from max
  if (position.maxPrice && position.maxPrice > 0) {
    const drawdownPct = ((position.maxPrice - currentPrice) / position.maxPrice) * 100;
    if (drawdownPct > (position.maxDrawdownPct || 0)) {
      position.maxDrawdownPct = drawdownPct;
    }
  }
  
  await position.save();
  return position;
}

/**
 * Get positions for portfolio
 */
export async function getPositions(
  portfolioId: string,
  options?: { status?: PositionStatus | PositionStatus[]; limit?: number }
): Promise<IPaperPosition[]> {
  const query: any = { portfolioId: new mongoose.Types.ObjectId(portfolioId) };
  
  if (options?.status) {
    query.status = Array.isArray(options.status) ? { $in: options.status } : options.status;
  }
  
  return PaperPositionModel.find(query)
    .sort({ entryTimestamp: -1 })
    .limit(options?.limit || 100);
}

/**
 * Update portfolio stats from positions
 */
export async function updatePortfolioStats(portfolioId: string): Promise<void> {
  const portfolio = await PaperPortfolioModel.findById(portfolioId);
  if (!portfolio) return;
  
  const closedPositions = await PaperPositionModel.find({
    portfolioId: new mongoose.Types.ObjectId(portfolioId),
    status: { $ne: 'open' },
  });
  
  const openCount = await PaperPositionModel.countDocuments({
    portfolioId: new mongoose.Types.ObjectId(portfolioId),
    status: 'open',
  });
  
  const totalTrades = closedPositions.length;
  const winningTrades = closedPositions.filter(p => (p.realizedPnl || 0) > 0).length;
  const losingTrades = closedPositions.filter(p => (p.realizedPnl || 0) < 0).length;
  const totalPnlUSD = closedPositions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
  
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const avgPnlPct = totalTrades > 0 
    ? closedPositions.reduce((sum, p) => sum + (p.realizedPnlPct || 0), 0) / totalTrades 
    : 0;
  const maxDrawdownPct = closedPositions.reduce((max, p) => Math.max(max, p.maxDrawdownPct || 0), 0);
  
  portfolio.stats = {
    totalTrades,
    winningTrades,
    losingTrades,
    totalPnlUSD,
    winRate,
    avgPnlPct,
    maxDrawdownPct,
  };
  
  portfolio.openPositions = openCount;
  
  // Calculate total value (sum of open positions)
  const openPositions = await PaperPositionModel.find({
    portfolioId: new mongoose.Types.ObjectId(portfolioId),
    status: 'open',
  });
  portfolio.totalValueUSD = openPositions.reduce(
    (sum, p) => sum + p.sizeUSD + (p.unrealizedPnl || 0),
    0
  );
  
  await portfolio.save();
}

/**
 * Get portfolio performance summary
 */
export async function getPortfolioPerformance(portfolioId: string) {
  const portfolio = await PaperPortfolioModel.findById(portfolioId);
  if (!portfolio) return null;
  
  const openPositions = await getPositions(portfolioId, { status: 'open' });
  const recentClosed = await getPositions(portfolioId, { status: ['closed', 'stopped_out', 'take_profit'], limit: 20 });
  
  const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  
  return {
    portfolio: {
      id: portfolio._id,
      name: portfolio.name,
      mode: portfolio.mode,
      targets: portfolio.targets,
      enabled: portfolio.enabled,
    },
    stats: portfolio.stats,
    openPositions: {
      count: openPositions.length,
      totalValue: portfolio.totalValueUSD,
      unrealizedPnl,
      positions: openPositions,
    },
    recentTrades: recentClosed,
  };
}
