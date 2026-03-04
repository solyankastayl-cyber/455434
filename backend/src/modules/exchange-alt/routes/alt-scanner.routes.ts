/**
 * ALT SCANNER API ROUTES
 * =======================
 * 
 * REST API for Alt Scanner feature.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { altScannerService } from '../alt-scanner.service.js';
import { indicatorEngine } from '../indicators/index.js';
import { patternClusteringService } from '../clustering/index.js';
import { opportunityRankingService } from '../ranking/index.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerAltScannerRoutes(app: FastifyInstance): Promise<void> {
  // Health check
  app.get('/api/v10/alt-scanner/health', async () => {
    const config = altScannerService.getConfig();
    const lastScan = altScannerService.getLastScanTime();
    
    return {
      ok: true,
      module: 'ALT_SCANNER',
      status: 'OPERATIONAL',
      venue: config.venue,
      universeSize: config.universe.length,
      timeframe: config.timeframe,
      lastScanAt: lastScan || null,
      components: {
        indicatorEngine: {
          providers: indicatorEngine.getProviderStats().length,
          totalIndicators: indicatorEngine.getTotalIndicatorCount(),
        },
        clustering: patternClusteringService.getConfig(),
        ranking: opportunityRankingService.getConfig(),
      },
    };
  });

  // Main radar endpoint - full scan
  app.get('/api/v10/alt-scanner/radar', async (req: FastifyRequest<{
    Querystring: { refresh?: string };
  }>, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const result = await altScannerService.scan(forceRefresh);
      
      return {
        ...result.radar,
        performance: result.performance,
      };
    } catch (error: any) {
      console.error('[AltScanner] Radar error:', error);
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Top opportunities
  app.get('/api/v10/alt-scanner/opportunities', async (req: FastifyRequest<{
    Querystring: { 
      direction?: 'UP' | 'DOWN' | 'ALL';
      limit?: string;
      minScore?: string;
    };
  }>, res) => {
    try {
      const result = await altScannerService.scan();
      
      let opportunities = result.ranking.opportunities;
      
      // Filter by direction
      if (req.query.direction && req.query.direction !== 'ALL') {
        opportunities = opportunities.filter(o => o.direction === req.query.direction);
      }
      
      // Filter by min score
      const minScore = parseInt(req.query.minScore ?? '0');
      if (minScore > 0) {
        opportunities = opportunities.filter(o => o.opportunityScore >= minScore);
      }
      
      // Limit results
      const limit = parseInt(req.query.limit ?? '20');
      opportunities = opportunities.slice(0, limit);
      
      return {
        ok: true,
        asOf: result.radar.asOf,
        total: opportunities.length,
        opportunities,
      };
    } catch (error: any) {
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Clusters list
  app.get('/api/v10/alt-scanner/clusters', async (_req, res) => {
    try {
      const result = await altScannerService.scan();
      
      return {
        ok: true,
        asOf: result.radar.asOf,
        totalClusters: result.clustering.stats.clusterCount,
        clusters: result.clustering.clusters.map(c => ({
          clusterId: c.clusterId,
          label: c.label,
          size: c.size,
          dispersion: c.dispersion,
          topFeatures: c.topFeatures,
          members: c.members,
        })),
        stats: result.clustering.stats,
      };
    } catch (error: any) {
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Cluster detail
  app.get('/api/v10/alt-scanner/clusters/:clusterId', async (req: FastifyRequest<{
    Params: { clusterId: string };
  }>, res) => {
    try {
      const detail = await altScannerService.getClusterDetail(req.params.clusterId);
      
      if (!detail) {
        return res.status(404).send({
          ok: false,
          error: 'Cluster not found',
        });
      }
      
      return detail;
    } catch (error: any) {
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Single asset analysis
  app.get('/api/v10/alt-scanner/asset/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>, res) => {
    try {
      const result = await altScannerService.scan();
      const symbol = req.params.symbol.toUpperCase();
      
      // Find opportunity
      const opportunity = result.ranking.opportunities.find(o => o.symbol === symbol);
      
      // Find cluster membership
      const membership = result.clustering.memberships.find(m => m.symbol === symbol);
      const cluster = membership 
        ? result.clustering.clusters.find(c => c.clusterId === membership.clusterId)
        : null;
      
      if (!opportunity) {
        return res.status(404).send({
          ok: false,
          error: `Asset ${symbol} not found in scan`,
        });
      }
      
      return {
        ok: true,
        symbol,
        opportunity,
        cluster: cluster ? {
          clusterId: cluster.clusterId,
          label: cluster.label,
          size: cluster.size,
        } : null,
        membership: membership ? {
          similarity: membership.similarity,
          distance: membership.distance,
        } : null,
      };
    } catch (error: any) {
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Configuration endpoints
  app.get('/api/v10/alt-scanner/config', async () => {
    return {
      ok: true,
      config: altScannerService.getConfig(),
    };
  });

  app.post('/api/v10/alt-scanner/config', async (req: FastifyRequest<{
    Body: {
      venue?: string;
      timeframe?: string;
      universe?: string[];
    };
  }>, res) => {
    try {
      const updates: any = {};
      
      if (req.body.venue) updates.venue = req.body.venue;
      if (req.body.timeframe) updates.timeframe = req.body.timeframe;
      if (req.body.universe) updates.universe = req.body.universe;
      
      altScannerService.updateConfig(updates);
      
      return {
        ok: true,
        config: altScannerService.getConfig(),
      };
    } catch (error: any) {
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Clear cache
  app.post('/api/v10/alt-scanner/refresh', async (_req, res) => {
    try {
      altScannerService.clearCache();
      const result = await altScannerService.scan(true);
      
      return {
        ok: true,
        message: 'Cache cleared and scan completed',
        performance: result.performance,
      };
    } catch (error: any) {
      return res.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Register extended routes (Blocks 6-16)
  const { registerExtendedAltRoutes } = await import('./extended.routes.js');
  await registerExtendedAltRoutes(app);

  // Register advanced routes (Blocks 17-28)
  const { registerAdvancedAltRoutes } = await import('./advanced.routes.js');
  await registerAdvancedAltRoutes(app);

  console.log('[AltScanner] API routes registered (Blocks 1-28)');
}
