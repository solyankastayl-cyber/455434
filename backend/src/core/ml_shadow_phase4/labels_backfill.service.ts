/**
 * PHASE 4 - БЛОК 4.4: Labels Backfill Service
 * 
 * Periodically updates price_outcomes with real market data
 * 
 * CRITICAL: Read-only observation, NO influence on Engine
 */
import { SignalModel } from '../signals/signals.model.js';
import { PriceOutcomeModel } from './price_outcome.model.js';
import { PriceProvider, classifyOutcome } from './price_service.interface.js';
import { coinGeckoPriceProvider } from './coingecko_price_provider.service.js';

export class LabelsBackfillService {
  private priceProvider: PriceProvider;

  constructor(priceProvider?: PriceProvider) {
    this.priceProvider = priceProvider || coinGeckoPriceProvider;
  }

  /**
   * Backfill labels for signals
   * 
   * Process:
   * 1. Find signals without outcomes
   * 2. Check if enough time passed (24h or 7d)
   * 3. Fetch prices and calculate labels
   * 4. Store in price_outcomes (idempotent)
   */
  async backfillLabels(window: '24h' | '7d', limit: number = 100): Promise<{
    processed: number;
    updated: number;
    skipped: number;
    errors: number;
  }> {
    const stats = {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    try {
      // Calculate time threshold
      const now = new Date();
      const windowMs = window === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      const thresholdDate = new Date(now.getTime() - windowMs);

      // Find signals that need outcome labels
      const signals = await SignalModel
        .find({
          createdAt: { $lte: thresholdDate },
          entityType: 'token',
          entityId: { $exists: true },
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec();

      console.log(`[LabelsBackfill] Processing ${signals.length} signals for ${window} window`);

      for (const signal of signals) {
        stats.processed++;

        try {
          const tokenId = signal.entityId;
          const t0 = signal.createdAt || signal.triggeredAt || new Date();
          const outcomeTime = new Date(t0.getTime() + windowMs);

          // Check if outcome already exists
          const existing = await PriceOutcomeModel.findOne({
            tokenId,
            t0,
          }).exec();

          const windowField = window === '24h' ? 'outcome24h' : 'outcome7d';

          if (existing && existing[windowField]) {
            stats.skipped++;
            continue;
          }

          // Get prices
          const price0 = await this.priceProvider.getPrice(tokenId, t0);
          if (!price0) {
            console.log(`[LabelsBackfill] No price at t0 for ${tokenId}`);
            stats.skipped++;
            continue;
          }

          const priceOutcome = await this.priceProvider.getPrice(tokenId, outcomeTime);
          if (!priceOutcome) {
            console.log(`[LabelsBackfill] No price at outcome for ${tokenId}`);
            stats.skipped++;
            continue;
          }

          // Calculate return and label
          const returnPct = ((priceOutcome - price0) / price0) * 100;
          const label = classifyOutcome(returnPct);

          // Upsert outcome
          const outcome = {
            timestamp: outcomeTime,
            price: priceOutcome,
            returnPct,
            label,
          };

          if (existing) {
            // Update existing
            existing[windowField] = outcome;
            existing.verified = true;
            await existing.save();
          } else {
            // Create new
            await PriceOutcomeModel.create({
              tokenId,
              symbol: signal.entityId?.slice(0, 10) || 'UNKNOWN',
              t0,
              price0,
              [windowField]: outcome,
              source: this.priceProvider.getName().toLowerCase(),
              verified: true,
              signalId: signal._id.toString(),
            });
          }

          stats.updated++;
          
          console.log(
            `[LabelsBackfill] ${window} label for ${tokenId}: ${label} (${returnPct.toFixed(2)}%)`
          );
        } catch (error) {
          console.error(`[LabelsBackfill] Error processing signal ${signal._id}:`, error);
          stats.errors++;
        }
      }

      console.log(`[LabelsBackfill] ${window} backfill complete:`, stats);
      return stats;
    } catch (error) {
      console.error(`[LabelsBackfill] Fatal error:`, error);
      throw error;
    }
  }

  /**
   * Run full backfill for both windows
   */
  async runFullBackfill(limit: number = 100): Promise<void> {
    console.log('[LabelsBackfill] Starting full backfill...');
    
    await this.backfillLabels('24h', limit);
    await this.backfillLabels('7d', limit);
    
    console.log('[LabelsBackfill] Full backfill complete');
  }

  /**
   * Get backfill status
   */
  async getStatus(): Promise<{
    totalOutcomes: number;
    with24h: number;
    with7d: number;
    withBoth: number;
  }> {
    const totalOutcomes = await PriceOutcomeModel.countDocuments();
    const with24h = await PriceOutcomeModel.countDocuments({ 'outcome24h.label': { $exists: true } });
    const with7d = await PriceOutcomeModel.countDocuments({ 'outcome7d.label': { $exists: true } });
    const withBoth = await PriceOutcomeModel.countDocuments({
      'outcome24h.label': { $exists: true },
      'outcome7d.label': { $exists: true },
    });

    return {
      totalOutcomes,
      with24h,
      with7d,
      withBoth,
    };
  }
}

export const labelsBackfillService = new LabelsBackfillService();
