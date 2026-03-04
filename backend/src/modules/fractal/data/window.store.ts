/**
 * BLOCK 16.2: Window Store
 * Manages fractal_windows collection for ML dataset
 */

import { FractalWindowModel } from './schemas/fractal-window.schema.js';

export class WindowStore {
  /**
   * Upsert a window feature record
   */
  async upsertWindow(doc: any): Promise<void> {
    await FractalWindowModel.updateOne(
      {
        'meta.symbol': doc.meta.symbol,
        'meta.timeframe': doc.meta.timeframe,
        'meta.windowLen': doc.meta.windowLen,
        'meta.horizonDays': doc.meta.horizonDays,
        windowEndTs: doc.windowEndTs
      },
      { $set: doc },
      { upsert: true }
    );
  }

  /**
   * Find unlabeled windows for label resolution
   */
  async findUnlabeled(limit: number): Promise<any[]> {
    return FractalWindowModel.find({ 'label.ready': false })
      .sort({ windowEndTs: 1 })
      .limit(limit)
      .lean();
  }

  /**
   * Mark window as checked (for skipped records)
   */
  async markChecked(id: any): Promise<void> {
    await FractalWindowModel.updateOne(
      { _id: id },
      { $set: { lastCheckedAt: new Date() } }
    );
  }

  /**
   * Set label for a window
   */
  async setLabel(id: any, label: any): Promise<void> {
    await FractalWindowModel.updateOne(
      { _id: id },
      { $set: { label } }
    );
  }

  /**
   * Count all windows
   */
  async countAll(): Promise<number> {
    return FractalWindowModel.countDocuments({});
  }

  /**
   * Count labeled windows
   */
  async countLabeled(): Promise<number> {
    return FractalWindowModel.countDocuments({ 'label.ready': true });
  }

  /**
   * Get dataset stats
   */
  async getStats(): Promise<{
    total: number;
    labeled: number;
    unlabeled: number;
    byWindowLen: Record<number, number>;
  }> {
    const total = await this.countAll();
    const labeled = await this.countLabeled();

    // Aggregate by windowLen
    const byWindowLenAgg = await FractalWindowModel.aggregate([
      { $group: { _id: '$meta.windowLen', count: { $sum: 1 } } }
    ]);

    const byWindowLen: Record<number, number> = {};
    for (const row of byWindowLenAgg) {
      byWindowLen[row._id] = row.count;
    }

    return {
      total,
      labeled,
      unlabeled: total - labeled,
      byWindowLen
    };
  }
}
