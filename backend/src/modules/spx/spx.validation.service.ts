/**
 * SPX TERMINAL — Validation Service
 * 
 * BLOCK B3 — Data integrity validation + gap audit
 */

import { SpxCandleModel } from './spx.mongo.js';
import type { SpxCohort } from './spx.types.js';

interface ValidationResult {
  ok: boolean;
  cohort: string;
  count: number;
  range: { from: string; to: string } | null;
  badOHLC: number;
  outliers: number;
  issues: string[];
}

/**
 * Validate SPX data integrity
 */
export async function validateSpxData(options: { cohort?: SpxCohort } = {}): Promise<ValidationResult> {
  const { cohort } = options;
  const q: any = {};
  if (cohort) q.cohort = cohort;

  const issues: string[] = [];

  // Get range
  const first = await SpxCandleModel.findOne(q).sort({ ts: 1 }).lean();
  const last = await SpxCandleModel.findOne(q).sort({ ts: -1 }).lean();
  const count = await SpxCandleModel.countDocuments(q);

  // Check for bad OHLC (L > H, O/C outside H/L)
  const badOHLC = await SpxCandleModel.countDocuments({
    ...q,
    $or: [
      { $expr: { $gt: ['$low', '$high'] } },
      { $expr: { $gt: ['$open', '$high'] } },
      { $expr: { $lt: ['$open', '$low'] } },
      { $expr: { $gt: ['$close', '$high'] } },
      { $expr: { $lt: ['$close', '$low'] } },
    ],
  });

  if (badOHLC > 0) {
    issues.push(`Found ${badOHLC} candles with invalid OHLC`);
  }

  // Check for extreme daily moves (>12% |daily return|)
  const outliers = await SpxCandleModel.countDocuments({
    ...q,
    $expr: {
      $gt: [
        { $abs: { $divide: [{ $subtract: ['$close', '$open'] }, '$open'] } },
        0.12,
      ],
    },
  });

  if (outliers > 0) {
    issues.push(`Found ${outliers} candles with >12% daily move (may be valid)`);
  }

  // Check for duplicates
  const dupCheck = await SpxCandleModel.aggregate([
    { $match: q },
    { $group: { _id: '$ts', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicates' },
  ]);
  
  const duplicates = dupCheck[0]?.duplicates ?? 0;
  if (duplicates > 0) {
    issues.push(`Found ${duplicates} duplicate timestamps`);
  }

  return {
    ok: issues.length === 0,
    cohort: cohort ?? 'ALL',
    count,
    range: first && last 
      ? { from: first.date, to: last.date }
      : null,
    badOHLC,
    outliers,
    issues,
  };
}

/**
 * Audit gaps in SPX data
 */
export async function auditSpxGaps(options: { cohort?: SpxCohort } = {}) {
  const { cohort } = options;
  const q: any = {};
  if (cohort) q.cohort = cohort;

  const rows = await SpxCandleModel.find(q, { ts: 1, date: 1 }).sort({ ts: 1 }).lean();
  
  if (rows.length < 2) {
    return { ok: true, cohort: cohort ?? 'ALL', gaps: [], note: 'not_enough_data' };
  }

  const day = 24 * 60 * 60 * 1000;
  const gaps: Array<{ from: string; to: string; days: number }> = [];

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].ts;
    const cur = rows[i].ts;
    const deltaDays = Math.round((cur - prev) / day);

    // 1 day = ok, 2-3 often weekends, >3 interesting
    if (deltaDays > 3) {
      gaps.push({
        from: rows[i - 1].date,
        to: rows[i].date,
        days: deltaDays,
      });
    }
  }

  // Sort by largest gaps first
  gaps.sort((a, b) => b.days - a.days);

  return {
    ok: true,
    cohort: cohort ?? 'ALL',
    totalPoints: rows.length,
    worstGaps: gaps.slice(0, 20),
    totalLargeGaps: gaps.length,
  };
}

/**
 * Get SPX stats (count, range, cohorts)
 */
export async function getSpxStats() {
  const count = await SpxCandleModel.countDocuments({});
  const first = await SpxCandleModel.findOne({}).sort({ ts: 1 }).lean();
  const last = await SpxCandleModel.findOne({}).sort({ ts: -1 }).lean();

  // Cohort breakdown
  const cohortPipeline = [
    { $group: { _id: '$cohort', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];
  const cohortResults = await SpxCandleModel.aggregate(cohortPipeline);
  
  const cohorts: Record<string, number> = {};
  for (const r of cohortResults) {
    cohorts[r._id] = r.count;
  }

  return {
    ok: true,
    count,
    range: first && last 
      ? { from: first.date, to: last.date }
      : null,
    cohorts,
  };
}
