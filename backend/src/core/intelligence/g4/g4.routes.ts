/**
 * G4 Threat Radar API Routes
 * 
 * Endpoints for watchlists, alerts, and real-time monitoring
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../../db/mongodb.js';
import { G4RadarService } from './g4_radar.service.js';
import { isValidNetwork } from '../../../common/network.types.js';

export const g4Routes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const g4Service = new G4RadarService(db);
  const watchlistManager = g4Service.getWatchlistManager();

  /**
   * POST /api/intel/g4/watchlist
   * 
   * Create new watchlist subscription
   */
  app.post('/watchlist', async (req, reply) => {
    const body = req.body as {
      subject?: string;
      network?: string;
      triggers?: string[];
      channels?: string[];
      metadata?: Record<string, any>;
    };

    const { subject, network, triggers, channels } = body;

    if (!subject || !network) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_PARAMS',
        message: 'subject and network are required',
      });
    }

    if (!isValidNetwork(network)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_NETWORK',
        message: `Network "${network}" is not supported`,
      });
    }

    try {
      const watchlist = await watchlistManager.create({
        subject,
        network,
        triggers: (triggers || ['VOLUME_SPIKE']) as any[],
        channels: (channels || ['webhook']) as any[],
        metadata: body.metadata,
      });

      return reply.send({
        ok: true,
        data: watchlist,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'CREATE_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/intel/g4/watchlist/:id
   * 
   * Get watchlist by ID
   */
  app.get('/watchlist/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    try {
      const watchlist = await watchlistManager.get(id);

      if (!watchlist) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: 'Watchlist not found',
        });
      }

      return reply.send({
        ok: true,
        data: watchlist,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'GET_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/intel/g4/watchlists
   * 
   * Get all active watchlists
   */
  app.get('/watchlists', async (req, reply) => {
    try {
      const watchlists = await watchlistManager.getActive();

      return reply.send({
        ok: true,
        data: {
          watchlists,
          count: watchlists.length,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'LIST_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /api/intel/g4/watchlist/:id
   * 
   * Delete watchlist
   */
  app.delete('/watchlist/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    try {
      const deleted = await watchlistManager.delete(id);

      if (!deleted) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: 'Watchlist not found',
        });
      }

      return reply.send({
        ok: true,
        message: 'Watchlist deleted',
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'DELETE_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/intel/g4/alerts
   * 
   * Get recent alerts
   */
  app.get('/alerts', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = parseInt(query.limit || '50', 10);

    try {
      const alerts = await g4Service.getRecentAlerts(limit);

      return reply.send({
        ok: true,
        data: {
          alerts,
          count: alerts.length,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'ALERTS_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/intel/g4/check/:watchlistId
   * 
   * Manually trigger check for specific watchlist
   */
  app.post('/check/:watchlistId', async (req, reply) => {
    const { watchlistId } = req.params as { watchlistId: string };

    try {
      const alerts = await g4Service.checkWatchlist(watchlistId);

      return reply.send({
        ok: true,
        data: {
          alerts,
          count: alerts.length,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'CHECK_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
};
