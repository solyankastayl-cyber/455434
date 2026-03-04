/**
 * Simulate Copy Job (Phase 13.3)
 * 
 * Runs every 2-5 minutes to process paper portfolios.
 * Updated in 14A.3: Uses real on-chain prices
 */
import { PaperPortfolioModel } from '../core/paper/paper_portfolio.model.js';
import { PaperPositionModel } from '../core/paper/paper_position.model.js';
import { SignalModel } from '../core/signals/signals.model.js';
import { openPosition, closePosition, updatePortfolioStats, updatePositionPrice } from '../core/paper/paper.service.js';
import { getLatestPrice, getWethPriceUsd } from '../core/market/price.service.js';
import { parsePrice } from '../core/market/price_points.model.js';

let lastRunAt: Date | null = null;
let lastResult = {
  portfoliosProcessed: 0,
  positionsOpened: 0,
  positionsClosed: 0,
  pricesUpdated: 0,
  duration: 0,
};

/**
 * Get real price for asset, fallback to stub
 */
async function getRealPrice(assetAddress: string, chain: string = 'ethereum'): Promise<{ price: number; source: 'dex' | 'stub' }> {
  try {
    const pricePoint = await getLatestPrice(assetAddress, chain);
    if (pricePoint && pricePoint.priceUsd) {
      const price = parsePrice(pricePoint.priceUsd);
      if (price > 0) {
        return { price, source: 'dex' };
      }
    }
  } catch (err) {
    // Fallback to stub
  }
  return { price: 100, source: 'stub' };
}

export async function simulateCopy(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Get enabled portfolios
  const portfolios = await PaperPortfolioModel.find({ enabled: true });
  
  let positionsOpened = 0;
  let positionsClosed = 0;
  let pricesUpdated = 0;
  
  for (const portfolio of portfolios) {
    try {
      // Check for exit conditions on open positions
      const openPositions = await PaperPositionModel.find({
        portfolioId: portfolio._id,
        status: 'open',
      });
      
      for (const position of openPositions) {
        // Update current price from real source (14A.3)
        const { price: currentPrice, source } = await getRealPrice(position.assetAddress, position.chain);
        if (currentPrice !== position.currentPrice) {
          await updatePositionPrice(position._id.toString(), currentPrice);
          position.currentPrice = currentPrice;
          position.currentPriceSource = source;
          position.unrealizedPnl = (currentPrice - position.entryPrice) * position.units;
          position.unrealizedPnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
          pricesUpdated++;
        }
        
        // Check time stop
        if (portfolio.rules.timeStopHours) {
          const ageHours = (Date.now() - position.entryTimestamp.getTime()) / (1000 * 60 * 60);
          if (ageHours >= portfolio.rules.timeStopHours) {
            const { price: exitPrice, source: exitSource } = await getRealPrice(position.assetAddress, position.chain);
            await closePosition(position._id.toString(), portfolio.userId, {
              exitPrice,
              exitPriceSource: exitSource,
              exitReason: 'time_stop',
            });
            positionsClosed++;
            continue;
          }
        }
        
        // Check stop loss
        if (portfolio.rules.stopLossPct && position.unrealizedPnlPct !== undefined) {
          if (position.unrealizedPnlPct <= -portfolio.rules.stopLossPct) {
            const { price: exitPrice, source: exitSource } = await getRealPrice(position.assetAddress, position.chain);
            await closePosition(position._id.toString(), portfolio.userId, {
              exitPrice,
              exitPriceSource: exitSource,
              exitReason: 'stop_loss',
            });
            positionsClosed++;
            continue;
          }
        }
        
        // Check take profit
        if (portfolio.rules.profitTargetPct && position.unrealizedPnlPct !== undefined) {
          if (position.unrealizedPnlPct >= portfolio.rules.profitTargetPct) {
            const { price: exitPrice, source: exitSource } = await getRealPrice(position.assetAddress, position.chain);
            await closePosition(position._id.toString(), portfolio.userId, {
              exitPrice,
              exitPriceSource: exitSource,
              exitReason: 'profit_target',
            });
            positionsClosed++;
            continue;
          }
        }
      }
      
      // Check for entry signals for portfolio targets (п.3.3: duplicate check is in openPosition)
      if (portfolio.openPositions < portfolio.rules.maxPositions) {
        const recentSignals = await SignalModel.find({
          actorAddress: { $in: portfolio.targets },
          signalType: { $in: portfolio.rules.entrySignalTypes },
          severity: { $gte: portfolio.rules.entryMinSeverity },
          createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
        }).limit(5);
        
        for (const signal of recentSignals) {
          // openPosition already checks for duplicate (п.3.3)
          // No need to check here again - it will throw if duplicate exists
          
          try {
            // Get real price for entry (14A.3)
            const { price: entryPrice, source: priceSource } = await getRealPrice(signal.actorAddress, 'ethereum');
            await openPosition(portfolio._id.toString(), portfolio.userId, {
              assetAddress: signal.actorAddress,
              entryPrice,
              entryPriceSource: priceSource,
              sizeUSD: portfolio.rules.positionSizeUSD,
              entrySignalId: signal._id.toString(),
              entryReason: `${signal.signalType} with severity ${signal.severity}`,
            });
            positionsOpened++;
          } catch (err: any) {
            // Expected: duplicate position or max positions reached
            if (!err.message?.includes('Already have open position')) {
              console.log(`[Simulate Copy] Skipped entry: ${err.message}`);
            }
          }
        }
      }
      
      // Update portfolio stats
      await updatePortfolioStats(portfolio._id.toString());
      
    } catch (err) {
      console.error(`[Simulate Copy] Failed for portfolio ${portfolio._id}:`, err);
    }
  }
  
  lastRunAt = new Date();
  lastResult = {
    portfoliosProcessed: portfolios.length,
    positionsOpened,
    positionsClosed,
    pricesUpdated,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getSimulateCopyStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
