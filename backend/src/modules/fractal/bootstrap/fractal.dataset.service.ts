/**
 * BLOCK 26: Dataset Export Service
 * Exports ML-ready dataset (X, y) from MongoDB
 */

import { FractalWindowModel } from '../data/schemas/fractal-window.schema.js';

export interface DatasetRow {
  t: string;
  // Features (X)
  meanLogRet: number;
  volLogRet: number;
  skewLogRet: number;
  kurtLogRet: number;
  slope90: number;
  maxDrawdownInWindow: number;
  avgQuality: number;
  regimeVol: number;
  regimeTrend: number;
  regimeConsistency: number;
  effectiveSampleSize: number;
  topMatchScore: number;
  avgTopKScore: number;
  // Rule-based predictions as features
  rule_p50: number;
  rule_p10: number;
  rule_p90: number;
  // Labels (y)
  y_return: number;
  y_maxdd: number;
  y_vol: number;
  y_up: number;
}

export class FractalDatasetService {
  /**
   * Fetch labeled dataset for ML training
   * @param fromDate - Optional start date (YYYY-MM-DD)
   * @param toDate - Optional end date (YYYY-MM-DD)
   */
  async fetchLabeled(
    symbol = 'BTC',
    limit = 50000,
    fromDate?: string,
    toDate?: string
  ): Promise<DatasetRow[]> {
    const query: any = {
      'meta.symbol': symbol,
      'label.ready': true
    };

    // Add date filters if provided
    if (fromDate || toDate) {
      query.windowEndTs = {};
      if (fromDate) {
        query.windowEndTs.$gte = new Date(fromDate);
      }
      if (toDate) {
        query.windowEndTs.$lte = new Date(toDate + 'T23:59:59Z');
      }
    }

    const rows = await FractalWindowModel.find(query)
      .sort({ windowEndTs: 1 })
      .limit(limit)
      .lean();

    return rows.map((r: any) => {
      const f = r.features || {};
      const y = r.label || {};
      const pred = r.prediction || {};

      return {
        t: new Date(r.windowEndTs).toISOString().slice(0, 10),

        // X (features)
        meanLogRet: f.meanLogRet ?? 0,
        volLogRet: f.volLogRet ?? 0,
        skewLogRet: f.skewLogRet ?? 0,
        kurtLogRet: f.kurtLogRet ?? 0,
        slope90: f.slope90 ?? 0,
        maxDrawdownInWindow: f.maxDrawdownInWindow ?? 0,
        avgQuality: f.avgQuality ?? 0,
        regimeVol: f.regimeVol ?? 1,
        regimeTrend: f.regimeTrend ?? 0,
        regimeConsistency: f.regimeConsistency ?? 0,
        effectiveSampleSize: f.effectiveSampleSize ?? 0,
        topMatchScore: f.topMatchScore ?? 0,
        avgTopKScore: f.avgTopKScore ?? 0,

        // Rule-based forecasts as features
        rule_p50: pred.p50Return ?? 0,
        rule_p10: pred.p10Return ?? 0,
        rule_p90: pred.p90Return ?? 0,

        // Labels (y)
        y_return: y.forwardReturn ?? 0,
        y_maxdd: y.forwardMaxDD ?? 0,
        y_vol: y.forwardVol ?? 0,
        y_up: (y.forwardReturn ?? 0) >= 0 ? 1 : 0
      };
    });
  }

  /**
   * Get dataset statistics
   */
  async getDatasetStats(symbol = 'BTC'): Promise<{
    total: number;
    labeled: number;
    dateRange: { start: string | null; end: string | null };
    featureMeans: Record<string, number>;
  }> {
    const total = await FractalWindowModel.countDocuments({ 'meta.symbol': symbol });
    const labeled = await FractalWindowModel.countDocuments({
      'meta.symbol': symbol,
      'label.ready': true
    });

    const first = await FractalWindowModel.findOne({ 'meta.symbol': symbol })
      .sort({ windowEndTs: 1 })
      .lean();
    const last = await FractalWindowModel.findOne({ 'meta.symbol': symbol })
      .sort({ windowEndTs: -1 })
      .lean();

    // Calculate feature means from labeled data
    const agg = await FractalWindowModel.aggregate([
      { $match: { 'meta.symbol': symbol, 'label.ready': true } },
      {
        $group: {
          _id: null,
          meanLogRet: { $avg: '$features.meanLogRet' },
          volLogRet: { $avg: '$features.volLogRet' },
          skewLogRet: { $avg: '$features.skewLogRet' },
          topMatchScore: { $avg: '$features.topMatchScore' },
          avgTopKScore: { $avg: '$features.avgTopKScore' }
        }
      }
    ]);

    return {
      total,
      labeled,
      dateRange: {
        start: first ? new Date(first.windowEndTs).toISOString().slice(0, 10) : null,
        end: last ? new Date(last.windowEndTs).toISOString().slice(0, 10) : null
      },
      featureMeans: agg[0] || {}
    };
  }
}
