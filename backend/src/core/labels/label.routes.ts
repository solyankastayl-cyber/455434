/**
 * P2.2 & P2.3 API Routes - Labels & Datasets
 * 
 * Read-only API for ML training data
 */

import type { FastifyInstance } from 'fastify';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';
import { 
  LabelPriceOutcomeModel, 
  LabelFlowEffectModel, 
  LabelActorPerformanceModel 
} from '../labels/label.models.js';
import { 
  runAllPriceOutcomeLabelers,
  runAllFlowEffectLabelers,
  runAllActorPerformanceLabelers,
} from '../labels/label.jobs.js';
import { 
  DatasetMarketModel, 
  DatasetActorModel, 
  DatasetSignalModel 
} from '../datasets/dataset.models.js';
import {
  runAllMarketDatasetBuilders,
  runAllActorDatasetBuilders,
  runAllSignalDatasetBuilders,
} from '../datasets/dataset.jobs.js';

// ============================================
// LABEL ROUTES
// ============================================

export async function labelRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/labels/price - Get price outcome labels
   */
  app.get('/price', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_INVALID' });
    }
    
    const horizon = query.horizon;
    const limit = Math.min(parseInt(query.limit || '200', 10), 1000);
    
    const mongoQuery: Record<string, any> = { network };
    if (horizon) mongoQuery.horizon = horizon;
    
    const labels = await LabelPriceOutcomeModel
      .find(mongoQuery)
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        labels: labels.map(l => ({ ...l, _id: undefined })),
        count: labels.length,
      },
    };
  });

  /**
   * GET /api/v2/labels/flow - Get flow effect labels
   */
  app.get('/flow', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_REQUIRED' });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_INVALID' });
    }
    
    const signalType = query.signalType;
    const limit = Math.min(parseInt(query.limit || '200', 10), 1000);
    
    const mongoQuery: Record<string, any> = { network };
    if (signalType) mongoQuery.signalType = signalType;
    
    const labels = await LabelFlowEffectModel
      .find(mongoQuery)
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        labels: labels.map(l => ({ ...l, _id: undefined })),
        count: labels.length,
      },
    };
  });

  /**
   * GET /api/v2/labels/actors - Get actor performance labels
   */
  app.get('/actors', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_REQUIRED' });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_INVALID' });
    }
    
    const performanceLabel = query.label;
    const minHitRate = query.minHitRate ? parseFloat(query.minHitRate) : undefined;
    const limit = Math.min(parseInt(query.limit || '200', 10), 1000);
    
    const mongoQuery: Record<string, any> = { network };
    if (performanceLabel) mongoQuery.label = performanceLabel;
    if (minHitRate !== undefined) mongoQuery.hitRate = { $gte: minHitRate };
    
    const labels = await LabelActorPerformanceModel
      .find(mongoQuery)
      .sort({ hitRate: -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        labels: labels.map(l => ({ ...l, _id: undefined })),
        count: labels.length,
      },
    };
  });

  /**
   * POST /api/v2/labels/build - Run label builders
   */
  app.post('/build', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const labelType = body.type || 'all';
    
    const results: Record<string, any> = {};
    
    try {
      if (labelType === 'all' || labelType === 'price') {
        results.price = await runAllPriceOutcomeLabelers();
      }
      if (labelType === 'all' || labelType === 'flow') {
        results.flow = await runAllFlowEffectLabelers();
      }
      if (labelType === 'all' || labelType === 'actor') {
        results.actor = await runAllActorPerformanceLabelers();
      }
      
      return { ok: true, data: { results } };
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v2/labels/stats - Label statistics
   */
  app.get('/stats', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const network = query.network ? normalizeNetwork(query.network) : null;
    
    const matchStage = network ? { network } : {};
    
    const [priceStats, flowStats, actorStats] = await Promise.all([
      LabelPriceOutcomeModel.aggregate([
        { $match: matchStage },
        { $group: { _id: { network: '$network', label: '$label' }, count: { $sum: 1 } } },
      ]),
      LabelFlowEffectModel.aggregate([
        { $match: matchStage },
        { $group: { _id: { network: '$network', outcome: '$outcome' }, count: { $sum: 1 } } },
      ]),
      LabelActorPerformanceModel.aggregate([
        { $match: matchStage },
        { $group: { _id: { network: '$network', label: '$label' }, count: { $sum: 1 } } },
      ]),
    ]);
    
    return {
      ok: true,
      data: {
        price: priceStats,
        flow: flowStats,
        actor: actorStats,
        version: 'P2.2.0',
      },
    };
  });

  app.log.info('[P2.2] Label routes registered');
}

// ============================================
// DATASET ROUTES
// ============================================

