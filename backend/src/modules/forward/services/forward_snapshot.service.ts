/**
 * FORWARD SNAPSHOT SERVICE
 * 
 * Writes signal snapshots to MongoDB.
 * Idempotent: won't create duplicates for same (asset, asOfDate, horizonDays, constitutionHash).
 */
import { ForwardSignalModel } from "../models/forward_signal.model";

type HorizonData = {
  days?: number;
  horizonDays?: number;
  forecastReturn?: number;
  probUp?: number;
  entropy?: number;
  similarity?: number;
  hybridWeight?: number;
  action?: string;
};

type FocusPackLike = {
  asOfDate?: string;
  diagnostics?: { 
    asOfDate?: string; 
    similarity?: number; 
    entropy?: number;
  };
  horizons?: HorizonData[];
  marketState?: { phase?: string; volRegime?: string };
  phase?: string;
  volRegime?: string;
  constitutionHash?: string;
  modelVersion?: string;
};

type StrategyLike = {
  action: "BUY" | "HOLD" | "REDUCE";
  confidence?: "LOW" | "MEDIUM" | "HIGH";
};

function toDateYMD(input: string | undefined): string {
  if (!input) throw new Error("asOfDate missing");
  return input.slice(0, 10);
}

function normalizeHorizonDays(h: HorizonData): number {
  return Number(h?.horizonDays ?? h?.days ?? 0);
}

export async function writeForwardSnapshots(params: {
  asset: "SPX" | "BTC";
  focusPack: FocusPackLike;
  strategyByHorizon?: Record<number, StrategyLike>;
  globalStrategy?: StrategyLike;
  constitutionHash?: string | null;
  modelVersion?: string | null;
  lifecycleState?: string | null;
  runId?: string | null;
}) {
  const { asset, focusPack } = params;

  const asOfDate = toDateYMD(
    focusPack.asOfDate ?? focusPack.diagnostics?.asOfDate
  );

  const phaseTag =
    focusPack.marketState?.phase ?? focusPack.phase ?? "UNKNOWN";
  const volRegime =
    focusPack.marketState?.volRegime ?? focusPack.volRegime ?? "UNKNOWN";

  const constitutionHash =
    params.constitutionHash ?? focusPack.constitutionHash ?? "v1";
  const modelVersion =
    params.modelVersion ?? focusPack.modelVersion ?? "SPX_V1";

  const horizons = Array.isArray(focusPack.horizons) ? focusPack.horizons : [];
  const created: number[] = [];
  const skipped: number[] = [];

  for (const h of horizons) {
    const horizonDays = normalizeHorizonDays(h);
    if (!horizonDays || !Number.isFinite(horizonDays)) continue;

    const strat =
      params.strategyByHorizon?.[horizonDays] ?? params.globalStrategy;

    const doc = {
      asset,
      asOfDate,
      horizonDays,

      signalAction: strat?.action ?? h.action ?? "HOLD",
      forecastReturn: Number(h.forecastReturn ?? 0),
      probUp: Number(h.probUp ?? 0.5),
      entropy: Number(h.entropy ?? focusPack.diagnostics?.entropy ?? 0.5),
      similarity: Number(h.similarity ?? focusPack.diagnostics?.similarity ?? 0),
      hybridWeight: Number(h.hybridWeight ?? 0),

      phaseTag,
      volRegime,
      constitutionHash,
      modelVersion,

      sources: {
        focusPack: `${asset}_FOCUS_PACK`,
        strategy: `${asset}_STRATEGY_V1`,
      },

      lifecycleState: params.lifecycleState ?? null,
      runId: params.runId ?? null,
    };

    try {
      await ForwardSignalModel.create(doc);
      created.push(horizonDays);
    } catch (e: any) {
      // Unique index violation = duplicate snapshot, skip
      if (String(e?.code) === "11000") {
        skipped.push(horizonDays);
        continue;
      }
      throw e;
    }
  }

  return { asOfDate, created, skipped, totalHorizons: horizons.length };
}

/**
 * Write a single forward signal (for simpler API calls)
 */
export async function writeSingleForwardSignal(params: {
  asset: "SPX" | "BTC";
  asOfDate: string;
  horizonDays: number;
  signalAction: string;
  forecastReturn: number;
  probUp: number;
  entropy: number;
  similarity: number;
  hybridWeight?: number;
  phaseTag?: string;
  volRegime?: string;
  constitutionHash?: string;
  modelVersion?: string;
  lifecycleState?: string;
  runId?: string;
}): Promise<{ created: boolean; skipped: boolean; error?: string }> {
  try {
    await ForwardSignalModel.create({
      asset: params.asset,
      asOfDate: params.asOfDate.slice(0, 10),
      horizonDays: params.horizonDays,
      signalAction: params.signalAction,
      forecastReturn: params.forecastReturn,
      probUp: params.probUp,
      entropy: params.entropy,
      similarity: params.similarity,
      hybridWeight: params.hybridWeight ?? 0,
      phaseTag: params.phaseTag ?? "UNKNOWN",
      volRegime: params.volRegime ?? "UNKNOWN",
      constitutionHash: params.constitutionHash ?? "v1",
      modelVersion: params.modelVersion ?? "SPX_V1",
      sources: {
        focusPack: `${params.asset}_FOCUS_PACK`,
        strategy: `${params.asset}_STRATEGY_V1`,
      },
      lifecycleState: params.lifecycleState ?? null,
      runId: params.runId ?? null,
    });
    return { created: true, skipped: false };
  } catch (e: any) {
    if (String(e?.code) === "11000") {
      return { created: false, skipped: true };
    }
    return { created: false, skipped: false, error: e.message };
  }
}
