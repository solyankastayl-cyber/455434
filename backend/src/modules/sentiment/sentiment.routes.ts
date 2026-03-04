/**
 * Sentiment Public Routes
 * /api/v4/sentiment/*
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sentimentClient, PredictRequest, BatchRequest } from './sentiment.client.js';

export function registerSentimentRoutes(app: FastifyInstance) {
  // Health check
  app.get('/api/v4/sentiment/health', async (req: FastifyRequest, reply: FastifyReply) => {
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

  // Capabilities (new S3.4 endpoint)
  app.get('/api/v4/sentiment/capabilities', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await sentimentClient.health();
      return reply.send({
        ok: true,
        data: {
          modes: ['TEXT', 'POST', 'COMMENTS', 'TOPIC', 'TWITTER_FEED'],
          sources: ['url', 'twitter', 'text'],
          batchMax: 50,
          modelVersion: health.modelVersion,
          qualityVersion: 'S3',
          features: {
            mock: sentimentClient.isMockMode(),
            storage: process.env.SENTIMENT_STORAGE_ENABLED === 'true',
            debug: process.env.SENTIMENT_DEBUG === 'true',
            eval: !sentimentClient.isMockMode(),
            twitterFeed: true, // S3.9: Twitter Feed (sentiment_only)
          },
          thresholds: {
            neutralBandLow: 0.45,
            neutralBandHigh: 0.55,
          },
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'CAPABILITIES_ERROR',
        message: error.message,
      });
    }
  });

  // Single prediction (also supports /analyze)
  app.post('/api/v4/sentiment/predict', async (req: FastifyRequest<{ Body: { text: string } }>, reply: FastifyReply) => {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Text is required',
      });
    }

    if (text.length > 10000) {
      return reply.status(400).send({
        ok: false,
        error: 'TEXT_TOO_LONG',
        message: 'Text must be under 10000 characters',
      });
    }

    try {
      const result = await sentimentClient.predict(text);
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
        error: 'SENTIMENT_ERROR',
        message: error.message,
      });
    }
  });

  // Alias: /analyze → /predict (for new API contract)
  app.post('/api/v4/sentiment/analyze', async (req: FastifyRequest<{ Body: { text: string; mode?: string } }>, reply: FastifyReply) => {
    const { text, mode } = req.body;

    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Text is required',
      });
    }

    if (text.length > 10000) {
      return reply.status(400).send({
        ok: false,
        error: 'TEXT_TOO_LONG',
        message: 'Text must be under 10000 characters',
      });
    }

    try {
      const result = await sentimentClient.predict(text);
      // Add mode to response
      return reply.send({
        ok: true,
        data: {
          ...result,
          meta: {
            ...result.meta,
            mode: mode || 'TEXT',
          },
        },
      });
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
        error: 'SENTIMENT_ERROR',
        message: error.message,
      });
    }
  });

  // Batch prediction
  app.post('/api/v4/sentiment/predict-batch', async (req: FastifyRequest<{ Body: { items: Array<{ id: string; text: string }> } }>, reply: FastifyReply) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Items array is required',
      });
    }

    if (items.length > 50) {
      return reply.status(400).send({
        ok: false,
        error: 'BATCH_TOO_LARGE',
        message: 'Maximum 50 items per batch',
      });
    }

    try {
      const result = await sentimentClient.predictBatch(items);
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
        error: 'SENTIMENT_ERROR',
        message: error.message,
      });
    }
  });

  // Alias: /analyze-batch
  app.post('/api/v4/sentiment/analyze-batch', async (req: FastifyRequest<{ Body: { items: Array<{ id: string; text: string }> } }>, reply: FastifyReply) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Items array is required',
      });
    }

    if (items.length > 50) {
      return reply.status(400).send({
        ok: false,
        error: 'BATCH_TOO_LARGE',
        message: 'Maximum 50 items per batch',
      });
    }

    try {
      const result = await sentimentClient.predictBatch(items);
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
        error: 'SENTIMENT_ERROR',
        message: error.message,
      });
    }
  });

  // S3.7: URL Analysis endpoint
  app.post('/api/v4/sentiment/analyze-url', async (req: FastifyRequest<{ Body: { url: string } }>, reply: FastifyReply) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'URL is required',
      });
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_URL',
        message: 'Invalid URL format. Must be http or https.',
      });
    }

    const isMock = sentimentClient.isMockMode();
    const domain = new URL(url).hostname;

    try {
      if (isMock) {
        // Mock extraction for dev mode
        const mockTitles: Record<string, string> = {
          'coindesk.com': 'Bitcoin Surges Past $45K as ETF Approval Looms',
          'cointelegraph.com': 'Ethereum 2.0 Staking Reaches New Milestone',
          'decrypt.co': 'DeFi TVL Hits Record High Amid Market Rally',
          'twitter.com': 'Crypto Discussion Thread',
          'x.com': 'Market Analysis Post',
        };
        
        const title = mockTitles[domain] || `Article from ${domain}`;
        const mockText = `This is mock content from ${url}. The sentiment analysis engine is running in development mode. In production, actual content would be fetched and analyzed for market sentiment signals. Keywords: crypto, bitcoin, ethereum, market.`;
        
        // Analyze the mock text
        const result = await sentimentClient.predict(mockText);
        
        return reply.send({
          ok: true,
          data: {
            url,
            extracted: {
              title,
              description: `Mock content from ${domain}`,
              textLen: mockText.length,
              preview: mockText.substring(0, 280),
              domain,
              contentType: 'text/html',
            },
            result: {
              ...result,
              meta: {
                ...result.meta,
                mode: 'URL',
                source: url,
              },
            },
          },
        });
      }
      
      // Real URL fetching (for production)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SentimentBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        return reply.status(502).send({
          ok: false,
          error: 'FETCH_FAILED',
          message: `Failed to fetch URL: HTTP ${response.status}`,
        });
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return reply.status(400).send({
          ok: false,
          error: 'UNSUPPORTED_CONTENT',
          message: `Unsupported content type: ${contentType}`,
        });
      }
      
      const html = await response.text();
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
      const title = ogTitleMatch?.[1] || titleMatch?.[1]?.trim() || null;
      
      // Extract description
      const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
      const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i);
      const description = ogDescMatch?.[1] || descMatch?.[1] || null;
      
      // Extract main text
      let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Truncate
      const maxChars = 12000;
      if (text.length > maxChars) {
        text = text.substring(0, maxChars);
      }
      
      // Analyze
      const result = await sentimentClient.predict(text);
      
      return reply.send({
        ok: true,
        data: {
          url,
          extracted: {
            title,
            description,
            textLen: text.length,
            preview: text.substring(0, 280) + (text.length > 280 ? '...' : ''),
            domain,
            contentType: contentType.split(';')[0],
          },
          result: {
            ...result,
            meta: {
              ...result.meta,
              mode: 'URL',
              source: url,
            },
          },
        },
      });
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return reply.status(504).send({
          ok: false,
          error: 'TIMEOUT',
          message: 'Request timed out',
        });
      }
      return reply.status(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message,
      });
    }
  });

  console.log('[Sentiment] Public routes registered (S3.7)');
}
