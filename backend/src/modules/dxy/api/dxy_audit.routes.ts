/**
 * DXY AUDIT ROUTES
 * Diagnostic endpoints to validate path construction
 * 
 * GET /api/fractal/dxy/audit?focus=90d
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replayStats } from '../services/dxy_replay_v2.service.js';
import { pathDistance } from '../services/dxy_hybrid_v2.service.js';

interface AuditQuery {
  focus?: string;
  asOf?: string;
}

export async function registerDxyAuditRoutes(app: FastifyInstance) {
  
  app.get('/api/fractal/dxy/audit', async (req: FastifyRequest<{ Querystring: AuditQuery }>, reply: FastifyReply) => {
    const focus = req.query.focus || '90d';
    const asOf = req.query.asOf;
    
    try {
      // Fetch all packs from terminal endpoint
      const baseUrl = `/api/fractal/dxy/terminal?focus=${focus}${asOf ? `&asOf=${asOf}` : ''}`;
      
      // Get terminal data
      const terminalRes = await app.inject({
        method: 'GET',
        url: baseUrl,
      });
      
      if (terminalRes.statusCode !== 200) {
        return reply.status(500).send({
          ok: false,
          error: 'Failed to fetch terminal data',
          statusCode: terminalRes.statusCode,
        });
      }
      
      const terminal = terminalRes.json() as any;
      
      // Extract paths
      const syntheticPath = terminal.synthetic?.path || [];
      const replayPath = terminal.replay?.path || [];
      const hybridPath = terminal.hybrid?.path || [];
      const macroPath = terminal.macro?.path || [];
      
      // Compute statistics
      const std = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const m = arr.reduce((a, b) => a + b, 0) / arr.length;
        const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
        return Math.sqrt(v);
      };
      
      const getPathPrices = (path: any[]) => 
        path.map((p: any) => p?.price || p?.value || 0).filter((x: number) => x > 0);
      
      const sp = getPathPrices(syntheticPath);
      const rp = getPathPrices(replayPath);
      const hp = getPathPrices(hybridPath);
      const mp = getPathPrices(macroPath);
      
      // L2 distance
      const l2 = (a: number[], b: number[]) => {
        const n = Math.min(a.length, b.length);
        if (n === 0) return 0;
        let s = 0;
        for (let i = 0; i < n; i++) {
          const d = a[i] - b[i];
          s += d * d;
        }
        return Math.sqrt(s / n);
      };
      
      const anchorPrice = terminal.core?.anchorPrice || terminal.synthetic?.anchorPrice || 0;
      
      // Build audit report
      const audit = {
        ok: true,
        focus,
        asOf: asOf || 'current',
        anchorPrice,
        
        synthetic: {
          pathLen: sp.length,
          std: std(sp),
          min: sp.length > 0 ? Math.min(...sp) : 0,
          max: sp.length > 0 ? Math.max(...sp) : 0,
          endReturn: syntheticPath[syntheticPath.length - 1]?.pct || 0,
        },
        
        replay: {
          pathLen: rp.length,
          std: std(rp),
          min: rp.length > 0 ? Math.min(...rp) : 0,
          max: rp.length > 0 ? Math.max(...rp) : 0,
          endReturn: replayPath[replayPath.length - 1]?.pct || 0,
          similarity: terminal.replay?.similarity || terminal.core?.matches?.[0]?.score || 0,
        },
        
        hybrid: {
          pathLen: hp.length,
          std: std(hp),
          wReplay: terminal.hybrid?.replayWeight / 100 || 0,
          wSynthetic: 1 - (terminal.hybrid?.replayWeight / 100 || 0),
          endReturn: hybridPath[hybridPath.length - 1]?.pct || 0,
        },
        
        macro: {
          pathLen: mp.length,
          std: std(mp),
          scoreSigned: terminal.macro?.adjustment?.scoreSigned || 0,
          deltaReturnEnd: terminal.macro?.adjustment?.maxAdjustment || 0,
          regime: terminal.macro?.adjustment?.description || 'N/A',
        },
        
        distances: {
          hybridToSynthetic: l2(hp, sp),
          hybridToReplay: l2(hp, rp),
          macroToHybrid: l2(mp, hp),
        },
        
        validations: {
          replayNotCollapsed: std(rp) > anchorPrice * 0.0002,
          hybridIsMix: l2(hp, sp) > 0 && l2(hp, rp) > 0,
          macroHasEffect: l2(mp, hp) > 0,
        },
        
        timestamp: new Date().toISOString(),
      };
      
      return reply.send(audit);
      
    } catch (err) {
      console.error('[DXY Audit] Error:', err);
      return reply.status(500).send({
        ok: false,
        error: (err as Error).message,
      });
    }
  });
}
