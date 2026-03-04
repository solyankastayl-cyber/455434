/**
 * S3.8.1 — Sentiment Admin Routes (Enhanced)
 * /api/v4/admin/sentiment/*
 * 
 * Provides control, diagnostics, and management for Sentiment Engine
 * 
 * A3: Added freeze status endpoint
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sentimentClient } from './sentiment.client.js';
import {
  ConfigService,
  RunsLoggingService,
  EvalHarnessService,
  StatusService,
  SentimentConfig,
} from './sentiment.admin.services.js';

export function registerSentimentAdminRoutes(app: FastifyInstance, db: any | null = null) {
  const storageEnabled = process.env.SENTIMENT_STORAGE_ENABLED === 'true';
  const dbRef = storageEnabled ? db : null;

  // ============================================
  // GET /admin/sentiment/status (A3: includes freeze)
  // ============================================
  app.get('/api/v4/admin/sentiment/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = StatusService.getStatus(
        sentimentClient.isMockMode(),
        storageEnabled
      );
      
      // Enhanced status with runtime details
      const health = await sentimentClient.health();
      
      // A3: Get freeze status
      const freezeStatus = sentimentClient.getFreezeStatus();
      
      return reply.send({ 
        ok: true, 
        data: {
          ...status,
          // A3: Freeze info
          freeze: freezeStatus,
          runtime: {
            url: process.env.SENTIMENT_URL || 'http://127.0.0.1:8015',
            modelPath: health.modelPath,
            tokenizerPath: health.tokenizerPath,
            loaded: health.loaded,
          },
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // GET /admin/sentiment/freeze (A3: NEW)
  // ============================================
  app.get('/api/v4/admin/sentiment/freeze', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const freezeStatus = sentimentClient.getFreezeStatus();
      return reply.send({ 
        ok: true, 
        data: freezeStatus,
        message: freezeStatus.frozen 
          ? `Engine v${freezeStatus.version} is FROZEN. Changes require new version.`
          : 'Engine is mutable.'
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'FREEZE_STATUS_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // GET /admin/sentiment/health
  // ============================================
  app.get('/api/v4/admin/sentiment/health', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await sentimentClient.health();
      return reply.send({ ok: true, data: health });
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: 'SENTIMENT_UNAVAILABLE',
        message: error.message,
      });
    }
  });

  // ============================================
  // GET /admin/sentiment/config
  // ============================================
  app.get('/api/v4/admin/sentiment/config', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await ConfigService.getConfig(dbRef);
      return reply.send({ ok: true, data: config });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CONFIG_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // PATCH /admin/sentiment/config
  // ============================================
  app.patch('/api/v4/admin/sentiment/config', async (
    req: FastifyRequest<{ Body: Partial<SentimentConfig> }>,
    reply: FastifyReply
  ) => {
    try {
      const patch = req.body;
      const updated = await ConfigService.patchConfig(dbRef, patch);
      return reply.send({ 
        ok: true, 
        data: updated,
        message: 'Configuration updated successfully',
      });
    } catch (error: any) {
      return reply.status(400).send({
        ok: false,
        error: 'CONFIG_UPDATE_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // POST /admin/sentiment/run-eval
  // ============================================
  app.post('/api/v4/admin/sentiment/run-eval', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // Create analyze function that uses sentimentClient
      const analyzeFunc = async (text: string) => {
        const result = await sentimentClient.predict(text);
        return {
          label: result.label,
          score: result.score,
          meta: result.meta,
        };
      };

      const report = await EvalHarnessService.runEval(dbRef, analyzeFunc);
      
      return reply.send({
        ok: true,
        data: report,
        message: `Evaluation completed: ${Math.round(report.accuracy * 100)}% accuracy`,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'EVAL_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // GET /admin/sentiment/eval-reports
  // ============================================
  app.get('/api/v4/admin/sentiment/eval-reports', async (
    req: FastifyRequest<{ Querystring: { limit?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = parseInt(req.query.limit || '20', 10);
      const reports = await EvalHarnessService.getReports(dbRef, limit);
      return reply.send({
        ok: true,
        data: reports,
        count: reports.length,
        storageEnabled,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'REPORTS_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // GET /admin/sentiment/runs
  // ============================================
  app.get('/api/v4/admin/sentiment/runs', async (
    req: FastifyRequest<{ Querystring: { limit?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const runs = await RunsLoggingService.getRuns(dbRef, limit);
      return reply.send({
        ok: true,
        data: runs,
        count: runs.length,
        storageEnabled,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RUNS_ERROR',
        message: error.message,
      });
    }
  });

  // ============================================
  // POST /admin/sentiment/reload (legacy)
  // ============================================
  app.post('/api/v4/admin/sentiment/reload', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await sentimentClient.reload();
      return reply.send({ ok: result.ok, data: result });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RELOAD_FAILED',
        message: error.message,
      });
    }
  });

  // ============================================
  // POST /admin/sentiment/test (legacy)
  // ============================================
  app.post('/api/v4/admin/sentiment/test', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await sentimentClient.test();
      return reply.send({ ok: true, data: result });
    } catch (error: any) {
      if (error.response?.status === 503) {
        return reply.status(503).send({
          ok: false,
          error: 'MODEL_NOT_READY',
          message: 'Sentiment model is not loaded',
        });
      }
      return reply.status(500).send({
        ok: false,
        error: 'TEST_FAILED',
        message: error.message,
      });
    }
  });

  console.log('[Sentiment Admin] Routes registered (S3.8.1)');
  console.log(`  Storage: ${storageEnabled ? 'ENABLED' : 'DISABLED (in-memory)'}`);
}
