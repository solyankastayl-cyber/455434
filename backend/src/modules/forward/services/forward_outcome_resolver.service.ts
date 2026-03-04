/**
 * FORWARD OUTCOME RESOLVER SERVICE
 * 
 * Resolves forward signals by comparing predictions to actual candle data.
 * Runs in daily-run Step 2 (OUTCOME_RESOLVE).
 */
import { ForwardSignalModel } from "../models/forward_signal.model";
import { ForwardOutcomeModel } from "../models/forward_outcome.model";
import { computeTargetDate, getCandleAtOrBefore, getLatestCandleDate } from "./candle_source.service";

type ResolveOptions = {
  asset: "SPX" | "BTC";
  limit?: number;
  useNearestCandle?: boolean;
};

function directionFromReturn(r: number): "UP" | "DOWN" | "FLAT" {
  const eps = 1e-6;
  if (r > eps) return "UP";
  if (r < -eps) return "DOWN";
  return "FLAT";
}

function isHit(action: string, realizedDir: "UP" | "DOWN" | "FLAT"): boolean | null {
  // BUY = hit if UP
  // REDUCE = hit if DOWN (risk reduction was justified)
  // HOLD = neutral, no hit calculation
  if (action === "HOLD") return null;
  if (action === "BUY") return realizedDir === "UP";
  if (action === "REDUCE") return realizedDir === "DOWN";
  return null;
}

export async function resolveForwardOutcomes(opts: ResolveOptions) {
  const { asset, limit = 250, useNearestCandle = true } = opts;

  // Get latest candle date to know what can be resolved
  const latestCandleDate = await getLatestCandleDate(asset);
  if (!latestCandleDate) {
    return {
      ok: false,
      error: `No candle data available for ${asset}`,
      asset,
      attempted: 0,
      resolved: 0,
      skippedNoData: 0,
      skippedExists: 0,
      skippedFuture: 0,
    };
  }

  // Get signals that don't have outcomes yet
  const signals = await ForwardSignalModel.find({ asset })
    .sort({ asOfDate: -1 })
    .limit(limit)
    .lean();

  let attempted = 0;
  let resolved = 0;
  let skippedNoData = 0;
  let skippedExists = 0;
  let skippedFuture = 0;

  for (const s of signals) {
    attempted++;

    // Check if outcome already exists
    const exists = await ForwardOutcomeModel.findOne({ asset, signalId: s._id }).lean();
    if (exists) {
      skippedExists++;
      continue;
    }

    const asOfDate = String(s.asOfDate);
    const horizonDays = Number(s.horizonDays);
    const targetDate = computeTargetDate(asOfDate, horizonDays);

    // Skip if target date is in the future
    if (targetDate > latestCandleDate) {
      skippedFuture++;
      continue;
    }

    // Get entry candle (at signal date)
    const entryCandle = await getCandleAtOrBefore({
      asset,
      targetDate: asOfDate,
      useNearest: true,
    });

    // Get exit candle (at resolution date)
    const exitCandle = await getCandleAtOrBefore({
      asset,
      targetDate,
      useNearest: useNearestCandle,
    });

    if (!entryCandle || !exitCandle) {
      skippedNoData++;
      continue;
    }

    const entry = Number(entryCandle.close);
    const exit = Number(exitCandle.close);

    if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry === 0) {
      skippedNoData++;
      continue;
    }

    const realizedReturn = (exit / entry) - 1; // decimal
    const realizedDirection = directionFromReturn(realizedReturn);
    const hit = isHit(String(s.signalAction), realizedDirection);

    try {
      await ForwardOutcomeModel.create({
        asset,
        signalId: s._id,
        asOfDate,
        horizonDays,
        resolvedAt: exitCandle.date,
        realizedReturn,
        realizedDirection,
        hit,
        sources: {
          candles: asset === "SPX" ? "spx_candles" : "btc_candles",
        },
      });
      resolved++;
    } catch (e: any) {
      // Unique constraint violation - already exists
      if (String(e?.code) === "11000") {
        skippedExists++;
        continue;
      }
      console.error(`[OutcomeResolver] Error creating outcome for signal ${s._id}:`, e.message);
    }
  }

  return {
    ok: true,
    asset,
    latestCandleDate,
    attempted,
    resolved,
    skippedExists,
    skippedNoData,
    skippedFuture,
  };
}

/**
 * Get resolution statistics for an asset
 */
export async function getResolutionStats(asset: "SPX" | "BTC") {
  const totalSignals = await ForwardSignalModel.countDocuments({ asset });
  const totalOutcomes = await ForwardOutcomeModel.countDocuments({ asset });
  const pendingSignals = totalSignals - totalOutcomes;

  const hitCount = await ForwardOutcomeModel.countDocuments({ asset, hit: true });
  const missCount = await ForwardOutcomeModel.countDocuments({ asset, hit: false });
  const neutralCount = await ForwardOutcomeModel.countDocuments({ asset, hit: null });

  const hitRate = (hitCount + missCount) > 0 
    ? hitCount / (hitCount + missCount) 
    : null;

  return {
    asset,
    totalSignals,
    totalOutcomes,
    pendingSignals,
    hitCount,
    missCount,
    neutralCount,
    hitRate,
  };
}
