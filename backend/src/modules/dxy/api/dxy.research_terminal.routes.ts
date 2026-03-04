/**
 * DXY RESEARCH TERMINAL ROUTES — B3
 * 
 * Endpoints:
 * - GET /api/research/dxy/terminal — Full research pack
 * - GET /api/research/dxy/terminal/debug — Source information
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildDxyResearchPack, buildResearchDebugPack } from '../services/dxy_research_terminal.service.js';
import type { DxyResearchParams } from '../contracts/dxy_research_terminal.contract.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerDxyResearchTerminalRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const prefix = '/api/research/dxy';
  
  /**
   * GET /api/research/dxy/terminal
   * 
   * Full DXY Research Pack:
   * - terminal (A4)
   * - macroCore (B1)
   * - overlay (B2)
   * - research (B3)
   * 
   * Query params:
   * - focus: "7d" | "14d" | "30d" | "90d" | "180d" | "365d" (default: "30d")
   * - rank: 1..10 (default: 1)
   */
  fastify.get(`${prefix}/terminal`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { focus?: string; rank?: string };
      
      const params: DxyResearchParams = {
        focus: query.focus || '30d',
        rank: query.rank ? parseInt(query.rank) : 1,
      };
      
      // Validate focus
      const validFocus = ['7d', '14d', '30d', '90d', '180d', '365d'];
      if (!validFocus.includes(params.focus)) {
        return reply.code(400).send({
          ok: false,
          error: `Invalid focus. Must be one of: ${validFocus.join(', ')}`,
        });
      }
      
      // Validate rank
      if (params.rank < 1 || params.rank > 10) {
        return reply.code(400).send({
          ok: false,
          error: 'Invalid rank. Must be 1-10.',
        });
      }
      
      const pack = await buildDxyResearchPack(params);
      return pack;
      
    } catch (e: any) {
      console.error('[Research Terminal] Error:', e);
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * GET /api/research/dxy/terminal/debug
   * 
   * Debug information:
   * - sources (what endpoints were called)
   * - timing (how long each part took)
   * 
   * Query params:
   * - focus: "7d" | "14d" | "30d" | "90d" | "180d" | "365d" (default: "30d")
   * - rank: 1..10 (default: 1)
   */
  fastify.get(`${prefix}/terminal/debug`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { focus?: string; rank?: string };
      
      const params: DxyResearchParams = {
        focus: query.focus || '30d',
        rank: query.rank ? parseInt(query.rank) : 1,
      };
      
      const debug = await buildResearchDebugPack(params);
      return debug;
      
    } catch (e: any) {
      console.error('[Research Terminal Debug] Error:', e);
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  console.log('[Research] DXY Research Terminal routes registered at /api/research/dxy/*');
}

export default registerDxyResearchTerminalRoutes;
