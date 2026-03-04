/**
 * FORWARD ADMIN ROUTES
 * 
 * Admin endpoints for Forward Performance management.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ForwardSignalModel } from "../models/forward_signal.model";
import { ForwardOutcomeModel } from "../models/forward_outcome.model";
import { ForwardMetricsModel } from "../models/forward_metrics.model";
import { resolveForwardOutcomes, getResolutionStats } from "../services/forward_outcome_resolver.service";
import { writeSingleForwardSignal } from "../services/forward_snapshot.service";
import { rebuildForwardMetrics, getMetricsSummary, getEquityCurve } from "../services/forward_metrics.service";
import { buildSpxFocusPack } from "../../spx-core/spx-focus-pack.builder";
import spxStrategyService from "../../spx/strategy/spx-strategy.service";

const SPX_HORIZONS = [7, 14, 30, 90, 180, 365];

export async function registerForwardAdminRoutes(fastify: FastifyInstance) {
  const prefix = "/api/forward/admin";

  /**
   * GET /api/forward/admin/signals/latest
   * Get latest forward signals
   */
  fastify.get(`${prefix}/signals/latest`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string; limit?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase();
    const limit = Math.min(Number(query.limit ?? 50), 500);

    const docs = await ForwardSignalModel.find({ asset })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return { ok: true, asset, count: docs.length, items: docs };
  });

  /**
   * GET /api/forward/admin/outcomes/latest
   * Get latest forward outcomes
   */
  fastify.get(`${prefix}/outcomes/latest`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string; limit?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase();
    const limit = Math.min(Number(query.limit ?? 50), 500);

    const docs = await ForwardOutcomeModel.find({ asset })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return { ok: true, asset, count: docs.length, items: docs };
  });

  /**
   * POST /api/forward/admin/outcomes/resolve
   * Manually trigger outcome resolution
   */
  fastify.post(`${prefix}/outcomes/resolve`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string; limit?: string; useNearest?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase() as "SPX" | "BTC";
    const limit = Number(query.limit ?? 250);
    const useNearestCandle = String(query.useNearest ?? "true") === "true";

    const result = await resolveForwardOutcomes({ asset, limit, useNearestCandle });
    return result;
  });

  /**
   * GET /api/forward/admin/stats
   * Get forward performance statistics
   */
  fastify.get(`${prefix}/stats`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase() as "SPX" | "BTC";

    const stats = await getResolutionStats(asset);
    return { ok: true, ...stats };
  });

  /**
   * POST /api/forward/admin/snapshot/write
   * Write forward signals for current date (all horizons)
   */
  fastify.post(`${prefix}/snapshot/write`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase();

    if (asset !== "SPX") {
      return reply.code(400).send({ ok: false, error: "Only SPX supported for now" });
    }

    const results: Array<{ horizon: number; created: boolean; skipped: boolean; error?: string }> = [];

    // Write signals for each horizon
    for (const horizonDays of SPX_HORIZONS) {
      try {
        const horizonKey = `${horizonDays}d` as any;
        
        // Get focus pack for this horizon
        const focusPack = await buildSpxFocusPack(horizonKey);
        
        // Extract stats from overlay
        const stats = focusPack.overlay?.stats || {};
        
        // Get strategy for this horizon
        const strategy = await spxStrategyService.resolveSpxStrategy({
          forecastReturn: (stats.medianReturn ?? 0) / 100,
          probUp: stats.hitRate ?? 0.5,
          entropy: focusPack.diagnostics?.entropy ?? 0.5,
          tailRisk: (stats.p10Return ?? 0) / 100,
          volRegime: focusPack.volatility?.regime || "NORMAL",
          phase: focusPack.phase?.phase || "UNKNOWN",
          preset: "BALANCED",
          horizon: horizonKey,
        });

        const asOfDate = focusPack.meta?.asOf || new Date().toISOString().slice(0, 10);

        const result = await writeSingleForwardSignal({
          asset: "SPX",
          asOfDate,
          horizonDays,
          signalAction: strategy.action,
          forecastReturn: (stats.medianReturn ?? 0) / 100,
          probUp: stats.hitRate ?? 0.5,
          entropy: focusPack.diagnostics?.entropy ?? 0.5,
          similarity: (focusPack.diagnostics?.similarity ?? 0) / 100,
          hybridWeight: 0,
          phaseTag: focusPack.phase?.phase || "UNKNOWN",
          volRegime: focusPack.volatility?.regime || "NORMAL",
          constitutionHash: "v1",
          modelVersion: "SPX_V1",
        });

        results.push({ horizon: horizonDays, ...result });
      } catch (e: any) {
        results.push({ horizon: horizonDays, created: false, skipped: false, error: e.message });
      }
    }

    const created = results.filter(r => r.created).length;
    const skipped = results.filter(r => r.skipped).length;
    const errors = results.filter(r => r.error).length;

    return {
      ok: true,
      asset,
      summary: { created, skipped, errors, total: SPX_HORIZONS.length },
      details: results,
    };
  });

  /**
   * GET /api/forward/admin/metrics
   * Get aggregated metrics by horizon
   */
  fastify.get(`${prefix}/metrics`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase();

    const metrics = await ForwardMetricsModel.find({ asset }).lean();
    return { ok: true, asset, metrics };
  });

  /**
   * POST /api/forward/admin/metrics/rebuild
   * FP4: Rebuild metrics from outcomes (upsert, no duplication)
   */
  fastify.post(`${prefix}/metrics/rebuild`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase() as "SPX" | "BTC";

    if (asset !== "SPX" && asset !== "BTC") {
      return reply.code(400).send({ ok: false, error: "asset must be SPX or BTC" });
    }

    try {
      const result = await rebuildForwardMetrics({ asset });
      return { ok: true, metrics: result };
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  /**
   * GET /api/forward/metrics/summary
   * FP4: Get production-ready metrics summary
   */
  fastify.get("/api/forward/metrics/summary", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string; horizon?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase() as "SPX" | "BTC";

    if (asset !== "SPX" && asset !== "BTC") {
      return reply.code(400).send({ ok: false, error: "asset must be SPX or BTC" });
    }

    const summary = await getMetricsSummary(asset);
    if (!summary) {
      return reply.code(404).send({ ok: false, error: "No metrics found. Run rebuild first." });
    }

    // Optional: filter by horizon
    const horizon = query.horizon;
    if (horizon) {
      const days = parseInt(horizon.replace("d", ""));
      const filtered = summary.byHorizon.find(h => h.horizonDays === days);
      if (!filtered) {
        return reply.code(404).send({ ok: false, error: `No metrics for horizon ${horizon}` });
      }
      return { ok: true, asset, horizon, metrics: filtered };
    }

    return { ok: true, ...summary };
  });

  /**
   * GET /api/forward/equity
   * FP6: Get equity curve for visualization
   */
  fastify.get("/api/forward/equity", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { asset?: string; horizon?: string };
    const asset = String(query.asset ?? "SPX").toUpperCase() as "SPX" | "BTC";

    if (asset !== "SPX" && asset !== "BTC") {
      return reply.code(400).send({ ok: false, error: "asset must be SPX or BTC" });
    }

    const horizonDays = query.horizon ? parseInt(query.horizon.replace("d", "")) : undefined;

    try {
      const curve = await getEquityCurve({ asset, horizonDays });
      return { ok: true, ...curve };
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  console.log("[Forward Admin] Routes registered at /api/forward/admin/*");
}
