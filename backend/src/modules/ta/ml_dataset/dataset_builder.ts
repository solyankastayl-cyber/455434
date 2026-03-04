/**
 * Phase K: Dataset Builder
 * 
 * Builds ML dataset from ta_runs, ta_scenarios, ta_outcomes collections
 */

import { Db } from 'mongodb';
import { MLRow, DatasetBuildOptions, DatasetBuildResult } from './dataset_types.js';
import { extractFeatures, isValidRow, sanitizeRow } from './feature_extractor.js';

/**
 * Build ML dataset from MongoDB collections
 */
export async function buildDataset(params: {
  db: Db;
  options?: DatasetBuildOptions;
}): Promise<DatasetBuildResult> {
  const { db, options = {} } = params;
  const {
    asset,
    timeframe,
    limit = 5000,
    minScore = 0,
    includeTimeout = false,
  } = options;

  const rows: MLRow[] = [];
  const stats = {
    totalRuns: 0,
    totalScenarios: 0,
    totalOutcomes: 0,
    wins: 0,
    losses: 0,
    timeouts: 0,
    skipped: 0,
    finalRows: 0,
  };

  // Build query filter
  const runFilter: any = {};
  if (asset) runFilter.asset = asset;
  if (timeframe) runFilter.timeframe = timeframe;

  // Fetch runs
  const runs = await db.collection('ta_runs')
    .find(runFilter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  stats.totalRuns = runs.length;

  // Process each run
  for (const run of runs) {
    // Get scenarios for this run
    const scenarios = await db.collection('ta_scenarios')
      .find({ runId: run.runId })
      .toArray();

    stats.totalScenarios += scenarios.length;

    for (const scenario of scenarios) {
      // Get outcome for this scenario
      const outcome = await db.collection('ta_outcomes').findOne({
        runId: run.runId,
        scenarioId: scenario.scenarioId || scenario.id,
      }) || await db.collection('ta_outcomes').findOne({
        runId: run.runId,
        patternId: scenario.scenarioId || scenario.id,
      });

      if (!outcome) {
        stats.skipped++;
        continue;
      }

      stats.totalOutcomes++;

      // Check outcome status
      const status = outcome.result || outcome.status;
      
      if (status === 'WIN') {
        stats.wins++;
      } else if (status === 'LOSS') {
        stats.losses++;
      } else if (status === 'TIMEOUT') {
        stats.timeouts++;
        if (!includeTimeout) {
          stats.skipped++;
          continue;
        }
      } else {
        // PENDING, SKIPPED, etc.
        stats.skipped++;
        continue;
      }

      // Extract features
      try {
        let row = extractFeatures({ run, scenario, outcome });
        row = sanitizeRow(row);

        // Filter by min score
        if (row.score < minScore) {
          stats.skipped++;
          continue;
        }

        // Validate row
        if (!isValidRow(row)) {
          stats.skipped++;
          continue;
        }

        rows.push(row);
      } catch (err) {
        console.warn(`[ML Dataset] Failed to extract features for scenario ${scenario.scenarioId}:`, err);
        stats.skipped++;
      }
    }
  }

  stats.finalRows = rows.length;

  return {
    ok: true,
    rows,
    stats,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get dataset statistics without building full dataset
 */
export async function getDatasetStats(params: {
  db: Db;
  asset?: string;
  timeframe?: string;
}): Promise<{
  runsCount: number;
  scenariosCount: number;
  outcomesCount: number;
  winsCount: number;
  lossesCount: number;
  pendingCount: number;
}> {
  const { db, asset, timeframe } = params;

  const runFilter: any = {};
  if (asset) runFilter.asset = asset;
  if (timeframe) runFilter.timeframe = timeframe;

  const runsCount = await db.collection('ta_runs').countDocuments(runFilter);
  const scenariosCount = await db.collection('ta_scenarios').countDocuments();
  const outcomesCount = await db.collection('ta_outcomes').countDocuments();

  const winsCount = await db.collection('ta_outcomes').countDocuments({
    $or: [{ result: 'WIN' }, { status: 'WIN' }]
  });

  const lossesCount = await db.collection('ta_outcomes').countDocuments({
    $or: [{ result: 'LOSS' }, { status: 'LOSS' }]
  });

  const pendingCount = await db.collection('ta_outcomes').countDocuments({
    $or: [{ result: 'PENDING' }, { status: 'PENDING' }]
  });

  return {
    runsCount,
    scenariosCount,
    outcomesCount,
    winsCount,
    lossesCount,
    pendingCount,
  };
}
