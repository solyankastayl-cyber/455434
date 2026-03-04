/**
 * BLOCK 82 — Intel Timeline Routes
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { intelTimelineService } from './intel-timeline.service.js';
import { intelTimelineWriterService } from './intel-timeline.writer.js';
import type { IntelTimelineSource, PhaseType, PhaseGrade, DominanceTier, VolRegime, DivergenceGrade } from './intel-timeline.types.js';

export async function registerIntelTimelineRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/v2.1/admin/intel';
  
  fastify.get(`${prefix}/timeline`, async (req: FastifyRequest<{
    Querystring: { symbol?: string; source?: string; window?: string };
  }>) => {
    const symbol = req.query.symbol || 'BTC';
    const source = (req.query.source || 'LIVE') as IntelTimelineSource;
    const window = parseInt(req.query.window || '90');
    return intelTimelineService.getTimeline({ symbol, source, window });
  });
  
  fastify.get(`${prefix}/latest`, async (req: FastifyRequest<{
    Querystring: { symbol?: string; source?: string };
  }>) => {
    const symbol = req.query.symbol || 'BTC';
    const source = (req.query.source || 'LIVE') as IntelTimelineSource;
    const latest = await intelTimelineService.getLatest(symbol, source);
    if (!latest) return { ok: false, error: 'NO_DATA', latest: null };
    const timeline = await intelTimelineService.getTimeline({ symbol, source, window: 14 });
    return { ok: true, latest, trend7d: timeline.stats.trend7d };
  });
  
  fastify.get(`${prefix}/counts`, async (req: FastifyRequest<{
    Querystring: { symbol?: string };
  }>) => {
    const symbol = req.query.symbol || 'BTC';
    const counts = await intelTimelineService.getCounts(symbol);
    return { ok: true, symbol, counts, total: counts.LIVE + counts.V2014 + counts.V2020 };
  });
  
  fastify.post(`${prefix}/snapshot`, async (req: FastifyRequest<{ Body: any }>) => {
    const b = req.body;
    return intelTimelineWriterService.writeSnapshot({
      symbol: b.symbol || 'BTC',
      source: b.source || 'LIVE',
      date: b.date,
      phaseType: b.phaseType || 'NEUTRAL',
      phaseGrade: b.phaseGrade || 'C',
      phaseScore: b.phaseScore ?? 50,
      phaseSharpe: b.phaseSharpe ?? 0,
      phaseHitRate: b.phaseHitRate ?? 0.5,
      phaseExpectancy: b.phaseExpectancy ?? 0,
      phaseSamples: b.phaseSamples ?? 0,
      dominanceTier: b.dominanceTier || 'STRUCTURE',
      structuralLock: b.structuralLock ?? false,
      timingOverrideBlocked: b.timingOverrideBlocked ?? false,
      tierWeights: b.tierWeights || { structure: 0.5, tactical: 0.3, timing: 0.2 },
      volRegime: b.volRegime || 'NORMAL',
      divergenceGrade: b.divergenceGrade || 'C',
      divergenceScore: b.divergenceScore ?? 50,
      finalAction: b.finalAction || 'HOLD',
      finalSize: b.finalSize ?? 0,
      consensusIndex: b.consensusIndex ?? 50,
      conflictLevel: b.conflictLevel || 'LOW',
    });
  });
  
  fastify.post(`${prefix}/backfill`, async (req: FastifyRequest<{
    Body: { cohort: IntelTimelineSource; from: string; to: string };
  }>) => {
    const { cohort, from, to } = req.body;
    if (!cohort || !from || !to) return { ok: false, error: 'Missing: cohort, from, to' };
    const snapshots = generateBackfill(cohort, from, to);
    const result = await intelTimelineWriterService.batchWrite(snapshots);
    return { ok: true, cohort, from, to, ...result };
  });
  
  fastify.log.info('[Fractal] BLOCK 82: Intel Timeline routes registered');
}

function generateBackfill(cohort: IntelTimelineSource, from: string, to: string): any[] {
  const snapshots: any[] = [];
  const start = new Date(from);
  const end = new Date(to);
  const isVintage = cohort === 'V2014';
  const baseScore = isVintage ? 55 : 62;
  const phases: PhaseType[] = ['MARKUP', 'MARKDOWN', 'DISTRIBUTION', 'ACCUMULATION', 'NEUTRAL'];
  let curPhase: PhaseType = 'NEUTRAL';
  let curDom: DominanceTier = 'STRUCTURE';
  let pc = 0, dc = 0;
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    pc++; dc++;
    if (pc >= 15 + Math.random() * 30) { curPhase = phases[Math.floor(Math.random() * 5)]; pc = 0; }
    if (dc >= 7 + Math.random() * 14) { curDom = Math.random() < 0.6 ? 'STRUCTURE' : Math.random() < 0.85 ? 'TACTICAL' : 'TIMING'; dc = 0; }
    
    const score = Math.max(20, Math.min(95, baseScore + (Math.random() - 0.5) * 40));
    const grade: PhaseGrade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
    const lock = Math.random() < (curDom === 'STRUCTURE' ? 0.3 : 0.15);
    const sw = curDom === 'STRUCTURE' ? 0.55 : 0.25;
    const tw = curDom === 'TACTICAL' ? 0.4 : 0.2;
    const vols: VolRegime[] = ['LOW', 'NORMAL', 'HIGH', 'EXTREME', 'CRISIS'];
    const vol = vols[Math.floor(Math.random() * 5)];
    const divScore = 30 + Math.random() * 50;
    const divGrade: DivergenceGrade = divScore >= 70 ? 'A' : divScore >= 55 ? 'B' : divScore >= 40 ? 'C' : divScore >= 25 ? 'D' : 'F';
    const action = curPhase === 'MARKUP' ? 'BUY' : curPhase === 'MARKDOWN' ? 'SELL' : 'HOLD';
    
    snapshots.push({
      symbol: 'BTC', source: cohort, date: d.toISOString().split('T')[0],
      phaseType: curPhase, phaseGrade: grade, phaseScore: Math.round(score),
      phaseSharpe: (Math.random() - 0.3) * 2, phaseHitRate: 0.45 + Math.random() * 0.2,
      phaseExpectancy: (Math.random() - 0.3) * 0.05, phaseSamples: Math.floor(50 + Math.random() * 200),
      dominanceTier: curDom, structuralLock: lock, timingOverrideBlocked: lock && curDom !== 'TIMING',
      tierWeights: { structure: Math.round(sw * 100) / 100, tactical: Math.round(tw * 100) / 100, timing: Math.round((1 - sw - tw) * 100) / 100 },
      volRegime: vol, divergenceGrade: divGrade, divergenceScore: Math.round(divScore),
      finalAction: action, finalSize: action === 'HOLD' ? 0 : Math.random() * 0.5,
      consensusIndex: Math.round(30 + Math.random() * 50),
      conflictLevel: Math.random() < 0.7 ? 'LOW' : Math.random() < 0.9 ? 'MODERATE' : 'HIGH',
    });
  }
  return snapshots;
}

export default registerIntelTimelineRoutes;
