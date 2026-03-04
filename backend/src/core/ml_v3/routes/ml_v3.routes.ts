/**
 * ML V3 Routes - Dataset Builder V3 + Training Routing (B4.2) + Ablation Reports (B4.3)
 * 
 * Endpoints for building and querying V3 datasets with:
 * - Pack A features (CEX, Zones, Corridors)
 * - DEX features (optional, when available)
 * 
 * POST /api/admin/ml/v3/dataset/build     - Build new dataset
 * GET  /api/admin/ml/v3/dataset/latest    - Get latest dataset meta
 * GET  /api/admin/ml/v3/dataset/:id/rows  - Get dataset rows
 * GET  /api/admin/ml/v3/dataset/list      - List all datasets
 * 
 * B4.2 Training Routing:
 * POST /api/admin/ml/v3/train             - Train SHADOW model with feature pack
 * GET  /api/admin/ml/v3/train/routes      - Get available training routes
 * GET  /api/admin/ml/v3/models/shadow     - List SHADOW models
 * 
 * B4.3 Ablation Reports:
 * POST /api/admin/ml/v3/ablation/run      - Run ablation comparison
 * GET  /api/admin/ml/v3/ablation/latest   - Get latest ablation report
 * GET  /api/admin/ml/v3/ablation/history  - Get ablation report history
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  buildMarketDatasetV3, 
  getLatestDatasetMeta, 
  getDatasetRows 
} from '../services/dataset_market_v3.builder.js';
import { 
  buildDatasetForPack,
  getLatestDatasetForPack 
} from '../services/dataset_builder_pack.service.js';
import { DatasetMarketMeta } from '../models/dataset_market_meta.model.js';
import { MlModelRegistryModel } from '../../ml_retrain/ml_model_registry.model.js';
import { TrainingExecutorService } from '../services/training_executor.service.js';
import { TrainingRouterService } from '../services/training_router.service.js';
import { FeaturePack } from '../types/feature_packs.js';

interface BuildDatasetBody {
  network?: string;
  forceDex?: boolean;
}

interface DatasetIdParams {
  datasetId: string;
}

interface DatasetRowsQuery {
  limit?: string;
}

interface LatestQuery {
  network?: string;
}

interface ListQuery {
  network?: string;
  limit?: string;
}

export async function mlV3Routes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/admin/ml/v3/dataset/build
   * Build a new dataset
   * 
   * Body: { network?: string }
   */
  app.post<{ Body: BuildDatasetBody }>('/dataset/build', async (
    request: FastifyRequest<{ Body: BuildDatasetBody }>,
    reply: FastifyReply
  ) => {
    const { network = 'ethereum' } = request.body || {};
    
    // Validate network
    const validNetworks = ['ethereum', 'bnb'];
    if (!validNetworks.includes(network)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_NETWORK',
        message: `Network must be one of: ${validNetworks.join(', ')}`,
      });
    }
    
    try {
      app.log.info(`[ML V3] Building dataset for ${network}...`);
      
      const result = await buildMarketDatasetV3(network);
      
      app.log.info(
        `[ML V3] Dataset built: ${result.datasetId}, ` +
        `rows=${result.rows}, dex=${result.dexIncluded}, ${result.durationMs}ms`
      );
      
      return {
        ok: true,
        data: {
          datasetId: result.datasetId,
          network: result.network,
          rows: result.rows,
          packAIncluded: result.packAIncluded,
          dexIncluded: result.dexIncluded,
          dexExcludedReason: result.dexExcludedReason,
          featureColumns: result.featureColumns,
          durationMs: result.durationMs,
        },
      };
    } catch (err: any) {
      app.log.error(`[ML V3] Build failed: ${err.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'BUILD_FAILED',
        message: err.message,
      });
    }
  });
  
  /**
   * GET /api/admin/ml/v3/dataset/latest
   * Get latest dataset metadata for a network
   */
  app.get<{ Querystring: LatestQuery }>('/dataset/latest', async (
    request: FastifyRequest<{ Querystring: LatestQuery }>,
    reply: FastifyReply
  ) => {
    const { network = 'ethereum' } = request.query;
    
    const meta = await getLatestDatasetMeta(network);
    
    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: `No datasets found for network: ${network}`,
      });
    }
    
    return {
      ok: true,
      data: meta,
    };
  });
  
  /**
   * GET /api/admin/ml/v3/dataset/:datasetId/rows
   * Get dataset rows by ID
   */
  app.get<{ Params: DatasetIdParams; Querystring: DatasetRowsQuery }>(
    '/dataset/:datasetId/rows',
    async (
      request: FastifyRequest<{ Params: DatasetIdParams; Querystring: DatasetRowsQuery }>,
      reply: FastifyReply
    ) => {
      const { datasetId } = request.params;
      const { limit = '100' } = request.query;
      
      const rows = await getDatasetRows(datasetId, Math.min(parseInt(limit), 1000));
      
      if (rows.length === 0) {
        return reply.code(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `No rows found for datasetId: ${datasetId}`,
        });
      }
      
      return {
        ok: true,
        data: {
          datasetId,
          rows,
          count: rows.length,
        },
      };
    }
  );
  
  /**
   * GET /api/admin/ml/v3/dataset/list
   * List all datasets (with optional network filter)
   */
  app.get<{ Querystring: ListQuery }>('/dataset/list', async (
    request: FastifyRequest<{ Querystring: ListQuery }>,
    _reply: FastifyReply
  ) => {
    const { network, limit = '20' } = request.query;
    
    const query: any = {};
    if (network) {
      query.network = network;
    }
    
    const datasets = await DatasetMarketMeta.find(query)
      .sort({ builtAt: -1 })
      .limit(Math.min(parseInt(limit), 100))
      .lean();
    
    return {
      ok: true,
      data: {
        datasets: datasets.map((d: any) => ({
          datasetId: d.datasetId,
          network: d.network,
          version: d.version,
          rows: d.rows,
          packAIncluded: d.packAIncluded,
          dexIncluded: d.dexIncluded,
          dexExcludedReason: d.dexExcludedReason,
          featureColumns: d.featureColumns?.length || 0,
          builtAt: d.builtAt,
          buildDurationMs: d.buildDurationMs,
        })),
        count: datasets.length,
        filter: { network: network || 'all' },
      },
    };
  });
  
  /**
   * GET /api/admin/ml/v3/status
   * Get ML V3 system status
   */
  app.get('/status', async () => {
    // Get counts per network
    const [ethereumCount, bnbCount] = await Promise.all([
      DatasetMarketMeta.countDocuments({ network: 'ethereum' }),
      DatasetMarketMeta.countDocuments({ network: 'bnb' }),
    ]);
    
    // Get latest for each network
    const [latestEth, latestBnb] = await Promise.all([
      DatasetMarketMeta.findOne({ network: 'ethereum' }).sort({ builtAt: -1 }).lean(),
      DatasetMarketMeta.findOne({ network: 'bnb' }).sort({ builtAt: -1 }).lean(),
    ]);
    
    return {
      ok: true,
      data: {
        version: 'v3.0-b4',
        networks: {
          ethereum: {
            totalDatasets: ethereumCount,
            latest: latestEth ? {
              datasetId: (latestEth as any).datasetId,
              rows: (latestEth as any).rows,
              dexIncluded: (latestEth as any).dexIncluded,
              builtAt: (latestEth as any).builtAt,
            } : null,
          },
          bnb: {
            totalDatasets: bnbCount,
            latest: latestBnb ? {
              datasetId: (latestBnb as any).datasetId,
              rows: (latestBnb as any).rows,
              dexIncluded: (latestBnb as any).dexIncluded,
              builtAt: (latestBnb as any).builtAt,
            } : null,
          },
        },
        featureSets: {
          PACK_A: ['cex_pressure', 'zones', 'corridors'],
          PACK_A_PLUS_DEX: ['cex_pressure', 'zones', 'corridors', 'dex_liquidity', 'dex_depth'],
        },
      },
    };
  });
  
  /**
   * POST /api/admin/ml/v3/train
   * Train SHADOW model with feature pack (B4.2)
   */
  app.post<{ Body: {
    network?: string;
    featurePack?: string;
    datasetId?: string;
    task?: string;
  } }>('/train', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const { 
      network = 'ethereum',
      featurePack = 'PACK_A',
      datasetId,
      task = 'market' 
    } = request.body || {};
    
    // Validate feature pack
    if (!Object.values(FeaturePack).includes(featurePack as FeaturePack)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_FEATURE_PACK',
        message: `Feature pack must be one of: ${Object.values(FeaturePack).join(', ')}`,
      });
    }
    
    // If no datasetId, find latest compatible dataset
    let finalDatasetId = datasetId;
    if (!finalDatasetId) {
      const latestDataset = await getLatestDatasetForPack(network, featurePack as FeaturePack);
      if (!latestDataset) {
        return reply.code(404).send({
          ok: false,
          error: 'NO_COMPATIBLE_DATASET',
          message: `No dataset found compatible with ${featurePack}`,
        });
      }
      finalDatasetId = latestDataset.datasetId;
    }
    
    try {
      app.log.info(`[ML V3 Train] Starting ${featurePack} training for ${network}...`);
      
      const executor = new TrainingExecutorService();
      const result = await executor.execute({
        task: task as 'market' | 'actor',
        network,
        datasetId: finalDatasetId,
        featurePack: featurePack as FeaturePack,
      });
      
      if (!result.success) {
        return reply.code(500).send({
          ok: false,
          error: 'TRAINING_FAILED',
          message: result.error,
        });
      }
      
      app.log.info(
        `[ML V3 Train] Success: modelId=${result.modelId}, ` +
        `pack=${featurePack}, duration=${result.duration}ms`
      );
      
      return {
        ok: true,
        data: {
          modelId: result.modelId,
          modelVersion: result.modelVersion,
          featurePack: result.featurePack,
          metrics: result.metrics,
          featureCount: result.featureCount,
          dexIncluded: result.dexIncluded,
          status: 'SHADOW',
          duration: result.duration,
        },
      };
      
    } catch (err: any) {
      app.log.error(`[ML V3 Train] Failed: ${err.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'TRAINING_ERROR',
        message: err.message,
      });
    }
  });
  
  /**
   * GET /api/admin/ml/v3/train/routes
   * Get available training routes (B4.2)
   */
  app.get('/train/routes', async () => {
    const router = new TrainingRouterService();
    const routes = router.getAvailableRoutes();
    
    return {
      ok: true,
      data: {
        routes: Object.entries(routes).map(([pack, route]) => ({
          featurePack: pack,
          endpoint: route.endpoint,
          method: route.method,
          description: route.description,
        })),
      },
    };
  });
  
  /**
   * GET /api/admin/ml/v3/models/shadow
   * List SHADOW models with feature pack info (B4.2)
   */
  app.get<{ Querystring: {
    network?: string;
    featurePack?: string;
    limit?: string;
  } }>('/models/shadow', async (
    request: FastifyRequest<{ Querystring: any }>,
    _reply: FastifyReply
  ) => {
    const { network, featurePack, limit = '20' } = request.query;
    
    const query: any = {
      status: 'SHADOW',
      'featureMeta.featurePack': { $exists: true },
    };
    
    if (network) {
      query.network = network;
    }
    
    if (featurePack) {
      query['featureMeta.featurePack'] = featurePack;
    }
    
    const models = await MlModelRegistryModel.find(query)
      .sort({ trainedAt: -1 })
      .limit(Math.min(parseInt(limit), 100))
      .lean();
    
    return {
      ok: true,
      data: {
        models: models.map((m: any) => ({
          modelId: m._id,
          modelType: m.modelType,
          network: m.network,
          version: m.version,
          status: m.status,
          featurePack: m.featureMeta?.featurePack,
          dexIncluded: m.featureMeta?.dexIncluded,
          featureCount: m.featureMeta?.featureCount,
          metrics: m.metrics,
          trainedAt: m.trainedAt,
          approvalStatus: m.approvalStatus || 'NONE',
        })),
        count: models.length,
        filter: { network: network || 'all', featurePack: featurePack || 'all' },
      },
    };
  });
  
  /**
   * POST /api/admin/ml/v3/ablation/run
   * Run ablation comparison between two SHADOW models (B4.3)
   */
  app.post<{ Body: {
    task?: string;
    network?: string;
    datasetId?: string;
    modelA?: any;
    modelB?: any;
  } }>('/ablation/run', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const { task, network, datasetId, modelA, modelB } = request.body || {};

    // Validate
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

    try {
      const { PythonMLV3Client } = await import('../clients/python_ml_v3.client.js');
      const { AblationVerdictService } = await import('../services/ablation_verdict.service.js');
      const { AblationRunnerService } = await import('../services/ablation_runner.service.js');
      
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8002';
      const py = new PythonMLV3Client(mlServiceUrl, 120000);
      const verdict = new AblationVerdictService();
      const runner = new AblationRunnerService(py, verdict);

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
   * Get latest ablation report
   */
  app.get<{ Querystring: {
    task?: string;
    network?: string;
  } }>('/ablation/latest', async (
    request: FastifyRequest<{ Querystring: any }>,
    reply: FastifyReply
  ) => {
    const { MlAblationReport } = await import('../models/ml_ablation_report.model.js');
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
  app.get<{ Querystring: {
    task?: string;
    network?: string;
    limit?: string;
  } }>('/ablation/history', async (
    request: FastifyRequest<{ Querystring: any }>,
    _reply: FastifyReply
  ) => {
    const { MlAblationReport } = await import('../models/ml_ablation_report.model.js');
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
  
  /**
   * POST /api/admin/ml/v3/dataset/synthetic/build
   * Build synthetic dataset (P0.1)
   */
  app.post<{ Body: {
    sourceDatasetId?: string;
    multiplier?: number;
    noisePct?: number;
    seed?: number;
    timeShiftBuckets?: number[];
  } }>('/dataset/synthetic/build', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const {
      sourceDatasetId,
      multiplier = 5,
      noisePct = 2.5,
      seed = 42,
      timeShiftBuckets = [0],
    } = request.body || {};

    if (!sourceDatasetId) {
      return reply.code(400).send({
        ok: false,
        error: 'MISSING_SOURCE_DATASET_ID',
        message: 'sourceDatasetId is required',
      });
    }

    if (multiplier < 2 || multiplier > 20) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_MULTIPLIER',
        message: 'multiplier must be between 2 and 20',
      });
    }

    try {
      const { SyntheticDatasetBuilderService } = await import('../services/synthetic_dataset_builder.service.js');
      const service = new SyntheticDatasetBuilderService();

      app.log.info(`[Synthetic] Building synthetic dataset from ${sourceDatasetId}`);

      const result = await service.buildSyntheticDataset({
        sourceDatasetId,
        multiplier,
        noisePct,
        seed,
        timeShiftBuckets,
      });

      return {
        ok: true,
        data: result,
      };
    } catch (error: any) {
      app.log.error(`[Synthetic] Build failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'SYNTHETIC_BUILD_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/admin/ml/v3/dataset/synthetic/list
   * List synthetic datasets
   */
  app.get<{ Querystring: {
    sourceDatasetId?: string;
    limit?: string;
  } }>('/dataset/synthetic/list', async (
    request: FastifyRequest<{ Querystring: any }>,
    _reply: FastifyReply
  ) => {
    const { sourceDatasetId, limit = '20' } = request.query;

    const { SyntheticDatasetBuilderService } = await import('../services/synthetic_dataset_builder.service.js');
    const service = new SyntheticDatasetBuilderService();

    const datasets = await service.listSyntheticDatasets(
      sourceDatasetId,
      Math.min(parseInt(limit), 100)
    );

    return {
      ok: true,
      data: {
        datasets,
        count: datasets.length,
      },
    };
  });

  /**
   * GET /api/admin/ml/v3/dataset/synthetic/:id/meta
   * Get synthetic dataset meta
   */
  app.get<{ Params: { id: string } }>('/dataset/synthetic/:id/meta', async (
    request: FastifyRequest<{ Params: any }>,
    reply: FastifyReply
  ) => {
    const { id } = request.params;

    const { SyntheticDatasetBuilderService } = await import('../services/synthetic_dataset_builder.service.js');
    const service = new SyntheticDatasetBuilderService();

    const meta = await service.getSyntheticMeta(id);

    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Synthetic dataset not found',
      });
    }

    return {
      ok: true,
      data: meta,
    };
  });

  /**
   * POST /api/admin/ml/v3/ablation/matrix/run
   * Run ablation matrix experiment (P0.2)
   */
  app.post<{ Body: {
    task?: string;
    network?: string;
    datasetId?: string;
    suite?: string;
    useSyntheticIfNeeded?: boolean;
    includeStability?: boolean;
    stabilityRuns?: number;
  } }>('/ablation/matrix/run', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const {
      task = 'market',
      network,
      datasetId,
      suite,
      useSyntheticIfNeeded = true,
      includeStability = false, // P1.1
      stabilityRuns = 3,        // P1.1
    } = request.body || {};

    if (!network || !datasetId || !suite) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing required fields: network, datasetId, suite',
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
      const { AblationMatrixRunnerService } = await import('../services/ablation_matrix_runner.service.js');

      app.log.info(`[Matrix] Running ablation matrix: ${suite} on ${network}/${datasetId}`);
      if (includeStability) {
        app.log.info(`[Matrix] Stability check enabled (${stabilityRuns} runs)`);
      }

      const result = await AblationMatrixRunnerService.run({
        task: task as 'market' | 'actor',
        network,
        datasetId,
        suite: suite as any,
        useSyntheticIfNeeded,
        includeStability,    // P1.1
        stabilityRuns,       // P1.1
      });

      return {
        ok: true,
        data: result,
      };
    } catch (error: any) {
      app.log.error(`[Matrix] Run failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'MATRIX_RUN_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/admin/ml/v3/ablation/matrix/suites
   * Get available ablation suites (P0.2)
   */
  app.get('/ablation/matrix/suites', async () => {
    const { ABLATION_SUITES } = await import('../services/ablation_suite.definitions.js');

    return {
      ok: true,
      data: {
        suites: Object.values(ABLATION_SUITES).map(s => ({
          name: s.name,
          basePack: s.basePack,
          variants: s.variants,
          minRows: s.minRows,
          description: s.description,
        })),
      },
    };
  });

  /**
   * POST /api/admin/ml/v3/stability/run
   * Run multi-seed stability analysis (P1.1)
   */
  app.post<{ Body: {
    task?: string;
    network?: string;
    featurePack?: string;
    datasetId?: string;
    runs?: number;
    seeds?: number[];
  } }>('/stability/run', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const {
      task = 'market',
      network,
      featurePack,
      datasetId,
      runs = 5,
      seeds,
    } = request.body || {};

    if (!network || !featurePack || !datasetId) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing required fields: network, featurePack, datasetId',
      });
    }

    try {
      const { TrainingStabilityRunner } = await import('../services/training_stability_runner.service.js');
      const runner = new TrainingStabilityRunner();

      app.log.info(`[Stability] Running stability analysis: ${featurePack} on ${network}/${datasetId}`);

      const result = await runner.run({
        task: task as 'market' | 'actor',
        network,
        featurePack,
        datasetId,
        runs,
        seeds,
      });

      return {
        ok: true,
        data: result,
      };
    } catch (error: any) {
      app.log.error(`[Stability] Run failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'STABILITY_RUN_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/admin/ml/v3/stability/latest
   * Get latest stability result (P1.1)
   */
  app.get<{ Querystring: {
    task?: string;
    network?: string;
    featurePack?: string;
  } }>('/stability/latest', async (
    request: FastifyRequest<{ Querystring: any }>,
    reply: FastifyReply
  ) => {
    const { task = 'market', network, featurePack } = request.query;

    if (!network || !featurePack) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing required parameters: network, featurePack',
      });
    }

    const { TrainingStabilityRunner } = await import('../services/training_stability_runner.service.js');
    const runner = new TrainingStabilityRunner();

    const result = await runner.getLatest(task, network, featurePack);

    if (!result) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No stability results found',
      });
    }

    return {
      ok: true,
      data: result,
    };
  });

  /**
   * GET /api/admin/ml/v3/stability/history
   * Get stability history (P1.1)
   */
  app.get<{ Querystring: {
    task?: string;
    network?: string;
    featurePack?: string;
    limit?: string;
  } }>('/stability/history', async (
    request: FastifyRequest<{ Querystring: any }>,
    _reply: FastifyReply
  ) => {
    const { task = 'market', network, featurePack, limit = '20' } = request.query;

    if (!network) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing required parameter: network',
      };
    }

    const { TrainingStabilityRunner } = await import('../services/training_stability_runner.service.js');
    const runner = new TrainingStabilityRunner();

    const results = await runner.getHistory(
      task,
      network,
      featurePack,
      Math.min(parseInt(limit), 100)
    );

    return {
      ok: true,
      data: {
        results,
        count: results.length,
      },
    };
  });

  // ==========================================
  // P1.2 GROUP ATTRIBUTION
  // ==========================================

  /**
   * POST /api/admin/ml/v3/attribution/calculate
   * Calculate group attribution from ablation results (P1.2)
   */
  app.post<{ Body: {
    task?: string;
    network?: string;
    matrixId?: string;
  } }>('/attribution/calculate', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const {
      task = 'market',
      network,
      matrixId,
    } = request.body || {};

    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Missing required field: network',
      });
    }

    try {
      const { GroupAttributionService } = await import('../services/group_attribution.service.js');

      app.log.info(`[Attribution] Calculating for ${network}/${task}`);

      const result = await GroupAttributionService.calculate({
        task: task as 'market' | 'actor',
        network,
        matrixId,
      });

      return {
        ok: true,
        data: result,
      };
    } catch (error: any) {
      app.log.error(`[Attribution] Calculation failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'ATTRIBUTION_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/admin/ml/v3/attribution/latest
   * Get latest attribution result (P1.2)
   */
  app.get<{ Querystring: { network?: string; task?: string } }>(
    '/attribution/latest',
    async (request, reply) => {
      const { network, task = 'market' } = request.query;

      if (!network) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_REQUEST',
          message: 'Missing required parameter: network',
        });
      }

      const { GroupAttributionService } = await import('../services/group_attribution.service.js');

      const result = await GroupAttributionService.getLatest(network, task);

      if (!result) {
        return reply.code(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: 'No attribution results found. Run attribution/calculate first.',
        });
      }

      return {
        ok: true,
        data: result,
      };
    }
  );

  /**
   * GET /api/admin/ml/v3/attribution/history
   * Get attribution history (P1.2)
   */
  app.get<{ Querystring: { network?: string; limit?: string } }>(
    '/attribution/history',
    async (request, reply) => {
      const { network, limit = '10' } = request.query;

      if (!network) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_REQUEST',
          message: 'Missing required parameter: network',
        });
      }

      const { GroupAttributionService } = await import('../services/group_attribution.service.js');

      const { results, count } = await GroupAttributionService.getHistory(
        network,
        Math.min(parseInt(limit), 100)
      );

      return {
        ok: true,
        data: {
          results,
          count,
        },
      };
    }
  );

  
  app.log.info('[ML V3] Routes registered: /api/admin/ml/v3/*');
  app.log.info('[ML V3] B4.2 Training Routing enabled');
  app.log.info('[ML V3] B4.3 Ablation Reports enabled');
  app.log.info('[ML V3] P0.1 Synthetic Dataset Builder enabled');
  app.log.info('[ML V3] P0.2 Ablation Matrix Runner enabled');
  app.log.info('[ML V3] P1.1 Training Stability enabled');
  app.log.info('[ML V3] P1.2 Group Attribution enabled');
}

export default mlV3Routes;
