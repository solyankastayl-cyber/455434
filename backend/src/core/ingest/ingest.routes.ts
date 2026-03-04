/**
 * ETAP 6.1 — Ingest Routes
 * 
 * API endpoints for raw transfer ingestion.
 * 
 * Endpoints:
 * - POST /api/ingest/transfers/run - Start ingest job
 * - GET /api/ingest/transfers/status - Get ingest status
 * - GET /api/ingest/transfers/sample - Get sample transfers
 * - GET /api/ingest/transfers/counts - Get transfer counts
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getEthereumRpc } from '../../jobs/scheduler.js';
import {
  runIngest,
  getIngestStatus,
  getSampleTransfers,
  getTransferCounts,
} from './ingest.service.js';

// ==================== SCHEMAS ====================

const RunIngestSchema = z.object({
  chain: z.string().default('ethereum'),
  window: z.enum(['24h', '7d', '30d']).default('24h'),
  mode: z.enum(['incremental', 'backfill']).default('incremental'),
});

const StatusQuerySchema = z.object({
  chain: z.string().default('ethereum'),
  window: z.enum(['24h', '7d', '30d']).default('24h'),
});

const SampleQuerySchema = z.object({
  chain: z.string().default('ethereum'),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// ==================== ROUTES ====================

export async function registerIngestRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/ingest/transfers/run
   * Start an ingest job
   */
  app.post('/api/ingest/transfers/run', async (
    request: FastifyRequest<{ Body: z.infer<typeof RunIngestSchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const body = RunIngestSchema.parse(request.body || {});
      
      const rpc = getEthereumRpc();
      if (!rpc) {
        return reply.status(503).send({
          ok: false,
          error: 'RPC not configured. Check INFURA_RPC_URL environment variable.',
        });
      }

      // Start ingest (async but return immediately with job ID)
      const result = await runIngest(rpc, body);

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Ingest Routes] Run failed:', message);
      
      // Return 400 for validation errors, 500 for server errors
      const isValidationError = message.includes('invalid') || 
                                message.includes('Invalid') ||
                                message.includes('Expected') ||
                                message.includes('received');
      
      return reply.status(isValidationError ? 400 : 500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/ingest/transfers/status
   * Get status for a chain/window
   */
  app.get('/api/ingest/transfers/status', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof StatusQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = StatusQuerySchema.parse(request.query || {});
      const status = await getIngestStatus(query.chain, query.window);

      return reply.send({
        ok: true,
        data: status,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Ingest Routes] Status failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/ingest/transfers/sample
   * Get sample of recent transfers
   */
  app.get('/api/ingest/transfers/sample', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof SampleQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = SampleQuerySchema.parse(request.query || {});
      const transfers = await getSampleTransfers(query.chain, query.limit);

      return reply.send({
        ok: true,
        data: {
          count: transfers.length,
          transfers,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Ingest Routes] Sample failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/ingest/transfers/counts
   * Get transfer counts by time window
   */
  app.get('/api/ingest/transfers/counts', async (
    request: FastifyRequest<{ Querystring: { chain?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const chain = (request.query as { chain?: string }).chain || 'ethereum';
      const counts = await getTransferCounts(chain);

      return reply.send({
        ok: true,
        data: counts,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Ingest Routes] Counts failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  console.log('[Ingest] Routes registered: /api/ingest/transfers/*');
}
