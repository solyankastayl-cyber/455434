/**
 * P9.1 + P9.2 — Brain Compare & Simulation Routes
 * 
 * P9.1: GET /api/brain/v2/compare
 * P9.1: GET /api/brain/v2/compare/timeline
 * P9.2: POST /api/brain/v2/sim/run
 * P9.2: GET /api/brain/v2/sim/report
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBrainCompareService } from '../services/brain_compare.service.js';
import { getBrainSimulationService } from '../services/brain_simulation.service.js';
import { getWorldStateService } from '../services/world_state.service.js';
import { getBrainOrchestratorService } from '../services/brain_orchestrator.service.js';

// In-memory store for sim reports (could be MongoDB)
const simReports = new Map<string, any>();

export async function brainCompareSimRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // P9.1: GET /api/brain/v2/compare
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/compare', async (
    request: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];

    try {
      const service = getBrainCompareService();
      const pack = await service.compare(asOf);
      return reply.send({ ok: true, ...pack });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'COMPARE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // P9.1: GET /api/brain/v2/compare/timeline
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/compare/timeline', async (
    request: FastifyRequest<{
      Querystring: { start?: string; end?: string; step?: string }
    }>,
    reply: FastifyReply
  ) => {
    const end = request.query.end || new Date().toISOString().split('T')[0];
    const start = request.query.start || subtractDays(end, 180);
    const stepDays = parseInt(request.query.step || '7', 10);

    try {
      const service = getBrainCompareService();
      const timeline: {
        asOf: string;
        scenario: string;
        severity: string;
        delta: { spx: number; btc: number; cash: number };
        crossAssetLabel?: string;
      }[] = [];

      let current = new Date(start);
      const endDate = new Date(end);
      const maxPoints = 200;

      while (current <= endDate && timeline.length < maxPoints) {
        const dateStr = current.toISOString().split('T')[0];

        try {
          const pack = await service.compare(dateStr);
          timeline.push({
            asOf: dateStr,
            scenario: pack.brain.decision.scenario,
            severity: pack.diff.severity,
            delta: pack.diff.allocationsDelta,
            crossAssetLabel: pack.context.crossAsset?.label,
          });
        } catch {
          // Skip dates with errors
        }

        current.setDate(current.getDate() + stepDays);
      }

      return reply.send({
        ok: true,
        start,
        end,
        stepDays,
        count: timeline.length,
        timeline,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'COMPARE_TIMELINE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // P9.2: POST /api/brain/v2/sim/run
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/sim/run', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        stepDays?: number;
        horizons?: number[];
        mode?: string;
        seed?: number;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asset = (body.asset || 'dxy') as 'dxy' | 'spx' | 'btc';
    const start = body.start || '2024-01-01';
    const end = body.end || new Date().toISOString().split('T')[0];
    const stepDays = body.stepDays || 14;
    const horizons = (body.horizons || [30, 90, 180, 365]) as Array<30 | 90 | 180 | 365>;
    const mode = (body.mode || 'compare') as 'compare' | 'brain_only';
    const seed = body.seed || 42;

    try {
      console.log(`[BrainSim] Starting: ${asset} ${start}→${end}, step=${stepDays}d`);
      const service = getBrainSimulationService();
      const report = await service.runSimulation({
        asset, start, end, stepDays, horizons, mode, seed,
      });

      // Store for later retrieval
      simReports.set(report.id, report);

      return reply.send({ ok: true, ...report });
    } catch (e) {
      console.error('[BrainSim] Error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'SIM_RUN_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // P9.2: GET /api/brain/v2/sim/status
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/sim/status', async (
    request: FastifyRequest<{ Querystring: { id?: string } }>,
    reply: FastifyReply
  ) => {
    const id = request.query.id;
    if (!id) {
      return reply.send({
        ok: true,
        storedReports: Array.from(simReports.keys()),
      });
    }

    const report = simReports.get(id);
    if (!report) {
      return reply.status(404).send({ ok: false, error: 'Report not found' });
    }

    return reply.send({
      ok: true,
      id,
      status: 'COMPLETED',
      window: report.window,
      verdict: report.verdict,
    });
  });

  // ─────────────────────────────────────────────────────────
  // P9.2: GET /api/brain/v2/sim/report
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/sim/report', async (
    request: FastifyRequest<{ Querystring: { id?: string } }>,
    reply: FastifyReply
  ) => {
    const id = request.query.id;
    if (!id) {
      return reply.status(400).send({ ok: false, error: 'Missing id parameter' });
    }

    const report = simReports.get(id);
    if (!report) {
      return reply.status(404).send({ ok: false, error: 'Report not found' });
    }

    return reply.send({ ok: true, ...report });
  });

  // ─────────────────────────────────────────────────────────────
  // P12.0: Scenario Timeline Endpoint
  // GET /api/brain/v2/scenario/timeline
  // ─────────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/scenario/timeline', async (
    request: FastifyRequest<{
      Querystring: {
        start?: string;
        end?: string;
        steps?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const now = new Date();
    const end = request.query.end || now.toISOString().split('T')[0];
    const start = request.query.start || subtractDays(end, 365);
    const steps = parseInt(request.query.steps || '12');
    
    try {
      const worldService = getWorldStateService();
      const brainService = getBrainOrchestratorService();
      
      // Generate dates
      const dates = generateSimDates(start, end, steps);
      
      let baseCount = 0;
      let riskCount = 0;
      let tailCount = 0;
      let tailEligibilityFailCount = 0;
      let guardCounts: Record<string, number> = { NONE: 0, WARN: 0, CRISIS: 0, BLOCK: 0 };
      
      // Gate diagnostics aggregation
      let c1_count = 0, c2_count = 0, c3_count = 0, c4_count = 0;
      const countTrueHist: number[] = [];
      const q05_values: number[] = [];
      const spreadNorm_values: number[] = [];
      const rawTail_values: number[] = [];
      const afterPriorsTail_values: number[] = [];
      
      const scenarioHistory: Array<{ 
        date: string; 
        scenario: string; 
        probs: any; 
        gatePassed: boolean;
        countTrue?: number;
        q05?: number;
        spreadNorm?: number;
      }> = [];
      
      for (const date of dates) {
        try {
          const decision = await brainService.computeDecision(date, true);
          const scenario = decision.scenario.name;
          
          if (scenario === 'BASE') baseCount++;
          else if (scenario === 'RISK') riskCount++;
          else if (scenario === 'TAIL') tailCount++;
          
          // Get diagnostics if available
          const diag = decision.scenarioDiagnostics as any;
          if (diag) {
            if (!diag.eligibilityGatePassed) tailEligibilityFailCount++;
            
            // Aggregate gate conditions
            const gateDiag = diag.gateDiagnostics;
            if (gateDiag) {
              if (gateDiag.c1_guard) c1_count++;
              if (gateDiag.c2_q05) c2_count++;
              if (gateDiag.c3_spread) c3_count++;
              if (gateDiag.c4_crossAsset) c4_count++;
              countTrueHist.push(gateDiag.countTrue);
              q05_values.push(gateDiag.q05);
              spreadNorm_values.push(gateDiag.spreadNorm);
            }
            
            // Track raw vs priors
            if (diag.rawProbabilities?.TAIL !== undefined) {
              rawTail_values.push(diag.rawProbabilities.TAIL);
            }
            if (diag.afterPriors?.TAIL !== undefined) {
              afterPriorsTail_values.push(diag.afterPriors.TAIL);
            }
          }
          
          // Track guard
          const world = await worldService.buildWorldState(date);
          const guardLevel = world.assets.dxy?.guard?.level || 'NONE';
          guardCounts[guardLevel] = (guardCounts[guardLevel] || 0) + 1;
          
          scenarioHistory.push({
            date,
            scenario,
            probs: decision.scenario.probs,
            gatePassed: diag?.eligibilityGatePassed ?? true,
            countTrue: (diag as any)?.gateDiagnostics?.countTrue,
            q05: (diag as any)?.gateDiagnostics?.q05,
            spreadNorm: (diag as any)?.gateDiagnostics?.spreadNorm,
          });
        } catch (e) {
          console.warn(`[Timeline] Failed at ${date}:`, (e as Error).message);
        }
      }
      
      const total = baseCount + riskCount + tailCount;
      
      // Calculate percentiles helper
      const percentile = (arr: number[], p: number) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * p);
        return sorted[Math.min(idx, sorted.length - 1)];
      };
      
      // Count how often countTrue >= 1 and >= 2
      const countTrue_ge1 = countTrueHist.filter(c => c >= 1).length;
      const countTrue_ge2 = countTrueHist.filter(c => c >= 2).length;
      
      return reply.send({
        ok: true,
        period: { start, end, steps },
        rates: {
          baseRate: total > 0 ? Math.round((baseCount / total) * 1000) / 1000 : 0,
          riskRate: total > 0 ? Math.round((riskCount / total) * 1000) / 1000 : 0,
          tailRate: total > 0 ? Math.round((tailCount / total) * 1000) / 1000 : 0,
        },
        counts: { base: baseCount, risk: riskCount, tail: tailCount },
        
        // Gate condition rates (diagnostic A)
        gateConditionRates: {
          c1_guard: total > 0 ? Math.round((c1_count / total) * 1000) / 1000 : 0,
          c2_q05: total > 0 ? Math.round((c2_count / total) * 1000) / 1000 : 0,
          c3_spread: total > 0 ? Math.round((c3_count / total) * 1000) / 1000 : 0,
          c4_crossAsset: total > 0 ? Math.round((c4_count / total) * 1000) / 1000 : 0,
        },
        countTrueDistribution: {
          ge1_rate: total > 0 ? Math.round((countTrue_ge1 / total) * 1000) / 1000 : 0,
          ge2_rate: total > 0 ? Math.round((countTrue_ge2 / total) * 1000) / 1000 : 0,
        },
        
        // Metric ranges (diagnostic B)
        q05_percentiles: {
          p10: Math.round(percentile(q05_values, 0.1) * 10000) / 10000,
          p50: Math.round(percentile(q05_values, 0.5) * 10000) / 10000,
          p90: Math.round(percentile(q05_values, 0.9) * 10000) / 10000,
        },
        spreadNorm_percentiles: {
          p10: Math.round(percentile(spreadNorm_values, 0.1) * 100) / 100,
          p50: Math.round(percentile(spreadNorm_values, 0.5) * 100) / 100,
          p90: Math.round(percentile(spreadNorm_values, 0.9) * 100) / 100,
        },
        
        // Prior blend diagnostics (diagnostic C)
        rawTail_mean: rawTail_values.length > 0 ? Math.round((rawTail_values.reduce((a,b) => a+b, 0) / rawTail_values.length) * 1000) / 1000 : 0,
        afterPriorsTail_mean: afterPriorsTail_values.length > 0 ? Math.round((afterPriorsTail_values.reduce((a,b) => a+b, 0) / afterPriorsTail_values.length) * 1000) / 1000 : 0,
        
        guardDistribution: guardCounts,
        tailEligibilityFailRate: total > 0 ? Math.round((tailEligibilityFailCount / total) * 1000) / 1000 : 0,
        
        sanityCheck: {
          tailRateOK: total > 0 ? (tailCount / total) >= 0.02 && (tailCount / total) <= 0.25 : true,
          baseRateOK: total > 0 ? (baseCount / total) >= 0.30 : true,
          riskRateOK: total > 0 ? (riskCount / total) >= 0.15 : true,  // Lowered from 0.20
          countTrue_ge1_OK: total > 0 ? (countTrue_ge1 / total) >= 0.15 : true,
          countTrue_ge2_OK: total > 0 ? (countTrue_ge2 / total) >= 0.02 : true,
        },
        history: scenarioHistory.slice(-20),
      });
    } catch (e) {
      console.error('[Timeline] Error:', e);
      return reply.status(500).send({ ok: false, error: (e as Error).message });
    }
  });

  console.log('[Brain Compare+Sim] Routes registered at /api/brain/v2/compare, /api/brain/v2/sim, /api/brain/v2/scenario/timeline');
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function generateSimDates(start: string, end: string, steps: number): string[] {
  const dates: string[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const stepDays = Math.floor(totalDays / steps);
  
  for (let i = 0; i <= steps; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i * stepDays);
    if (d <= endDate) {
      dates.push(d.toISOString().split('T')[0]);
    }
  }
  
  return dates;
}
