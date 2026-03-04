/**
 * CANDLE SOURCE SERVICE
 * 
 * Unified access to candle data for Forward Performance resolver.
 * Supports both SPX and BTC (future).
 */
import { SpxCandleModel } from "../../spx/spx.mongo.js";

type Candle = {
  date: string;   // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
};

function ymd(s: string): string {
  return s.slice(0, 10);
}

function addDaysYMD(asOf: string, days: number): string {
  const d = new Date(asOf + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Get candle at or before targetDate.
 * For SPX, uses spx_candles collection.
 */
export async function getCandleAtOrBefore(params: {
  asset: "SPX" | "BTC";
  targetDate: string;
  useNearest?: boolean;
}): Promise<Candle | null> {
  const { asset, targetDate, useNearest = true } = params;

  if (asset !== "SPX") {
    // BTC not implemented yet
    console.warn(`[CandleSource] Asset ${asset} not supported yet`);
    return null;
  }

  // Exact match
  const exact = await SpxCandleModel.findOne({ date: targetDate }).lean();
  if (exact) {
    return {
      date: ymd(exact.date),
      open: Number(exact.open),
      high: Number(exact.high),
      low: Number(exact.low),
      close: Number(exact.close),
    };
  }

  if (!useNearest) return null;

  // Nearest <= targetDate
  const nearest = await SpxCandleModel.findOne({ date: { $lte: targetDate } })
    .sort({ date: -1 })
    .lean();

  if (!nearest) return null;

  return {
    date: ymd(nearest.date),
    open: Number(nearest.open),
    high: Number(nearest.high),
    low: Number(nearest.low),
    close: Number(nearest.close),
  };
}

/**
 * Compute target resolution date
 */
export function computeTargetDate(asOfDate: string, horizonDays: number): string {
  return addDaysYMD(asOfDate, horizonDays);
}

/**
 * Get latest available candle date for asset
 */
export async function getLatestCandleDate(asset: "SPX" | "BTC"): Promise<string | null> {
  if (asset !== "SPX") return null;
  
  const latest = await SpxCandleModel.findOne({})
    .sort({ date: -1 })
    .lean();
  
  return latest?.date ? ymd(latest.date) : null;
}
