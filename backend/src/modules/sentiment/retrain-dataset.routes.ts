/**
 * Retrain Dataset Routes — ML1.R
 * ===============================
 * 
 * API для управления датасетом для retrain CNN.
 * 
 * Endpoints:
 * - GET /api/v4/admin/ml/retrain/stats — статистика датасета
 * - GET /api/v4/admin/ml/retrain/validate — валидация перед retrain
 * - GET /api/v4/admin/ml/retrain/samples — последние samples
 * - POST /api/v4/admin/ml/retrain/collect — запустить сбор из shadow
 * - POST /api/v4/admin/ml/retrain/export — экспорт для retrain
 * - POST /api/v4/admin/ml/retrain/clear — очистка (опасно)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { retrainDatasetService } from './retrain-dataset.service.js';
import { realMLShadowClient } from './real-ml-shadow.client.js';
import { sentimentClient } from './sentiment.client.js';

export default async function retrainDatasetRoutes(app: FastifyInstance) {
  
  /**
   * GET /api/v4/admin/ml/retrain/stats
   * Get dataset statistics
   */
  app.get('/api/v4/admin/ml/retrain/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await retrainDatasetService.getStats();
      
      return reply.send({
        ok: true,
        data: {
          ...stats,
          limits: {
            min: 1000,
            optimal: { min: 3000, max: 5000 },
            max: 10000,
          },
          balanceRequirements: {
            POSITIVE: '25-35%',
            NEUTRAL: '35-45%',
            NEGATIVE: '25-35%',
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
   * GET /api/v4/admin/ml/retrain/validate
   * Validate dataset before retrain
   */
  app.get('/api/v4/admin/ml/retrain/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const validation = await retrainDatasetService.validateDataset();
      
      return reply.send({
        ok: true,
        data: {
          ...validation,
          readyForRetrain: validation.isValid,
          recommendation: validation.isValid 
            ? 'Dataset is ready for retrain. Proceed with caution.'
            : `Dataset not ready: ${validation.errors.join(', ')}`,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v4/admin/ml/retrain/samples
   * Get recent samples for review
   */
  app.get('/api/v4/admin/ml/retrain/samples', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = '20' } = req.query as { limit?: string };
    
    try {
      const samples = await retrainDatasetService.getRecentSamples(parseInt(limit));
      
      return reply.send({
        ok: true,
        data: {
          count: samples.length,
          samples: samples.map(s => ({
            text: s.text.substring(0, 100) + (s.text.length > 100 ? '...' : ''),
            mockLabel: s.mockLabel,
            mockConfidence: Math.round(s.mockConfidence * 100),
            cnnLabel: s.cnnLabel,
            cnnConfidence: Math.round(s.cnnConfidence * 100),
            mismatchType: s.mismatchType,
            isValid: s.isValidForRetrain,
            excludeReason: s.excludeReason,
            meta: {
              wordCount: s.meta.wordCount,
              type: s.meta.containsNews ? 'news' : s.meta.containsSlang ? 'slang' : 'other',
            },
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SAMPLES_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/collect
   * Collect samples from current shadow log
   */
  app.post('/api/v4/admin/ml/retrain/collect', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get shadow log
      const shadowLog = realMLShadowClient.getLog();
      
      if (shadowLog.length === 0) {
        return reply.send({
          ok: true,
          data: {
            collected: 0,
            skipped: 0,
            message: 'Shadow log is empty. Run some predictions first.',
          },
        });
      }

      let collected = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const event of shadowLog) {
        if (!event.mock || !event.real) {
          skipped++;
          continue;
        }

        // We need the original text - get it from recent predictions
        // For now, we'll skip events without text
        // In production, you'd store text in shadow log
        skipped++;
      }

      return reply.send({
        ok: true,
        data: {
          collected,
          skipped,
          shadowLogSize: shadowLog.length,
          message: 'Shadow log collected. Note: Direct text collection requires shadow log enhancement.',
          recommendation: 'Use /api/v4/admin/ml/retrain/collect-live to collect with text',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'COLLECT_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/collect-live
   * Manually add a sample with full text
   */
  app.post('/api/v4/admin/ml/retrain/collect-live', async (req: FastifyRequest, reply: FastifyReply) => {
    const { text } = req.body as { text: string };
    
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXT',
        message: 'Text is required',
      });
    }

    try {
      // Run through both MOCK and CNN
      const mockResult = await sentimentClient.predict(text);
      
      // Get CNN result directly
      let cnnResult: { label: string; score: number; confidence: number } | null = null;
      if (realMLShadowClient.isEnabled()) {
        const real = await realMLShadowClient.predict(text);
        if (real && !real.error) {
          cnnResult = {
            label: real.label,
            score: real.score,
            confidence: real.confidence,
          };
        }
      }

      if (!cnnResult) {
        return reply.status(400).send({
          ok: false,
          error: 'CNN_NOT_AVAILABLE',
          message: 'Enable shadow mode and ensure sentiment_runtime is running',
        });
      }

      // Add to dataset
      const result = await retrainDatasetService.addFromShadow(
        text,
        {
          label: mockResult.label,
          score: mockResult.score,
          confidence: mockResult.meta.confidenceScore || 0.5,
        },
        cnnResult,
        mockResult.label,
        mockResult.meta.confidenceScore || 0.5,
        mockResult.meta.flags || []
      );

      return reply.send({
        ok: true,
        data: {
          added: result.added,
          reason: result.reason,
          analysis: {
            mockLabel: mockResult.label,
            mockConfidence: Math.round((mockResult.meta.confidenceScore || 0.5) * 100),
            cnnLabel: cnnResult.label,
            cnnConfidence: Math.round(cnnResult.confidence * 100),
            mismatch: mockResult.label !== cnnResult.label,
          },
          // CNN Bullish filtering result (NEW)
          bullishAnalysis: result.bullishAnalysis,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'COLLECT_LIVE_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/test-filter
   * Test CNN Bullish filtering logic WITHOUT saving to dataset
   * Useful for testing and understanding the filtering rules
   */
  app.post('/api/v4/admin/ml/retrain/test-filter', async (req: FastifyRequest, reply: FastifyReply) => {
    const { text } = req.body as { text: string };
    
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXT',
        message: 'Text is required',
      });
    }

    try {
      // Run through both MOCK and CNN
      const mockResult = await sentimentClient.predict(text);
      
      // Get CNN result directly
      let cnnResult: { label: string; score: number; confidence: number } | null = null;
      if (realMLShadowClient.isEnabled()) {
        const real = await realMLShadowClient.predict(text);
        if (real && !real.error) {
          cnnResult = {
            label: real.label,
            score: real.score,
            confidence: real.confidence,
          };
        }
      }

      if (!cnnResult) {
        return reply.status(400).send({
          ok: false,
          error: 'CNN_NOT_AVAILABLE',
          message: 'Enable shadow mode and ensure sentiment_runtime is running',
        });
      }

      // Analyze without saving
      const analysisResult = await retrainDatasetService.analyzeForCollection(
        text,
        {
          label: mockResult.label,
          score: mockResult.score,
          confidence: mockResult.meta.confidenceScore || 0.5,
        },
        cnnResult
      );

      return reply.send({
        ok: true,
        data: {
          text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          mock: {
            label: mockResult.label,
            score: mockResult.score,
            confidence: Math.round((mockResult.meta.confidenceScore || 0.5) * 100),
          },
          cnn: {
            label: cnnResult.label,
            score: cnnResult.score,
            confidence: Math.round(cnnResult.confidence * 100),
          },
          mismatchType: analysisResult.mismatchType,
          isValidForRetrain: analysisResult.isValidForRetrain,
          excludeReason: analysisResult.excludeReason,
          bullishAnalysis: analysisResult.bullishAnalysis,
          meta: analysisResult.meta,
          recommendation: analysisResult.bullishAnalysis?.classification === 'VALID' 
            ? '✅ This is a VALID bullish signal — CNN may have detected real positive signals'
            : analysisResult.bullishAnalysis?.classification === 'HARD_BLOCK'
            ? '🚫 HARD BLOCK — This text should NEVER be used for boosting'
            : analysisResult.bullishAnalysis?.classification === 'BLOCKED'
            ? '⚠️ BLOCKED — CNN signal is unreliable here'
            : '📝 Not a CNN Bullish case — MOCK and CNN agree or different mismatch type',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'TEST_FILTER_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/batch-collect
   * Collect multiple samples at once
   */
  app.post('/api/v4/admin/ml/retrain/batch-collect', async (req: FastifyRequest, reply: FastifyReply) => {
    const { texts } = req.body as { texts: string[] };
    
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXTS',
        message: 'Array of texts is required',
      });
    }

    if (texts.length > 100) {
      return reply.status(400).send({
        ok: false,
        error: 'TOO_MANY_TEXTS',
        message: 'Maximum 100 texts per batch',
      });
    }

    try {
      let added = 0;
      let skipped = 0;
      const results: Array<{ text: string; status: string; reason?: string }> = [];

      for (const text of texts) {
        if (!text || typeof text !== 'string' || text.length < 5) {
          skipped++;
          results.push({ text: text?.substring(0, 30) || '', status: 'skipped', reason: 'invalid' });
          continue;
        }

        try {
          const mockResult = await sentimentClient.predict(text);
          
          let cnnResult: { label: string; score: number; confidence: number } | null = null;
          if (realMLShadowClient.isEnabled()) {
            const real = await realMLShadowClient.predict(text);
            if (real && !real.error) {
              cnnResult = {
                label: real.label,
                score: real.score,
                confidence: real.confidence,
              };
            }
          }

          if (!cnnResult) {
            skipped++;
            results.push({ text: text.substring(0, 30), status: 'skipped', reason: 'cnn_unavailable' });
            continue;
          }

          const result = await retrainDatasetService.addFromShadow(
            text,
            {
              label: mockResult.label,
              score: mockResult.score,
              confidence: mockResult.meta.confidenceScore || 0.5,
            },
            cnnResult,
            mockResult.label,
            mockResult.meta.confidenceScore || 0.5,
            mockResult.meta.flags || []
          );

          if (result.added) {
            added++;
            results.push({ text: text.substring(0, 30), status: 'added' });
          } else {
            skipped++;
            results.push({ text: text.substring(0, 30), status: 'skipped', reason: result.reason });
          }
        } catch (e) {
          skipped++;
          results.push({ text: text.substring(0, 30), status: 'error' });
        }
      }

      return reply.send({
        ok: true,
        data: {
          total: texts.length,
          added,
          skipped,
          results: results.slice(0, 20), // Only return first 20 results
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'BATCH_COLLECT_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/export
   * Export dataset for retrain
   */
  app.post('/api/v4/admin/ml/retrain/export', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // First validate
      const validation = await retrainDatasetService.validateDataset();
      
      if (!validation.isValid) {
        return reply.send({
          ok: false,
          error: 'VALIDATION_FAILED',
          message: 'Dataset not ready for export',
          validation,
        });
      }

      const exported = await retrainDatasetService.exportForRetrain();
      
      return reply.send({
        ok: true,
        data: {
          ...exported,
          format: 'json',
          targetFile: '/app/models/retrain_dataset.json',
          instructions: [
            '1. Save this data to /app/models/retrain_dataset.json',
            '2. Run retrain script: python /app/sentiment_runtime/retrain.py',
            '3. New model will be saved as /app/models/Sentiment_CNN_v2.h5',
            '4. Update sentiment_runtime to load new model',
            '5. Compare v1 vs v2 in shadow mode',
          ],
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'EXPORT_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/clear
   * Clear dataset (dangerous)
   */
  app.post('/api/v4/admin/ml/retrain/clear', async (req: FastifyRequest, reply: FastifyReply) => {
    const { confirm } = req.body as { confirm: boolean };
    
    if (!confirm) {
      return reply.status(400).send({
        ok: false,
        error: 'CONFIRMATION_REQUIRED',
        message: 'Set confirm: true to clear dataset',
      });
    }

    try {
      const result = await retrainDatasetService.clearDataset(true);
      
      return reply.send({
        ok: true,
        data: result,
        message: `Cleared ${result.count} samples from dataset`,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CLEAR_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v4/admin/ml/retrain/recalculate-bullish
   * Recalculate bullishAnalysis for all existing samples
   * Used for T2 Mismatch Analysis
   */
  app.post('/api/v4/admin/ml/retrain/recalculate-bullish', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await retrainDatasetService.recalculateBullishAnalysis();
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'RECALCULATE_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v4/admin/ml/retrain/t2-analysis
   * Get T2 Mismatch Analysis report
   */
  app.get('/api/v4/admin/ml/retrain/t2-analysis', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const analysis = await retrainDatasetService.getT2Analysis();
      
      return reply.send({
        ok: true,
        data: analysis,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'T2_ANALYSIS_ERROR',
        message: error.message,
      });
    }
  });
}
