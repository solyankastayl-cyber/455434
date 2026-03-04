/**
 * S6.1 — Observation Model Routes
 * S6.2 — Observation Metrics Routes
 * S6.3 — Observation Rules Routes
 * ================================
 * 
 * API endpoints for Observation dataset, metrics, and rules.
 * READ-ONLY for metrics, APPLY for rules.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { observationService } from './observation.service.js';

export async function registerObservationRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v6/observation/stats
   * Get observation statistics (S6.2 updated)
   */
  app.get('/api/v6/observation/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await observationService.getStats();
      
      return reply.send({
        ok: true,
        data: stats,
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
   * GET /api/v6/observation/rows
   * Get observation rows with filters
   */
  app.get('/api/v6/observation/rows', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      asset?: string;
      horizon?: string;
      usable_only?: string;
      missed_only?: string;
      decision?: string;
      limit?: string;
    };
    
    try {
      const rows = await observationService.getObservations({
        asset: query.asset,
        horizon: query.horizon,
        usable_only: query.usable_only === 'true',
        missed_only: query.missed_only === 'true',
        decision: query.decision,
        limit: query.limit ? parseInt(query.limit) : 100,
      });
      
      return reply.send({
        ok: true,
        data: {
          count: rows.length,
          rows: rows.map(r => ({
            observation_id: r.observation_id,
            signal_id: r.signal_id,
            asset: r.asset,
            horizon: r.horizon,
            timestamp_t0: r.timestamp_t0,
            sentiment: r.sentiment,
            market: r.market,
            social: r.social,
            outcome: r.outcome,
            targets: r.targets,
            decision: r.decision,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ROWS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/missed
   * Get missed opportunities for analysis
   */
  app.get('/api/v6/observation/missed', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    
    try {
      const missed = await observationService.getMissedOpportunities(
        query.limit ? parseInt(query.limit) : 50
      );
      
      return reply.send({
        ok: true,
        data: {
          count: missed.length,
          missed: missed.map(m => ({
            observation_id: m.observation_id,
            asset: m.asset,
            horizon: m.horizon,
            timestamp_t0: m.timestamp_t0,
            sentiment_label: m.sentiment.label,
            sentiment_confidence: m.sentiment.confidence,
            delta_pct: m.outcome.delta_pct,
            direction: m.outcome.reaction_direction,
            magnitude: m.outcome.reaction_magnitude,
            market: m.market,
            social: m.social,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'MISSED_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/usable-rate
   * Get usable signal rate by confidence buckets
   */
  app.get('/api/v6/observation/usable-rate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await observationService.getStats();
      
      const usableRate = stats.total > 0 ? (stats.usable / stats.total) * 100 : 0;
      const missedRate = stats.total > 0 ? (stats.missed / stats.total) * 100 : 0;
      const noiseRate = stats.total > 0 ? (stats.noise / stats.total) * 100 : 0;
      
      return reply.send({
        ok: true,
        data: {
          total: stats.total,
          usable: stats.usable,
          usableRate: usableRate.toFixed(2) + '%',
          missed: stats.missed,
          missedRate: missedRate.toFixed(2) + '%',
          noise: stats.noise,
          noiseRate: noiseRate.toFixed(2) + '%',
          byHorizon: stats.byHorizon,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'USABLE_RATE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/usability-by-confidence
   * Get usability breakdown by confidence bucket
   */
  app.get('/api/v6/observation/usability-by-confidence', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const buckets = await observationService.getUsabilityByConfidence();
      
      return reply.send({
        ok: true,
        data: {
          buckets,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'USABILITY_CONFIDENCE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/:observation_id
   * Get single observation by ID
   */
  app.get('/api/v6/observation/:observation_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { observation_id } = req.params as { observation_id: string };
    
    try {
      const observation = await observationService.getObservation(observation_id);
      
      if (!observation) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `Observation ${observation_id} not found`,
        });
      }
      
      return reply.send({
        ok: true,
        data: observation,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'GET_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/signal/:signal_id
   * Get all observations for a signal
   */
  app.get('/api/v6/observation/signal/:signal_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { signal_id } = req.params as { signal_id: string };
    
    try {
      const observations = await observationService.getObservationsForSignal(signal_id);
      
      return reply.send({
        ok: true,
        data: {
          signal_id,
          count: observations.length,
          observations,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SIGNAL_OBS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v6/observation/backfill
   * Backfill ObservationRows from existing SignalEvents
   * 
   * Admin endpoint for populating observation_rows from historical data.
   */
  app.post('/api/v6/observation/backfill', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      limit?: number;
      asset?: string;
      dryRun?: boolean;
    };
    
    try {
      console.log(`[Observation] Starting backfill: limit=${body.limit}, asset=${body.asset}, dryRun=${body.dryRun}`);
      
      const result = await observationService.backfillFromSignalEvents({
        limit: body.limit || 500,
        asset: body.asset,
        dryRun: body.dryRun || false,
      });
      
      return reply.send({
        ok: true,
        data: {
          ...result,
          message: body.dryRun 
            ? `Dry run complete. Would create ${result.created} observations.`
            : `Backfill complete. Created ${result.created} observations.`,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'BACKFILL_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v6/observation/generate-training-data
   * Generate synthetic ObservationRows for ML training
   * 
   * This creates realistic synthetic data to bootstrap the ML training process.
   * Uses realistic price movements and varied sentiment to create balanced classes.
   */
  app.post('/api/v6/observation/generate-training-data', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      count?: number;
      asset?: string;
    };
    
    const count = body.count || 100;
    const asset = (body.asset || 'BTC') as 'BTC' | 'ETH' | 'SOL';
    
    try {
      console.log(`[Observation] Generating ${count} synthetic training rows for ${asset}`);
      
      const HORIZONS = ['5m', '15m', '1h', '4h'] as const;
      const SENTIMENTS = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'] as const;
      const DIRECTIONS = ['UP', 'DOWN', 'FLAT'] as const;
      const MAGNITUDES = ['STRONG', 'WEAK', 'NONE'] as const;
      
      // Base prices
      const basePrices = { BTC: 97000, ETH: 2700, SOL: 200 };
      const basePrice = basePrices[asset];
      
      let created = 0;
      const results = { USE: 0, IGNORE: 0, MISS_ALERT: 0 };
      
      for (let i = 0; i < count; i++) {
        const horizon = HORIZONS[i % HORIZONS.length];
        const signal_id = `synthetic_${asset}_${Date.now()}_${i}`;
        const observation_id = `obs_${signal_id}_${horizon}`;
        
        // Check if already exists
        const existing = await observationService.getObservation(observation_id);
        if (existing) continue;
        
        // Generate varied scenarios
        const scenarioType = i % 10;
        
        let sentimentLabel: typeof SENTIMENTS[number];
        let confidence: number;
        let direction: typeof DIRECTIONS[number];
        let magnitude: typeof MAGNITUDES[number];
        let outcomeLabel: string;
        
        // Create balanced scenarios
        if (scenarioType < 2) {
          // TRUE_POSITIVE: POS + UP (for USE)
          sentimentLabel = 'POSITIVE';
          confidence = 0.7 + Math.random() * 0.25;
          direction = 'UP';
          magnitude = Math.random() > 0.5 ? 'STRONG' : 'WEAK';
          outcomeLabel = 'TRUE_POSITIVE';
        } else if (scenarioType < 4) {
          // TRUE_NEGATIVE: NEG + DOWN (for USE)
          sentimentLabel = 'NEGATIVE';
          confidence = 0.7 + Math.random() * 0.25;
          direction = 'DOWN';
          magnitude = Math.random() > 0.5 ? 'STRONG' : 'WEAK';
          outcomeLabel = 'TRUE_NEGATIVE';
        } else if (scenarioType < 5) {
          // MISSED_OPPORTUNITY: NEU + STRONG (for MISS_ALERT)
          sentimentLabel = 'NEUTRAL';
          confidence = 0.4 + Math.random() * 0.3;
          direction = Math.random() > 0.5 ? 'UP' : 'DOWN';
          magnitude = 'STRONG';
          outcomeLabel = 'MISSED_OPPORTUNITY';
        } else if (scenarioType < 7) {
          // FALSE_POSITIVE: POS/NEG + wrong direction (for IGNORE)
          sentimentLabel = Math.random() > 0.5 ? 'POSITIVE' : 'NEGATIVE';
          confidence = 0.6 + Math.random() * 0.3;
          direction = sentimentLabel === 'POSITIVE' ? 'DOWN' : 'UP';
          magnitude = Math.random() > 0.3 ? 'WEAK' : 'STRONG';
          outcomeLabel = 'FALSE_POSITIVE';
        } else {
          // NO_SIGNAL / FLAT (for IGNORE)
          sentimentLabel = SENTIMENTS[Math.floor(Math.random() * 3)];
          confidence = 0.3 + Math.random() * 0.4;
          direction = 'FLAT';
          magnitude = 'NONE';
          outcomeLabel = 'NO_SIGNAL';
        }
        
        // Generate realistic delta
        let deltaPct = 0;
        if (magnitude === 'STRONG') deltaPct = (direction === 'UP' ? 1 : -1) * (2 + Math.random() * 3);
        else if (magnitude === 'WEAK') deltaPct = (direction === 'UP' ? 1 : -1) * (0.5 + Math.random() * 1.5);
        else deltaPct = (Math.random() - 0.5) * 0.5;
        
        const timestamp = new Date(Date.now() - (i * 3600000)); // Spread over time
        const price_t0 = basePrice * (1 + (Math.random() - 0.5) * 0.1);
        
        // Create observation
        await observationService.createObservation({
          signal_id,
          tweet_id: `tw_${signal_id}`,
          asset,
          timestamp_t0: timestamp,
          horizon,
          sentiment: {
            label: sentimentLabel,
            score: sentimentLabel === 'POSITIVE' ? 0.7 : sentimentLabel === 'NEGATIVE' ? 0.3 : 0.5,
            confidence,
            booster_applied: confidence > 0.8 && Math.random() > 0.5,
            cnn_label: sentimentLabel,
            cnn_confidence: confidence * 0.9,
            bullish_analysis: null,
          },
          price_t0,
          reaction: {
            direction,
            magnitude,
            delta_pct: deltaPct,
          },
          outcome_label: outcomeLabel as any,
          social: {
            likes: Math.floor(Math.random() * 500),
            reposts: Math.floor(Math.random() * 100),
            replies: Math.floor(Math.random() * 50),
            influence_score: Math.random() * 100,
            signal_strength: magnitude === 'STRONG' ? 'STRONG' : 'NORMAL',
          },
          text: `Synthetic ${sentimentLabel} signal for ${asset}`,
        });
        
        created++;
      }
      
      // Get updated stats
      const stats = await observationService.getStats();
      
      return reply.send({
        ok: true,
        data: {
          created,
          total: stats.total,
          byDecision: stats.byDecision,
          message: `Generated ${created} synthetic training rows for ${asset}`,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'GENERATE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/health
   * Health check for observation module (S6.3 updated)
   */
  app.get('/api/v6/observation/health', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await observationService.getStats();
      
      // Health check criteria
      const hasData = stats.total > 0;
      const hasUsable = stats.usable > 0 || stats.total === 0;
      const hasMissed = stats.missed >= 0;
      const hasDecisions = Object.keys(stats.byDecision).length > 0;
      
      const status = hasData ? 'OK' : 'EMPTY';
      
      return reply.send({
        ok: true,
        data: {
          status,
          total: stats.total,
          usable: stats.usable,
          missed: stats.missed,
          falseConfidence: stats.falseConfidence,
          noise: stats.noise,
          byDecision: stats.byDecision,
          schema_version: 'S6.3-v1',
          decision_version: 'v0',
          coverage: {
            hasData,
            hasUsable,
            hasMissed,
            hasDecisions,
          },
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'HEALTH_ERROR',
        message: error.message,
        status: 'ERROR',
      });
    }
  });
  
  // ============================================================
  // S6.2 — METRICS API
  // ============================================================
  
  /**
   * GET /api/v6/observation/metrics/summary
   * S6.2 — Get metrics summary (usable rate, miss rate, etc.)
   */
  app.get('/api/v6/observation/metrics/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const summary = await observationService.getMetricsSummary();
      
      return reply.send({
        ok: true,
        data: summary,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'METRICS_SUMMARY_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/metrics/calibration
   * S6.2 — Confidence calibration (expected vs actual TP rate)
   */
  app.get('/api/v6/observation/metrics/calibration', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const calibration = await observationService.getCalibration();
      
      return reply.send({
        ok: true,
        data: {
          calibration,
          interpretation: 'Positive gap = overconfident, Negative gap = underconfident',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CALIBRATION_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/metrics/horizon-stability
   * S6.2 — Compare usable_rate across horizons
   */
  app.get('/api/v6/observation/metrics/horizon-stability', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stability = await observationService.getHorizonStability();
      
      return reply.send({
        ok: true,
        data: {
          horizons: stability,
          stableHorizons: ['1h', '4h'],  // Horizons considered stable for USE
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'HORIZON_STABILITY_ERROR',
        message: error.message,
      });
    }
  });
  
  // ============================================================
  // S6.3 — RULES API
  // ============================================================
  
  /**
   * POST /api/v6/observation/rules/apply
   * S6.3 — Apply v0 rules to all observations (re-compute decisions)
   */
  app.post('/api/v6/observation/rules/apply', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { dryRun?: boolean };
    
    try {
      console.log(`[Observation Rules] Applying v0 rules, dryRun=${body.dryRun}`);
      
      const result = await observationService.applyRules({
        dryRun: body.dryRun || false,
      });
      
      return reply.send({
        ok: true,
        data: {
          ...result,
          message: body.dryRun
            ? `Dry run complete. Would update ${result.processed} observations.`
            : `Applied v0 rules to ${result.updated} observations.`,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RULES_APPLY_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/rules/stats
   * S6.3 — Get rules statistics (USE/IGNORE/MISS_ALERT distribution)
   */
  app.get('/api/v6/observation/rules/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await observationService.getRulesStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RULES_STATS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/rules/usable
   * S6.3 — Get USE observations (signals that worked)
   */
  app.get('/api/v6/observation/rules/usable', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    
    try {
      const usable = await observationService.getUsableObservations(
        query.limit ? parseInt(query.limit) : 50
      );
      
      return reply.send({
        ok: true,
        data: {
          count: usable.length,
          observations: usable.map(o => ({
            observation_id: o.observation_id,
            asset: o.asset,
            horizon: o.horizon,
            timestamp_t0: o.timestamp_t0,
            sentiment: o.sentiment,
            outcome: o.outcome,
            decision: o.decision,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RULES_USABLE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/rules/missed
   * S6.3 — Get MISS_ALERT observations (system was blind)
   */
  app.get('/api/v6/observation/rules/missed', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    
    try {
      const missed = await observationService.getMissAlertObservations(
        query.limit ? parseInt(query.limit) : 50
      );
      
      return reply.send({
        ok: true,
        data: {
          count: missed.length,
          observations: missed.map(m => ({
            observation_id: m.observation_id,
            asset: m.asset,
            horizon: m.horizon,
            timestamp_t0: m.timestamp_t0,
            sentiment_label: m.sentiment.label,
            sentiment_confidence: m.sentiment.confidence,
            delta_pct: m.outcome.delta_pct,
            direction: m.outcome.reaction_direction,
            magnitude: m.outcome.reaction_magnitude,
            decision: m.decision,
            market: m.market,
            social: m.social,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RULES_MISSED_ERROR',
        message: error.message,
      });
    }
  });
  
  console.log('[Observation] S6.1 + S6.2 + S6.3 routes registered');
}
