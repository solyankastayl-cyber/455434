/**
 * Attribution Claims Routes (Phase 15.5 + P2.2)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { attributionClaimsService } from './attribution_claims.service.js';
import { SubjectType, SupportedChain } from './attribution_claims.model.js';
import { ATTRIBUTION_SEED_DATA } from './attribution.seed.js';
import { entityAttributionService } from './entity_attribution.service.js';

export async function attributionClaimsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/attribution/subject/:type/:id
   * Get all claims for an actor or entity
   */
  fastify.get('/subject/:type/:id', async (
    request: FastifyRequest<{ Params: { type: string; id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { type, id } = request.params;
      
      if (!['actor', 'entity'].includes(type)) {
        return reply.status(400).send({ ok: false, error: 'Invalid type. Must be "actor" or "entity"' });
      }

      const result = await attributionClaimsService.getSubjectAddresses(
        type as SubjectType,
        id
      );

      return { ok: true, data: result };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/attribution/address/:chain/:address
   * Reverse lookup: find subjects claiming this address
   */
  fastify.get('/address/:chain/:address', async (
    request: FastifyRequest<{ Params: { chain: string; address: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { chain, address } = request.params;
      
      const validChains = ['ethereum', 'arbitrum', 'base', 'bsc', 'solana', 'polygon'];
      if (!validChains.includes(chain)) {
        return reply.status(400).send({ ok: false, error: 'Invalid chain' });
      }

      const result = await attributionClaimsService.getAttributionStatus(
        chain as SupportedChain,
        address
      );

      return { ok: true, data: result };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/attribution/claim
   * Create a new claim
   */
  fastify.post('/claim', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const body = request.body as any;
      
      // Validate required fields
      if (!body.subjectType || !body.subjectId || !body.address || !body.reason) {
        return reply.status(400).send({ 
          ok: false, 
          error: 'Missing required fields: subjectType, subjectId, address, reason' 
        });
      }

      const claim = await attributionClaimsService.createClaim({
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        chain: body.chain || 'ethereum',
        address: body.address,
        status: body.status,
        confidence: body.confidence || 0.5,
        source: body.source || 'manual',
        reason: body.reason,
        evidence: body.evidence,
        createdBy: body.createdBy || 'admin',
      });

      return { ok: true, data: claim };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * PUT /api/attribution/claim/:id
   * Update a claim
   */
  fastify.put('/claim/:id', async (
    request: FastifyRequest<{ Params: { id: string }; Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      const claim = await attributionClaimsService.updateClaim(id, {
        status: body.status,
        confidence: body.confidence,
        reason: body.reason,
        evidence: body.evidence,
      });

      if (!claim) {
        return reply.status(404).send({ ok: false, error: 'Claim not found' });
      }

      return { ok: true, data: claim };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/attribution/claim/:id/confirm
   * Confirm a claim
   */
  fastify.post('/claim/:id/confirm', async (
    request: FastifyRequest<{ Params: { id: string }; Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      const claim = await attributionClaimsService.confirmClaim(id, body.reason);

      if (!claim) {
        return reply.status(404).send({ ok: false, error: 'Claim not found' });
      }

      return { ok: true, data: claim };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/attribution/claim/:id/reject
   * Reject a claim
   */
  fastify.post('/claim/:id/reject', async (
    request: FastifyRequest<{ Params: { id: string }; Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const body = request.body as any;

      const claim = await attributionClaimsService.rejectClaim(id, body.reason);

      if (!claim) {
        return reply.status(404).send({ ok: false, error: 'Claim not found' });
      }

      return { ok: true, data: claim };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * DELETE /api/attribution/claim/:id
   * Delete a claim
   */
  fastify.delete('/claim/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const deleted = await attributionClaimsService.deleteClaim(id);

      if (!deleted) {
        return reply.status(404).send({ ok: false, error: 'Claim not found' });
      }

      return { ok: true, message: 'Claim deleted' };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/attribution/import
   * Bulk import claims (admin only)
   */
  fastify.post('/import', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const body = request.body as any;
      const claims = body.claims || [];

      if (!Array.isArray(claims) || claims.length === 0) {
        return reply.status(400).send({ ok: false, error: 'No claims provided' });
      }

      const result = await attributionClaimsService.bulkImport(claims);

      return { ok: true, data: result };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/attribution/seed
   * Load seed data (for initial setup)
   */
  fastify.post('/seed', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await attributionClaimsService.bulkImport(ATTRIBUTION_SEED_DATA);
      return { ok: true, data: result, message: 'Seed data loaded' };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/attribution/subjects
   * Get all subjects with claims
   */
  fastify.get('/subjects', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const subjects = await attributionClaimsService.getAllSubjectsWithClaims();
      return { ok: true, data: subjects };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // ========================================
  // P2.2 Attribution Engine Endpoints
  // ========================================

  /**
   * POST /api/attribution/analyze/entity/:slug
   * Run attribution analysis for a specific entity
   */
  fastify.post('/analyze/entity/:slug', async (
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { slug } = request.params;
      
      const result = await entityAttributionService.analyzeEntity(slug);
      
      if (!result) {
        return reply.status(404).send({ 
          ok: false, 
          error: 'Entity not found or no data available' 
        });
      }

      return { ok: true, data: result };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/attribution/entity/:slug
   * Get attribution result for an entity
   */
  fastify.get('/entity/:slug', async (
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { slug } = request.params;
      
      const result = await entityAttributionService.getEntityAttribution(slug);
      
      if (!result) {
        return reply.status(404).send({ 
          ok: false, 
          error: 'Entity not found or no data available' 
        });
      }

      return { ok: true, data: result };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/attribution/analyze/all
   * Run attribution analysis for all entities
   */
  fastify.post('/analyze/all', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const results = await entityAttributionService.analyzeAllEntities();
      
      return { 
        ok: true, 
        data: results,
        count: results.length,
        message: `Analyzed ${results.length} entities` 
      };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });
}
