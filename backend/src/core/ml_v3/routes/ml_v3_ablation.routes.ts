/**
 * ML V3 Ablation Routes - B4.3
 * 
 * Endpoints for running and querying ablation reports
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PythonMLV3Client } from '../clients/python_ml_v3.client.js';
import { AblationVerdictService } from '../services/ablation_verdict.service.js';
import { AblationRunnerService } from '../services/ablation_runner.service.js';
import { MlAblationReport } from '../models/ml_ablation_report.model.js';

interface RunAblationBody {
  task?: string;
  network?: string;
  datasetId?: string;
  modelA?: {
    modelId: string;
    featurePack: string;
    modelVersion?: string;
  };
  modelB?: {
    modelId: string;
    featurePack: string;
    modelVersion?: string;
  };
}

interface LatestQuery {
  task?: string;
  network?: string;
}

interface HistoryQuery {
  task?: string;
  network?: string;
  limit?: string;
}

export async function mlV3AblationRoutes(app: FastifyInstance): Promise<void> {
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8002';
  
  const py = new PythonMLV3Client(mlServiceUrl, 120000); // 2 min timeout
  const verdict = new AblationVerdictService();
  const runner = new AblationRunnerService(py, verdict);

  /**
   * POST /api/admin/ml/v3/ablation/run
   * Run ablation comparison between two SHADOW models
   */
  app.post<{ Body: RunAblationBody }>('/run', async (
    request: FastifyRequest<{ Body: RunAblationBody }>,
    reply: FastifyReply
  ) => {
    const { task, network, datasetId, modelA, modelB } = request.body || {};

    // Validate required fields
    if (!task || !network || !datasetId) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing required fields: task, network, datasetId',
      });
    }

    if (!modelA?.modelId || !modelB?.modelId) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing modelA or modelB with modelId',
      });
    }

    if (!['market', 'actor'].includes(task)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_TASK',
        message: 'Task must be "market" or "actor"',
      });
    }

    try {
      app.log.info(`[Ablation] Running comparison: ${modelA.featurePack} vs ${modelB.featurePack}`);
      
      const doc = await runner.run({
        task: task as 'market' | 'actor',
        network,
        datasetId,
        modelA,
        modelB,
      });

      return {
        ok: true,
        data: {
          reportId: doc._id,
          verdict: doc.verdict,
          reasons: doc.reasons,
          deltas: doc.deltas,
          metricsA: doc.metricsA,
          metricsB: doc.metricsB,
          createdAt: doc.createdAt,
        },
      };
    } catch (error: any) {
      app.log.error(`[Ablation] Run failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'ABLATION_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/admin/ml/v3/ablation/latest
   * Get latest ablation report for task/network
   */
  app.get<{ Querystring: LatestQuery }>('/latest', async (
    request: FastifyRequest<{ Querystring: LatestQuery }>,
    reply: FastifyReply
  ) => {
    const { task = 'market', network } = request.query;

    const query: any = { task };
    if (network) {
      query.network = network;
    }

    const doc = await MlAblationReport.findOne(query)
      .sort({ createdAt: -1 })
      .lean();

    if (!doc) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No ablation reports found',
      });
    }

    return {
      ok: true,
      data: doc,
    };
  });

  /**
   * GET /api/admin/ml/v3/ablation/history
   * Get ablation report history
   */
  app.get<{ Querystring: HistoryQuery }>('/history', async (
    request: FastifyRequest<{ Querystring: HistoryQuery }>,
    _reply: FastifyReply
  ) => {
    const { task = 'market', network, limit = '20' } = request.query;

    const query: any = { task };
    if (network) {
      query.network = network;
    }

    const rows = await MlAblationReport.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 200))
      .lean();

    return {
      ok: true,
      data: {
        rows,
        count: rows.length,
        filter: { task, network: network || 'all' },
      },
    };
  });

  app.log.info('[ML V3] Ablation routes registered: /api/admin/ml/v3/ablation/*');
}

export default mlV3AblationRoutes;
