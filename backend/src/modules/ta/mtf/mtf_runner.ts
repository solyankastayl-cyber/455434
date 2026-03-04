/**
 * Phase M: MTF Runner
 * 
 * Orchestrates 3 single-TF runs and aggregates into MTF decision
 */

import { Db } from 'mongodb';
import { buildMTFDecision } from './mtf_aggregator.js';
import { MTFConfig, MTFDecisionPack, MTFRunDoc, MTFDecisionDoc } from './mtf_types.js';
import { toBinanceInterval } from './tf_map.js';

export interface MTFRunnerParams {
  db: Db;
  decisionService: (args: { asset: string; timeframe: string }) => Promise<any>;
  cfg: MTFConfig;
  asset: string;
}

/**
 * Run MTF analysis
 */
export async function runMTF(params: MTFRunnerParams): Promise<MTFDecisionPack> {
  const { db, decisionService, cfg, asset } = params;

  // Convert TF config to Binance intervals
  const biasTF = toBinanceInterval(cfg.tfBias);
  const setupTF = toBinanceInterval(cfg.tfSetup);
  const trigTF = toBinanceInterval(cfg.tfTrigger);

  console.log(`[MTF] Running for ${asset}: bias=${biasTF}, setup=${setupTF}, trigger=${trigTF}`);

  // Run single-TF decisions in parallel
  const [biasPack, setupPack, triggerPack] = await Promise.all([
    decisionService({ asset, timeframe: biasTF }),
    decisionService({ asset, timeframe: setupTF }),
    decisionService({ asset, timeframe: trigTF }),
  ]);

  // Build MTF decision
  const mtf = buildMTFDecision(cfg, {
    asset,
    biasPack,
    setupPack,
    triggerPack,
  });

  // Immutable audit inserts
  const runDoc: MTFRunDoc = {
    mtfRunId: mtf.audit.mtfRunId,
    asset,
    createdAt: new Date(),
    cfg,
    biasRunId: mtf.audit.biasRunId,
    setupRunId: mtf.audit.setupRunId,
    triggerRunId: mtf.audit.triggerRunId,
  };

  const decisionDoc: MTFDecisionDoc = {
    mtfRunId: mtf.audit.mtfRunId,
    asset,
    createdAt: new Date(),
    decision: mtf,
  };

  await db.collection('ta_mtf_runs').insertOne(runDoc);
  await db.collection('ta_mtf_decisions').insertOne(decisionDoc);

  console.log(`[MTF] Completed ${mtf.audit.mtfRunId} with ${mtf.scenarios.length} scenarios, topBias=${mtf.topBias}`);

  return mtf;
}

/**
 * Initialize MTF indexes
 */
export async function initMTFIndexes(db: Db): Promise<void> {
  try {
    await db.collection('ta_mtf_runs').createIndex(
      { mtfRunId: 1 },
      { unique: true, background: true }
    );
    await db.collection('ta_mtf_runs').createIndex(
      { asset: 1, createdAt: -1 },
      { background: true }
    );
    await db.collection('ta_mtf_decisions').createIndex(
      { mtfRunId: 1 },
      { unique: true, background: true }
    );
    await db.collection('ta_mtf_decisions').createIndex(
      { asset: 1, createdAt: -1 },
      { background: true }
    );
    console.log('[MTF] Indexes initialized');
  } catch (err) {
    console.error('[MTF] Failed to create indexes:', err);
  }
}

/**
 * Get latest MTF decision for asset
 */
export async function getLatestMTFDecision(
  db: Db,
  asset: string
): Promise<MTFDecisionDoc | null> {
  return await db.collection('ta_mtf_decisions')
    .findOne(
      { asset },
      { sort: { createdAt: -1 }, projection: { _id: 0 } }
    ) as MTFDecisionDoc | null;
}

/**
 * Get MTF decision by run ID
 */
export async function getMTFDecisionByRunId(
  db: Db,
  mtfRunId: string
): Promise<MTFDecisionDoc | null> {
  return await db.collection('ta_mtf_decisions')
    .findOne(
      { mtfRunId },
      { projection: { _id: 0 } }
    ) as MTFDecisionDoc | null;
}

/**
 * List recent MTF runs
 */
export async function listMTFRuns(
  db: Db,
  asset: string,
  limit = 20
): Promise<MTFRunDoc[]> {
  return await db.collection('ta_mtf_runs')
    .find({ asset })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ _id: 0 })
    .toArray() as MTFRunDoc[];
}
