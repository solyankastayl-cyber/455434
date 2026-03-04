/**
 * DATA INGESTION ROUTES
 * 
 * API endpoints for FRED data ingestion and quality checks.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MongoClient, Db } from 'mongodb';
import {
  runFullIngestion,
  checkDataQuality,
  runFullQualityCheck,
  DataQualityReport,
} from './fred_ingestion.service.js';

// ═══════════════════════════════════════════════════════════════
// MONGODB CONNECTION
// ═══════════════════════════════════════════════════════════════

let _db: Db | null = null;

async function getDb(): Promise<Db> {
  if (_db) return _db;
  
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'fractal_db';
  
  const client = new MongoClient(mongoUrl);
  await client.connect();
  _db = client.db(dbName);
  
  return _db;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerIngestionRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * Start full FRED data ingestion
   * POST /api/data/ingest/fred
   */
  app.post('/api/data/ingest/fred', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      startDate?: string;
      seriesIds?: string[];
      forceReload?: boolean;
    } || {};
    
    try {
      const db = await getDb();
      
      // Run ingestion in background
      const resultPromise = runFullIngestion(db, {
        startDate: body.startDate || '2010-01-01',
        seriesIds: body.seriesIds,
        forceReload: body.forceReload || false,
      });
      
      // For small number of series, wait for result
      if (!body.seriesIds || body.seriesIds.length <= 3) {
        const result = await resultPromise;
        return reply.send({
          ok: true,
          ...result,
        });
      }
      
      // For full ingestion, return immediately
      resultPromise.then(result => {
        console.log('[Ingestion] Background job completed:', result.successful, '/', result.totalSeries);
      }).catch(err => {
        console.error('[Ingestion] Background job failed:', err);
      });
      
      return reply.send({
        ok: true,
        message: 'Ingestion started in background',
        totalSeries: body.seriesIds?.length || 12,
      });
      
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Get data quality report
   * GET /api/data/quality
   */
  app.get('/api/data/quality', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = await getDb();
      const reports = await runFullQualityCheck(db);
      
      // Summary stats
      const totalRecords = reports.reduce((sum, r) => sum + r.recordCount, 0);
      const avgCoverage = reports.reduce((sum, r) => sum + r.coverage, 0) / reports.length;
      const totalGaps = reports.reduce((sum, r) => sum + r.gaps.length, 0);
      const totalFutureLeak = reports.reduce((sum, r) => sum + r.futureLeak, 0);
      
      return reply.send({
        ok: true,
        timestamp: new Date().toISOString(),
        summary: {
          totalSeries: reports.length,
          totalRecords,
          avgCoverage: Math.round(avgCoverage * 100) / 100,
          totalGaps,
          totalFutureLeak,
        },
        reports,
      });
      
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Get single series quality report
   * GET /api/data/quality/:seriesId
   */
  app.get('/api/data/quality/:seriesId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { seriesId } = request.params as { seriesId: string };
    
    try {
      const db = await getDb();
      const report = await checkDataQuality(db, seriesId.toUpperCase());
      
      return reply.send({
        ok: true,
        report,
      });
      
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Get series data preview
   * GET /api/data/preview/:seriesId
   */
  app.get('/api/data/preview/:seriesId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { seriesId } = request.params as { seriesId: string };
    const { limit = '20', asOf } = request.query as { limit?: string; asOf?: string };
    
    try {
      const db = await getDb();
      const collection = db.collection('macro_series');
      
      // Build query
      const query: any = { seriesId: seriesId.toUpperCase() };
      if (asOf) {
        query.releasedAt = { $lte: new Date(asOf) };
      }
      
      const records = await collection
        .find(query)
        .sort({ periodEnd: -1 })
        .limit(parseInt(limit))
        .project({ _id: 0, seriesId: 1, periodEnd: 1, value: 1, releasedAt: 1 })
        .toArray();
      
      return reply.send({
        ok: true,
        seriesId: seriesId.toUpperCase(),
        asOf: asOf || 'latest',
        count: records.length,
        records,
      });
      
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Get database stats
   * GET /api/data/stats
   */
  app.get('/api/data/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = await getDb();
      const collection = db.collection('macro_series');
      
      // Get series counts
      const seriesCounts = await collection.aggregate([
        { $group: { _id: '$seriesId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray();
      
      // Get date range
      const dateRange = await collection.aggregate([
        {
          $group: {
            _id: null,
            minDate: { $min: '$periodEnd' },
            maxDate: { $max: '$periodEnd' },
            totalRecords: { $sum: 1 },
          },
        },
      ]).toArray();
      
      const stats = dateRange[0] || { minDate: null, maxDate: null, totalRecords: 0 };
      
      return reply.send({
        ok: true,
        timestamp: new Date().toISOString(),
        totalRecords: stats.totalRecords,
        dateRange: stats.minDate ? {
          start: stats.minDate.toISOString().slice(0, 10),
          end: stats.maxDate.toISOString().slice(0, 10),
        } : null,
        seriesBreakdown: seriesCounts.map(s => ({
          seriesId: s._id,
          count: s.count,
        })),
      });
      
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  console.log('[Data Ingestion] Routes registered at /api/data/*');
}

export default registerIngestionRoutes;
