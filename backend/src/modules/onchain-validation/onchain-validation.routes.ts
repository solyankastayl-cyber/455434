/**
 * S7 — Onchain Validation Routes
 * ===============================
 * 
 * API endpoints for validation layer.
 * All operations are READ-ONLY validation, not decision-making.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { onchainSnapshotService } from './onchain-snapshot.service.js';
import { onchainValidationService, ValidationOutput } from './onchain-validation.service.js';
import { observationService } from '../observation/observation.service.js';
import { OnchainSnapshotModel } from './onchain-snapshot.model.js';
import mongoose from 'mongoose';

// ============================================================
// Validation Result Storage
// ============================================================

const ValidationOutputSchema = new mongoose.Schema({
  observation_id: { type: String, required: true, unique: true },
  signal_id: { type: String, required: true, index: true },
  
  original_decision: { type: String, enum: ['USE', 'IGNORE', 'MISS_ALERT'] },
  original_confidence: { type: Number },
  
  validation: {
    verdict: { type: String, enum: ['CONFIRMS', 'CONTRADICTS', 'NO_DATA'] },
    impact: { type: String, enum: ['NONE', 'DOWNGRADE', 'STRONG_ALERT'] },
    confidence_delta: { type: Number },
    flags: [{ type: String }],
    explanation: { type: String },
    rules_triggered: [{ type: String }],
  },
  
  validated_confidence: { type: Number },
  onchain_source: { type: String },
  onchain_confidence: { type: Number },
  validated_at: { type: Date },
}, {
  collection: 'observation_validations',
});

const ValidationOutputModel = mongoose.models.ValidationOutput ||
  mongoose.model('ValidationOutput', ValidationOutputSchema);

// ============================================================
// Routes
// ============================================================

export async function registerOnchainValidationRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v7/validation/health
   * Health check for validation layer
   */
  app.get('/api/v7/validation/health', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const snapshotStats = await onchainSnapshotService.getStats();
      const validationCount = await ValidationOutputModel.countDocuments();
      
      return reply.send({
        ok: true,
        data: {
          status: 'OK',
          layer: 'S7 - Onchain Validation',
          snapshots: snapshotStats,
          validations: validationCount,
          version: 'v1.0',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'HEALTH_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v7/validation/snapshot
   * Create on-chain snapshot for a signal
   */
  app.post('/api/v7/validation/snapshot', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      signal_id: string;
      observation_id?: string;
      asset: 'BTC' | 'ETH' | 'SOL';
      t0_timestamp: string;
      window?: '1h' | '4h' | '24h';
    };
    
    if (!body.signal_id || !body.asset || !body.t0_timestamp) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'signal_id, asset, and t0_timestamp are required',
      });
    }
    
    try {
      const result = await onchainSnapshotService.createSnapshot({
        signal_id: body.signal_id,
        observation_id: body.observation_id,
        asset: body.asset,
        t0_timestamp: new Date(body.t0_timestamp),
        window: body.window,
      });
      
      return reply.send({
        ok: true,
        data: {
          snapshot_id: result.snapshot?._id,
          signal_id: body.signal_id,
          source: result.source,
          confidence: result.confidence,
          data_available: result.data_available,
          exchange_signal: result.snapshot?.exchange_signal,
          exchange_pressure: result.snapshot?.exchange_pressure,
          whale_activity_flag: result.snapshot?.whale_activity_flag,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SNAPSHOT_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v7/validation/validate
   * Validate a single observation against on-chain data
   */
  app.post('/api/v7/validation/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { observation_id: string };
    
    if (!body.observation_id) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'observation_id is required',
      });
    }
    
    try {
      // Get observation
      const observation = await observationService.getObservation(body.observation_id);
      if (!observation) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `Observation ${body.observation_id} not found`,
        });
      }
      
      // Create or get snapshot
      const snapshotResult = await onchainSnapshotService.createSnapshot({
        signal_id: observation.signal_id,
        observation_id: observation.observation_id,
        asset: observation.asset as 'BTC' | 'ETH' | 'SOL',
        t0_timestamp: new Date(observation.timestamp_t0),
        window: '1h',
      });
      
      // Validate
      const validation = onchainValidationService.validateWithOnchain(
        observation,
        snapshotResult.snapshot
      );
      
      // Create output
      const output = onchainValidationService.createValidationOutput(
        observation,
        snapshotResult.snapshot,
        validation
      );
      
      // Save validation output
      await ValidationOutputModel.updateOne(
        { observation_id: output.observation_id },
        { $set: output },
        { upsert: true }
      );
      
      return reply.send({
        ok: true,
        data: output,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'VALIDATE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v7/validation/batch
   * Validate multiple observations
   */
  app.post('/api/v7/validation/batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { 
      limit?: number;
      asset?: string;
      decision?: string;
    };
    
    const limit = body.limit || 100;
    
    try {
      // Get observations
      const observations = await observationService.getObservations({
        asset: body.asset,
        decision: body.decision,
        limit,
      });
      
      const results: ValidationOutput[] = [];
      let processed = 0;
      let errors = 0;
      
      for (const observation of observations) {
        try {
          // Create snapshot
          const snapshotResult = await onchainSnapshotService.createSnapshot({
            signal_id: observation.signal_id,
            observation_id: observation.observation_id,
            asset: observation.asset as 'BTC' | 'ETH' | 'SOL',
            t0_timestamp: new Date(observation.timestamp_t0),
            window: '1h',
          });
          
          // Validate
          const validation = onchainValidationService.validateWithOnchain(
            observation,
            snapshotResult.snapshot
          );
          
          // Create output
          const output = onchainValidationService.createValidationOutput(
            observation,
            snapshotResult.snapshot,
            validation
          );
          
          // Save
          await ValidationOutputModel.updateOne(
            { observation_id: output.observation_id },
            { $set: output },
            { upsert: true }
          );
          
          results.push(output);
          processed++;
        } catch (e) {
          errors++;
        }
      }
      
      // Get stats
      const stats = onchainValidationService.getValidationStats(results);
      
      return reply.send({
        ok: true,
        data: {
          processed,
          errors,
          stats,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'BATCH_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v7/validation/stats
   * Get validation statistics (S7.7 metrics)
   */
  app.get('/api/v7/validation/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const validations = await ValidationOutputModel.find({}).lean();
      
      const stats = onchainValidationService.getValidationStats(validations as ValidationOutput[]);
      const snapshotStats = await onchainSnapshotService.getStats();
      
      return reply.send({
        ok: true,
        data: {
          validation: stats,
          snapshots: snapshotStats,
          kpis: {
            use_confirm_rate: `${stats.use_confirm_rate}%`,
            use_contradict_rate: `${stats.use_contradict_rate}%`,
            miss_confirm_rate: `${stats.miss_confirm_rate}%`,
            false_positive_reduced: `${Math.abs(stats.avg_confidence_delta * 100).toFixed(1)}%`,
          },
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v7/validation/contradictions
   * Get all CONTRADICTED USE signals (S7.7 key metric)
   */
  app.get('/api/v7/validation/contradictions', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit) : 50;
    
    try {
      const contradictions = await ValidationOutputModel.find({
        original_decision: 'USE',
        'validation.verdict': 'CONTRADICTS',
      })
        .sort({ validated_at: -1 })
        .limit(limit)
        .lean();
      
      return reply.send({
        ok: true,
        data: {
          count: contradictions.length,
          contradictions: contradictions.map((c: any) => ({
            observation_id: c.observation_id,
            signal_id: c.signal_id,
            impact: c.validation.impact,
            confidence_delta: c.validation.confidence_delta,
            flags: c.validation.flags,
            explanation: c.validation.explanation,
            onchain_source: c.onchain_source,
            validated_at: c.validated_at,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CONTRADICTIONS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v7/validation/output/:observation_id
   * Get validation output for specific observation
   */
  app.get('/api/v7/validation/output/:observation_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { observation_id } = req.params as { observation_id: string };
    
    try {
      const output = await ValidationOutputModel.findOne({ observation_id }).lean();
      
      if (!output) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `Validation output for ${observation_id} not found`,
        });
      }
      
      // Get snapshot
      const observation = await observationService.getObservation(observation_id);
      const snapshot = observation 
        ? await onchainSnapshotService.getSnapshot(observation.signal_id)
        : null;
      
      return reply.send({
        ok: true,
        data: {
          validation: output,
          snapshot: snapshot ? {
            exchange_pressure: snapshot.exchange_pressure,
            exchange_signal: snapshot.exchange_signal,
            whale_activity_flag: snapshot.whale_activity_flag,
            whale_tx_count: snapshot.whale_tx_count,
            net_flow: snapshot.net_flow,
            confidence: snapshot.confidence,
            source: snapshot.source,
            raw_signals: snapshot.raw_signals,
          } : null,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'GET_OUTPUT_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v7/validation/snapshots
   * List on-chain snapshots
   */
  app.get('/api/v7/validation/snapshots', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string; asset?: string };
    const limit = query.limit ? parseInt(query.limit) : 50;
    
    try {
      const filter: any = {};
      if (query.asset) filter.asset = query.asset;
      
      const snapshots = await OnchainSnapshotModel.find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .lean();
      
      return reply.send({
        ok: true,
        data: {
          count: snapshots.length,
          snapshots: snapshots.map(s => ({
            signal_id: s.signal_id,
            asset: s.asset,
            t0_timestamp: s.t0_timestamp,
            exchange_pressure: s.exchange_pressure,
            exchange_signal: s.exchange_signal,
            whale_activity_flag: s.whale_activity_flag,
            confidence: s.confidence,
            source: s.source,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SNAPSHOTS_ERROR',
        message: error.message,
      });
    }
  });
  
  console.log('[S7] Onchain Validation routes registered');
}

export { ValidationOutputModel };