export async function datasetRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/datasets/market - Get market dataset
   */
  app.get('/market', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_REQUIRED' });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_INVALID' });
    }
    
    const fromTs = query.fromTs ? parseInt(query.fromTs, 10) : undefined;
    const toTs = query.toTs ? parseInt(query.toTs, 10) : undefined;
    const limit = Math.min(parseInt(query.limit || '500', 10), 5000);
    const format = query.format || 'json';
    
    const mongoQuery: Record<string, any> = { network };
    if (fromTs || toTs) {
      mongoQuery.ts = {};
      if (fromTs) mongoQuery.ts.$gte = fromTs;
      if (toTs) mongoQuery.ts.$lte = toTs;
    }
    
    const data = await DatasetMarketModel
      .find(mongoQuery)
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    
    const cleaned = data.map(d => {
      const { _id, __v, ...rest } = d as any;
      return rest;
    });
    
    if (format === 'csv') {
      const headers = Object.keys(cleaned[0] || {}).join(',');
      const rows = cleaned.map(r => Object.values(r).join(','));
      const csv = [headers, ...rows].join('\n');
      reply.header('Content-Type', 'text/csv');
      return csv;
    }
    
    return {
      ok: true,
      data: {
        rows: cleaned,
        count: cleaned.length,
        meta: { network, format: 'json' },
      },
    };
  });

  /**
   * GET /api/v2/datasets/actor - Get actor dataset
   */
  app.get('/actor', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_REQUIRED' });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_INVALID' });
    }
    
    const label = query.label;
    const minEvents = query.minEvents ? parseInt(query.minEvents, 10) : 10;
    const limit = Math.min(parseInt(query.limit || '500', 10), 5000);
    
    const mongoQuery: Record<string, any> = { 
      network,
      eventCount: { $gte: minEvents },
    };
    if (label) mongoQuery.performanceLabel = label;
    
    const data = await DatasetActorModel
      .find(mongoQuery)
      .sort({ hitRate: -1 })
      .limit(limit)
      .lean();
    
    const cleaned = data.map(d => {
      const { _id, __v, ...rest } = d as any;
      return rest;
    });
    
    return {
      ok: true,
      data: {
        rows: cleaned,
        count: cleaned.length,
        meta: { network },
      },
    };
  });

  /**
   * GET /api/v2/datasets/signal - Get signal dataset
   */
  app.get('/signal', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_REQUIRED' });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: 'NETWORK_INVALID' });
    }
    
    const signalType = query.signalType;
    const outcome = query.outcome;
    const limit = Math.min(parseInt(query.limit || '500', 10), 5000);
    
    const mongoQuery: Record<string, any> = { network };
    if (signalType) mongoQuery.signalType = signalType;
    if (outcome) mongoQuery.outcome = outcome;
    
    const data = await DatasetSignalModel
      .find(mongoQuery)
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    
    const cleaned = data.map(d => {
      const { _id, __v, ...rest } = d as any;
      return rest;
    });
    
    return {
      ok: true,
      data: {
        rows: cleaned,
        count: cleaned.length,
        meta: { network },
      },
    };
  });

  /**
   * POST /api/v2/datasets/build - Run dataset builders
   */
  app.post('/build', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const datasetType = body.type || 'all';
    
    const results: Record<string, any> = {};
    
    try {
      if (datasetType === 'all' || datasetType === 'market') {
        results.market = await runAllMarketDatasetBuilders();
      }
      if (datasetType === 'all' || datasetType === 'actor') {
        results.actor = await runAllActorDatasetBuilders();
      }
      if (datasetType === 'all' || datasetType === 'signal') {
        results.signal = await runAllSignalDatasetBuilders();
      }
      
      return { ok: true, data: { results } };
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v2/datasets/stats - Dataset statistics
   */
  app.get('/stats', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const network = query.network ? normalizeNetwork(query.network) : null;
    
    const matchStage = network ? { network } : {};
    
    const [marketStats, actorStats, signalStats] = await Promise.all([
      DatasetMarketModel.aggregate([
        { $match: matchStage },
        { 
          $group: { 
            _id: { network: '$network', priceLabel: '$priceLabel' }, 
            count: { $sum: 1 },
            avgReturn: { $avg: '$priceReturnPct' },
          } 
        },
      ]),
      DatasetActorModel.aggregate([
        { $match: matchStage },
        { 
          $group: { 
            _id: { network: '$network', performanceLabel: '$performanceLabel' }, 
            count: { $sum: 1 },
            avgHitRate: { $avg: '$hitRate' },
          } 
        },
      ]),
      DatasetSignalModel.aggregate([
        { $match: matchStage },
        { 
          $group: { 
            _id: { network: '$network', signalType: '$signalType', outcome: '$outcome' }, 
            count: { $sum: 1 },
          } 
        },
      ]),
    ]);
    
    return {
      ok: true,
      data: {
        market: marketStats,
        actor: actorStats,
        signal: signalStats,
        version: 'P2.3.0',
      },
    };
  });

  app.log.info('[P2.3] Dataset routes registered');
}

export default { labelRoutes, datasetRoutes };
