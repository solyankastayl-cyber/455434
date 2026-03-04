/**
 * EVOLUTION API ROUTES (Fastify)
 * ==============================
 * 
 * POST /api/admin/evolution/run-outcome-job - Manually trigger outcome job
 * GET /api/admin/evolution/credibility - Get all credibility states
 * GET /api/admin/evolution/credibility/:symbol - Get credibility for symbol
 * GET /api/admin/evolution/outcomes - Get recent outcomes
 * GET /api/admin/evolution/forecasts/open - Get open forecasts
 */

import { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { OutcomeService } from "../runtime/outcome.service.js";
import type { CredibilityService } from "../runtime/credibility.service.js";
import type { PricePort } from "../runtime/price.port.js";
import { CredibilityModel } from "../storage/credibility.model.js";
import { OutcomeModel } from "../storage/outcome.model.js";

interface EvolutionPluginOpts extends FastifyPluginOptions {
  outcomeService: OutcomeService;
  credibilityService: CredibilityService;
  pricePort?: PricePort;
}

async function evolutionRoutes(fastify: FastifyInstance, opts: EvolutionPluginOpts): Promise<void> {
  const { outcomeService, credibilityService } = opts;

  // POST /api/admin/evolution/run-outcome-job - Manually trigger
  fastify.post("/api/admin/evolution/run-outcome-job", async (req, reply) => {
    try {
      const res = await outcomeService.closeDueForecasts();
      return { ok: true, ...res };
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/admin/evolution/credibility - Get all credibility
  fastify.get("/api/admin/evolution/credibility", async (req, reply) => {
    try {
      const states = await CredibilityModel.find().sort({ updatedAt: -1 }).lean();
      return { ok: true, count: states.length, states };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/admin/evolution/credibility/:symbol - Get credibility for symbol
  fastify.get("/api/admin/evolution/credibility/:symbol", async (req, reply) => {
    try {
      const { symbol } = req.params as { symbol: string };
      const states = await credibilityService.getBySymbol(symbol);
      return { ok: true, states };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/admin/evolution/outcomes - Get recent outcomes
  fastify.get("/api/admin/evolution/outcomes", async (req, reply) => {
    try {
      const { limit } = req.query as { limit?: string };
      const outcomes = await outcomeService.getRecentOutcomes(Number(limit) || 50);
      return { ok: true, count: outcomes.length, outcomes };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/admin/evolution/forecasts/open - Get open forecasts
  fastify.get("/api/admin/evolution/forecasts/open", async (req, reply) => {
    try {
      const forecasts = await outcomeService.getOpenForecasts();
      return { ok: true, count: forecasts.length, forecasts };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/admin/evolution/stats - Get evolution stats
  fastify.get("/api/admin/evolution/stats", async (req, reply) => {
    try {
      const [outcomes, forecasts, credStates] = await Promise.all([
        OutcomeModel.countDocuments(),
        outcomeService.getOpenForecasts(),
        CredibilityModel.find().lean(),
      ]);

      // Calculate average credibility
      const symbolCreds = credStates.filter((s: any) => s.kind === "SYMBOL");
      const avgSymbolCred = symbolCreds.length > 0
        ? symbolCreds.reduce((sum: number, s: any) => sum + (s.emaScore || 0), 0) / symbolCreds.length
        : 0.5;

      return {
        ok: true,
        stats: {
          totalOutcomes: outcomes,
          openForecasts: forecasts.length,
          credibilityStates: credStates.length,
          avgSymbolCredibility: Math.round(avgSymbolCred * 100) / 100,
        },
      };
    } catch (e: any) {
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  // GET /api/admin/evolution/test-price - Test PriceAdapter
  fastify.get("/api/admin/evolution/test-price", async (req, reply) => {
    try {
      const { symbol, ts } = req.query as { symbol?: string; ts?: string };
      const testSymbol = symbol || "BTCUSDT";
      const testTs = ts || new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      
      if (!opts.pricePort) {
        return reply.status(500).send({ ok: false, error: "PricePort not configured" });
      }
      
      const price = await opts.pricePort.getPriceAt(testSymbol, testTs);
      
      // Also test current price
      const { getCurrentPrice } = await import("../../chart/services/price.service.js");
      const currentPrice = await getCurrentPrice(testSymbol);
      
      return {
        ok: true,
        test: {
          symbol: testSymbol,
          requestedTs: testTs,
          priceAtTs: price,
          currentPrice,
          diff: currentPrice ? ((price - currentPrice) / currentPrice * 100).toFixed(2) + "%" : null,
          adapterType: "RealPriceAdapter",
        },
      };
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(500).send({ ok: false, error: e?.message });
    }
  });

  console.log("[Evolution] API routes registered");
}

export default evolutionRoutes;
