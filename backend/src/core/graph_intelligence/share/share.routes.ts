/**
 * P2.4.3: Share Routes
 * 
 * REST endpoints for graph sharing.
 * 
 * POST /api/graph-intelligence/share - Create share link
 * GET /api/graph-intelligence/share/:shareId - Get shared snapshot
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { shareService } from './share.service.js';

// ============================================
// Routes
// ============================================

export async function shareRoutes(fastify: FastifyInstance) {
  
  // ========================================
  // POST /share
  // Create shareable link for a snapshot
  // ========================================
  fastify.post<{
    Body: { snapshotId: string };
  }>('/share', async (request, reply) => {
    try {
      const { snapshotId } = request.body;
      
      if (!snapshotId) {
        return reply.status(400).send({
          ok: false,
          error: 'snapshotId is required',
        });
      }
      
      const shareRecord = await shareService.createShare(snapshotId);
      
      if (!shareRecord) {
        return reply.status(404).send({
          ok: false,
          error: 'Snapshot not found or not shareable (must be calibrated)',
        });
      }
      
      // Build share URL
      const baseUrl = process.env.FRONTEND_URL || '';
      const shareUrl = `${baseUrl}/share/graph/${shareRecord.shareId}`;
      
      return {
        ok: true,
        data: {
          shareId: shareRecord.shareId,
          shareUrl,
          snapshotId: shareRecord.snapshotId,
          address: shareRecord.address,
          expiresAt: shareRecord.expiresAt,
          calibrationVersion: shareRecord.calibrationVersion,
        },
      };
    } catch (err: any) {
      fastify.log.error(`[Share] Create error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to create share link',
      });
    }
  });
  
  // ========================================
  // GET /share/:shareId
  // Get shared snapshot
  // ========================================
  fastify.get<{
    Params: { shareId: string };
  }>('/share/:shareId', async (request, reply) => {
    try {
      const { shareId } = request.params;
      
      if (!shareId) {
        return reply.status(400).send({
          ok: false,
          error: 'shareId is required',
        });
      }
      
      // Get share record
      const shareRecord = shareService.getShare(shareId);
      
      if (!shareRecord) {
        return reply.status(404).send({
          ok: false,
          error: 'Share link not found or expired',
        });
      }
      
      // Get snapshot
      const snapshot = await shareService.getSharedSnapshot(shareId);
      
      if (!snapshot) {
        return reply.status(404).send({
          ok: false,
          error: 'Snapshot no longer available',
        });
      }
      
      // Format response
      return {
        ok: true,
        data: {
          shareId: shareRecord.shareId,
          snapshotId: snapshot.snapshotId,
          kind: snapshot.kind,
          address: snapshot.address,
          routeId: snapshot.routeId,
          
          // Graph data
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          highlightedPath: snapshot.highlightedPath,
          corridors: (snapshot as any).corridors || [],
          calibrationMeta: (snapshot as any).calibrationMeta,
          
          // Risk analysis
          riskSummary: snapshot.riskSummary,
          
          // Metadata
          generatedAt: snapshot.generatedAt,
          buildTimeMs: snapshot.buildTimeMs,
          
          // Share info
          accessCount: shareRecord.accessCount,
          expiresAt: shareRecord.expiresAt,
        },
      };
    } catch (err: any) {
      fastify.log.error(`[Share] Get error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to retrieve shared snapshot',
      });
    }
  });
  
  // ========================================
  // GET /share/stats
  // Get share statistics
  // ========================================
  fastify.get('/share/stats', async (request, reply) => {
    try {
      const stats = shareService.getStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get share stats',
      });
    }
  });
  
  // ========================================
  // POST /share/cleanup
  // Clean expired shares
  // ========================================
  fastify.post('/share/cleanup', async (request, reply) => {
    try {
      const cleaned = shareService.cleanExpired();
      
      return {
        ok: true,
        cleaned,
      };
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to clean expired shares',
      });
    }
  });
}

export default shareRoutes;
