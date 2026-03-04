/**
 * P8.0-B — Brain Forecast Routes
 * 
 * Endpoints:
 * - GET /api/brain/v2/forecast — Quantile forecasts
 * - GET /api/brain/v2/forecast/status — Model status
 * - POST /api/brain/v2/forecast/train — Train MoE model (P8.0-B2)
 * - GET /api/brain/v2/forecast/compare — Compare horizons
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getForecastPipelineService } from '../services/forecast_pipeline.service.js';
import { getDatasetBuilderService } from '../services/dataset_builder.service.js';
import { getQuantileMixtureService } from '../services/quantile_mixture.service.js';
import { getQuantileModelRepo } from '../storage/quantile_model.repo.js';
import { validateForecast, Horizon, HORIZONS } from '../contracts/quantile_forecast.contract.js';

export async function brainForecastRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/forecast — Quantile forecasts
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/forecast', async (
    request: FastifyRequest<{
      Querystring: {
        asset?: string;
        asOf?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const asset = request.query.asset || 'dxy';
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    
    try {
      const pipelineService = getForecastPipelineService();
      const forecast = await pipelineService.generateForecast(asset, asOf);
      
      const validation = validateForecast(forecast);
      
      return reply.send({
        ok: true,
        ...forecast,
        _validation: validation.valid ? undefined : validation.errors,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'FORECAST_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/forecast/status — Model status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/forecast/status', async (
    request: FastifyRequest<{
      Querystring: {
        asset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const asset = request.query.asset || 'dxy';
    
    try {
      const pipelineService = getForecastPipelineService();
      const status = await pipelineService.getStatus(asset);
      
      return reply.send({
        ok: true,
        ...status,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/brain/v2/forecast/train — Train MoE model (P8.0-B2)
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/brain/v2/forecast/train', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        step?: string;
        horizons?: string[];
        quantiles?: number[];
        regimeExperts?: string[];
        minSamplesPerExpert?: number;
        smoothing?: number;
        seed?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    
    const asset = body.asset || 'dxy';
    const start = body.start || '2015-01-01';
    const end = body.end || new Date().toISOString().split('T')[0];
    const step = body.step || 'WEEKLY';
    const horizons = (body.horizons || ['30D', '90D', '180D', '365D']) as Horizon[];
    const quantiles = body.quantiles || [0.05, 0.5, 0.95];
    const regimeExperts = body.regimeExperts || ['EASING', 'TIGHTENING', 'STRESS', 'NEUTRAL', 'NEUTRAL_MIXED'];
    const minSamplesPerExpert = body.minSamplesPerExpert || 60;
    const smoothing = body.smoothing || 0.25;
    const seed = body.seed || 42;
    
    try {
      console.log(`[Train] Starting MoE training for ${asset}: ${start} → ${end}, step=${step}`);
      
      // 1. Build dataset
      const datasetBuilder = getDatasetBuilderService();
      const dataset = await datasetBuilder.buildDataset({
        asset,
        start,
        end,
        step,
        horizons,
        regimeExperts,
      });
      
      console.log(`[Train] Dataset built: ${dataset.stats.validSamples} samples, skipped ${dataset.stats.skippedNoForwardPrice}`);
      
      if (dataset.samples.length < minSamplesPerExpert) {
        return reply.status(400).send({
          ok: false,
          error: 'INSUFFICIENT_DATA',
          message: `Only ${dataset.samples.length} valid samples, need at least ${minSamplesPerExpert}`,
          stats: dataset.stats,
        });
      }
      
      // 2. Train MoE model
      const mixtureService = getQuantileMixtureService();
      const trainedWeights = mixtureService.train(dataset.samples, {
        asset,
        horizons,
        quantiles,
        regimeExperts,
        minSamplesPerExpert,
        smoothing,
        seed,
      });
      
      console.log(`[Train] MoE training complete: ${trainedWeights.stats.trainingTimeMs}ms`);
      
      // 3. Save to MongoDB
      const repo = getQuantileModelRepo();
      const weightsId = await repo.save(trainedWeights);
      
      // 4. Invalidate pipeline cache
      const pipelineService = getForecastPipelineService();
      pipelineService.invalidateCache();
      
      console.log(`[Train] Model saved as ${weightsId}`);
      
      return reply.send({
        ok: true,
        modelVersion: trainedWeights.modelVersion,
        trainedAt: trainedWeights.trainedAt,
        weightsId,
        stats: {
          totalSamples: trainedWeights.stats.totalSamples,
          perExpert: trainedWeights.stats.perExpert,
          droppedExperts: trainedWeights.droppedExperts,
          trainingTimeMs: trainedWeights.stats.trainingTimeMs,
          datasetStats: dataset.stats,
        },
      });
    } catch (e) {
      console.error(`[Train] Error:`, e);
      return reply.status(500).send({
        ok: false,
        error: 'TRAIN_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/forecast/compare — Compare horizons
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/forecast/compare', async (
    request: FastifyRequest<{
      Querystring: {
        asset?: string;
        asOf?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const asset = request.query.asset || 'dxy';
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    
    try {
      const pipelineService = getForecastPipelineService();
      const forecast = await pipelineService.generateForecast(asset, asOf);
      
      const comparison = Object.entries(forecast.byHorizon).map(([horizon, data]) => ({
        horizon,
        direction: data.mean > 0 ? 'UP' : 'DOWN',
        mean: `${(data.mean * 100).toFixed(2)}%`,
        range: `[${(data.q05 * 100).toFixed(2)}%, ${(data.q95 * 100).toFixed(2)}%]`,
        tailRisk: data.tailRisk,
        riskLevel: data.tailRisk > 0.5 ? 'HIGH' : data.tailRisk > 0.25 ? 'MEDIUM' : 'LOW',
      }));
      
      return reply.send({
        ok: true,
        asset,
        asOf,
        regime: forecast.regime.dominant,
        modelVersion: forecast.model.modelVersion,
        isBaseline: forecast.model.isBaseline,
        comparison,
        summary: {
          shortTermBias: forecast.byHorizon['30D'].mean > 0 ? 'BULLISH' : 'BEARISH',
          longTermBias: forecast.byHorizon['365D'].mean > 0 ? 'BULLISH' : 'BEARISH',
          avgTailRisk: (
            (forecast.byHorizon['30D'].tailRisk +
              forecast.byHorizon['90D'].tailRisk +
              forecast.byHorizon['180D'].tailRisk +
              forecast.byHorizon['365D'].tailRisk) / 4
          ).toFixed(2),
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'COMPARE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  console.log('[Brain Forecast] Routes registered at /api/brain/v2/forecast');
}
