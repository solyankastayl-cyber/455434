/**
 * VERDICT API ROUTES (Fastify)
 * ============================
 * 
 * POST /api/verdict/evaluate - Preview verdict (no persistence)
 * POST /api/verdict/commit - Create verdict + forecast
 * GET /api/verdict/open - List open verdicts
 * GET /api/verdict/:id - Get verdict by ID
 * 
 * Block 1: Added health state persistence in forecast for Evolution.
 */

import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { VerdictEngineImpl } from "../runtime/verdict.engine.impl.js";
import { VerdictModel } from "../storage/verdict.model.js";
import { VerdictForecastModel } from "../storage/forecast.model.js";
import { genId } from "../runtime/utils.js";
import type { VerdictContext, Horizon } from "../contracts/verdict.types.js";

interface VerdictPluginOpts extends FastifyPluginOptions {
  engine?: VerdictEngineImpl;
}

function horizonToDays(h: Horizon): number {
  if (h === "1D") return 1;
  if (h === "7D") return 7;
  return 30;
}

function addDays(tsIso: string, days: number): string {
  const t = new Date(tsIso).getTime();
  return new Date(t + days * 86400000).toISOString();
}

async function verdictRoutes(fastify: FastifyInstance, opts: VerdictPluginOpts): Promise<void> {
  const engine = opts.engine ?? new VerdictEngineImpl();

  // POST /api/verdict/evaluate - Preview verdict
  fastify.post("/api/verdict/evaluate", async (req, reply) => {
    try {
      const ctx = req.body as VerdictContext;
      const verdict = await engine.evaluate(ctx);
      return { ok: true, verdict };
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(400).send({ ok: false, error: e?.message || "evaluate_failed" });
    }
  });

  // POST /api/verdict/commit - Create verdict + forecast
  fastify.post("/api/verdict/commit", async (req, reply) => {
    try {
      const ctx = req.body as VerdictContext;
      const verdict = await engine.evaluate(ctx);

      // Persist verdict
      await VerdictModel.create({ ...verdict, status: "OPEN" });

      // Create forecast if action is not HOLD
      let forecastId: string | null = null;
      if (verdict.action !== "HOLD") {
        forecastId = genId("fc");
        const resolveAtTs = addDays(verdict.ts, horizonToDays(verdict.horizon));

        // Block 1: Include health state and snapshot in forecast
        const forecastData: any = {
          forecastId,
          verdictId: verdict.verdictId,
          symbol: verdict.symbol,
          horizon: verdict.horizon,
          entryTs: verdict.ts,
          resolveAtTs,
          entryPrice: ctx.snapshot.price,
          expectedReturn: verdict.expectedReturn,
          action: verdict.action,
          status: "OPEN",
        };

        // Block 1: Add health state if available
        if (verdict.health) {
          forecastData.healthState = verdict.health.state;
          forecastData.healthSnapshot = {
            modifier: verdict.health.modifier,
            ece: verdict.health.ece,
            divergence: verdict.health.divergence,
            criticalStreak: verdict.health.criticalStreak,
            capturedAt: new Date().toISOString(),
          };

          console.log(
            `[Verdict] Forecast ${forecastId} created with health=${verdict.health.state}, ` +
            `modifier=${verdict.health.modifier}`
          );
        }

        await VerdictForecastModel.create(forecastData);
      }

      return { ok: true, verdict, forecastId };
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(400).send({ ok: false, error: e?.message || "commit_failed" });
    }
  });

  // GET /api/verdict/open - List open verdicts
  fastify.get("/api/verdict/open", async (req, reply) => {
    try {
      const { symbol } = req.query as { symbol?: string };
      const query: any = { status: "OPEN" };
      if (symbol) query.symbol = symbol;

      const verdicts = await VerdictModel.find(query).sort({ createdAt: -1 }).limit(100).lean();
      return { ok: true, count: verdicts.length, verdicts };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/verdict/:id - Get verdict by ID
  fastify.get("/api/verdict/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const verdict = await VerdictModel.findOne({ verdictId: id }).lean();
      
      if (!verdict) {
        return reply.status(404).send({ ok: false, error: "Verdict not found" });
      }

      // Get associated forecast
      const forecast = await VerdictForecastModel.findOne({ verdictId: id }).lean();

      return { ok: true, verdict, forecast };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  console.log("[Verdict] API routes registered (Block 1: health persistence enabled)");
}

export default verdictRoutes;
