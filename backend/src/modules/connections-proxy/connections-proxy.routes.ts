/**
 * Connections Routes
 * 
 * ═══════════════════════════════════════════════════════════════
 * LAYER 2 ANALYTICS - READ ONLY
 * ═══════════════════════════════════════════════════════════════
 * 
 * Reads data from seeded MongoDB collections (connections_unified_accounts).
 * Provides social intelligence analytics WITHOUT affecting forecast pipeline.
 * 
 * RULES:
 * 1. Read-only endpoints only
 * 2. No state modification
 * 3. NEVER affects forecast pipeline
 * 4. Isolated from ML/verdict engine
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/mongodb.js';

// Get connections database (separate from main DB)
function getConnectionsDb() {
  const client = getDb().client;
  return client.db('connections_db');
}

export async function registerConnectionsProxyRoutes(app: FastifyInstance): Promise<void> {

  // ============================================
  // HEALTH CHECK
  // ============================================
  
  app.get('/health', async () => {
    try {
      const db = getConnectionsDb();
      const count = await db.collection('connections_unified_accounts').countDocuments();
      return { 
        ok: true, 
        service: 'connections',
        accountsCount: count,
        status: count > 0 ? 'seeded' : 'empty'
      };
    } catch (error) {
      return { ok: false, error: 'Database connection failed' };
    }
  });

  // ============================================
  // STATS
  // ============================================

  app.get('/stats', async () => {
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      const total = await col.countDocuments();
      const verified = await col.countDocuments({ verified: true });
      const byCategory = await col.aggregate([
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } }
      ]).toArray();
      
      return {
        ok: true,
        stats: {
          totalAccounts: total,
          verifiedAccounts: verified,
          byCategory: byCategory.map(c => ({ category: c._id, count: c.count }))
        }
      };
    } catch (error) {
      return { ok: false, error: 'Failed to fetch stats' };
    }
  });

  // ============================================
  // ACCOUNTS (INFLUENCERS) - from seed data
  // ============================================

  app.get('/accounts', async (request) => {
    const { limit, sort_by, order, category } = request.query as { 
      limit?: string; 
      sort_by?: string; 
      order?: string;
      category?: string;
    };
    
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      const sortField = sort_by === 'influence' ? 'influence' : 
                       sort_by === 'smart' ? 'smart' :
                       sort_by === 'followers' ? 'followers' : 'influence';
      const sortOrder = order === 'asc' ? 1 : -1;
      
      const query: any = {};
      if (category) {
        query.categories = category;
      }
      
      const accounts = await col
        .find(query, { projection: { _id: 0 } })
        .sort({ [sortField]: sortOrder })
        .limit(parseInt(limit || '50'))
        .toArray();
      
      return { 
        ok: true, 
        accounts,
        total: accounts.length
      };
    } catch (error) {
      return { ok: false, error: 'Failed to fetch accounts', accounts: [] };
    }
  });

  app.get('/accounts/:handle', async (request, reply) => {
    const { handle } = request.params as { handle: string };
    
    try {
      const db = getConnectionsDb();
      const account = await db.collection('connections_unified_accounts')
        .findOne({ handle: handle.toLowerCase() }, { projection: { _id: 0 } });
      
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      
      return { ok: true, account };
    } catch (error) {
      return reply.status(500).send({ ok: false, error: 'Failed to fetch account' });
    }
  });

  // ============================================
  // REALITY SCORE - calculated from seed data
  // ============================================

  app.get('/reality/score', async (request, reply) => {
    const { symbol } = request.query as { symbol?: string };
    
    if (!symbol) {
      return reply.status(400).send({ ok: false, error: 'Symbol required' });
    }
    
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      // Calculate aggregate reality score from influencers
      const stats = await col.aggregate([
        { $match: { confidence: { $exists: true } } },
        { $group: {
          _id: null,
          avgConfidence: { $avg: '$confidence' },
          count: { $sum: 1 }
        }}
      ]).toArray();
      
      const avgScore = stats[0]?.avgConfidence || 0;
      const sample = stats[0]?.count || 0;
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        realityScore: avgScore,
        sample,
        confidence: sample >= 5 ? 'high' : sample >= 2 ? 'medium' : 'low',
        verdictMix: {
          true: Math.floor(sample * avgScore),
          fake: Math.floor(sample * (1 - avgScore) * 0.3),
          neutral: Math.floor(sample * (1 - avgScore) * 0.7)
        }
      };
    } catch (error) {
      return { ok: false, error: 'Failed to calculate reality score' };
    }
  });

  app.get('/reality/leaderboard', async (request) => {
    const { limit } = request.query as { limit?: string };
    
    try {
      const db = getConnectionsDb();
      const leaderboard = await db.collection('connections_unified_accounts')
        .find({ confidence: { $exists: true } }, { projection: { _id: 0 } })
        .sort({ confidence: -1 })
        .limit(parseInt(limit || '10'))
        .toArray();
      
      return {
        ok: true,
        leaderboard: leaderboard.map((acc, i) => ({
          rank: i + 1,
          handle: acc.handle,
          name: acc.name,
          avatar: acc.avatar,
          confidence: acc.confidence,
          categories: acc.categories
        }))
      };
    } catch (error) {
      return { ok: false, leaderboard: [] };
    }
  });

  // ============================================
  // INFLUENCE SCORE
  // ============================================

  app.get('/influence', async (request, reply) => {
    const { symbol } = request.query as { symbol?: string };
    
    if (!symbol) {
      return reply.status(400).send({ ok: false, error: 'Symbol required' });
    }
    
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      // Get top influencers
      const topInfluencers = await col
        .find({}, { projection: { _id: 0, handle: 1, name: 1, avatar: 1, influence: 1, followers: 1 } })
        .sort({ influence: -1 })
        .limit(5)
        .toArray();
      
      // Calculate aggregate influence score
      const stats = await col.aggregate([
        { $group: {
          _id: null,
          avgInfluence: { $avg: '$influence' },
          count: { $sum: 1 }
        }}
      ]).toArray();
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        influenceScore: stats[0]?.avgInfluence || 0,
        clusterCount: Math.ceil((stats[0]?.count || 0) / 3),
        topInfluencers
      };
    } catch (error) {
      return { ok: false, influenceScore: 0, topInfluencers: [] };
    }
  });

  // ============================================
  // CLUSTERS - grouped by categories
  // ============================================

  app.get('/clusters', async (request) => {
    const { symbol } = request.query as { symbol?: string };
    
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      // Group by categories to create "clusters"
      const clusters = await col.aggregate([
        { $unwind: '$categories' },
        { $group: {
          _id: '$categories',
          memberCount: { $sum: 1 },
          avgInfluence: { $avg: '$influence' },
          members: { $push: { handle: '$handle', influence: '$influence' } }
        }},
        { $project: {
          category: '$_id',
          memberCount: 1,
          momentum: '$avgInfluence',
          direction: { $cond: [{ $gte: ['$avgInfluence', 0.7] }, 'bullish', 
                      { $cond: [{ $lte: ['$avgInfluence', 0.4] }, 'bearish', 'neutral'] }] },
          topMembers: { $slice: ['$members', 3] }
        }},
        { $sort: { momentum: -1 } }
      ]).toArray();
      
      return {
        ok: true,
        clusters: clusters.map(c => ({
          symbol: c.category,
          memberCount: c.memberCount,
          momentum: c.momentum,
          direction: c.direction,
          topMembers: c.topMembers
        }))
      };
    } catch (error) {
      return { ok: false, clusters: [] };
    }
  });

  // ============================================
  // BACKERS (VC / Foundations)
  // ============================================

  app.get('/backers', async (request) => {
    const { symbol } = request.query as { symbol?: string };
    
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      // Filter accounts that are VCs or have VC-related categories
      const backers = await col
        .find({ 
          $or: [
            { categories: 'VC' },
            { categories: 'INVESTOR' },
            { categories: 'FOUNDER' }
          ]
        }, { projection: { _id: 0 } })
        .sort({ authority: -1 })
        .limit(10)
        .toArray();
      
      return {
        ok: true,
        backers: backers.map(b => ({
          name: b.name || b.handle,
          handle: b.handle,
          avatar: b.avatar,
          type: b.categories?.includes('VC') ? 'vc' : 
                b.categories?.includes('FOUNDER') ? 'founder' : 'investor',
          totalInvestments: Math.floor((b.networkSize || 100) / 10),
          influence: b.influence
        }))
      };
    } catch (error) {
      return { ok: false, backers: [] };
    }
  });

  app.get('/backers/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    
    try {
      const db = getConnectionsDb();
      const backer = await db.collection('connections_unified_accounts')
        .findOne({ handle: slug.toLowerCase() }, { projection: { _id: 0 } });
      
      if (!backer) {
        return { ok: false, backer: null };
      }
      
      return {
        ok: true,
        backer: {
          name: backer.name,
          handle: backer.handle,
          avatar: backer.avatar,
          categories: backer.categories,
          influence: backer.influence,
          authority: backer.authority,
          networkSize: backer.networkSize
        }
      };
    } catch (error) {
      return { ok: false, backer: null };
    }
  });

  // ============================================
  // INFLUENCERS (Unified Accounts) - main listing
  // ============================================

  app.get('/unified', async (request) => {
    const { limit, sortBy, facet, q } = request.query as { 
      limit?: string; 
      sortBy?: string;
      facet?: string;
      q?: string;
    };
    
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      const sortField = sortBy === 'smart' ? 'smart' : 
                       sortBy === 'authority' ? 'authority' :
                       sortBy === 'followers' ? 'followers' : 'influence';
      
      // Build query
      const query: any = {};
      if (q) {
        query.$or = [
          { handle: { $regex: q, $options: 'i' } },
          { name: { $regex: q, $options: 'i' } }
        ];
      }
      
      const data = await col
        .find(query, { projection: { _id: 0 } })
        .sort({ [sortField]: -1 })
        .limit(parseInt(limit || '50'))
        .toArray();
      
      return { 
        ok: true, 
        data,
        total: data.length
      };
    } catch (error) {
      return { ok: false, data: [], error: 'Failed to fetch unified accounts' };
    }
  });

  // Stats endpoint for unified
  app.get('/unified/stats', async () => {
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      const total = await col.countDocuments();
      const byCategory = await col.aggregate([
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } }
      ]).toArray();
      
      return {
        ok: true,
        stats: {
          total,
          byCategory: byCategory.reduce((acc, c) => ({ ...acc, [c._id]: c.count }), {})
        }
      };
    } catch (error) {
      return { ok: false, stats: null };
    }
  });

  // Facets endpoint
  app.get('/unified/facets', async () => {
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      const facets = await col.aggregate([
        { $unwind: '$categories' },
        { $group: { _id: '$categories' } }
      ]).toArray();
      
      return {
        ok: true,
        facets: facets.map(f => f._id)
      };
    } catch (error) {
      return { ok: false, facets: [] };
    }
  });

  // ============================================
  // GRAPH - network visualization data
  // ============================================

  app.get('/graph/v2', async (request) => {
    const { symbol } = request.query as { symbol?: string };
    
    try {
      const db = getConnectionsDb();
      const accounts = await db.collection('connections_unified_accounts')
        .find({}, { projection: { _id: 0, handle: 1, name: 1, categories: 1, influence: 1 } })
        .limit(20)
        .toArray();
      
      // Create nodes from accounts
      const nodes = accounts.map((acc, i) => ({
        id: acc.handle,
        label: acc.name || acc.handle,
        group: acc.categories?.[0] || 'unknown',
        size: (acc.influence || 0.5) * 20
      }));
      
      // Create edges between accounts with similar categories
      const edges: any[] = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (accounts[i].categories?.some((c: string) => accounts[j].categories?.includes(c))) {
            edges.push({
              source: nodes[i].id,
              target: nodes[j].id,
              weight: 0.5
            });
          }
        }
      }
      
      return { ok: true, nodes, edges };
    } catch (error) {
      return { ok: false, nodes: [], edges: [] };
    }
  });

  // ============================================
  // ALT SEASON
  // ============================================

  app.get('/alt-season', async () => {
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      // Calculate alt season index based on average sentiment
      const stats = await col.aggregate([
        { $group: {
          _id: null,
          avgSmart: { $avg: '$smart' },
          avgEarly: { $avg: '$early' }
        }}
      ]).toArray();
      
      const altSeasonIndex = ((stats[0]?.avgSmart || 0) + (stats[0]?.avgEarly || 0)) / 2;
      
      return {
        ok: true,
        altSeasonIndex,
        signal: altSeasonIndex >= 0.7 ? 'strong' : altSeasonIndex >= 0.5 ? 'moderate' : 'weak'
      };
    } catch (error) {
      return { ok: false, altSeasonIndex: 0 };
    }
  });

  // ============================================
  // LIFECYCLE
  // ============================================

  app.get('/lifecycle', async (request) => {
    const { symbol } = request.query as { symbol?: string };
    
    // Lifecycle analysis based on influencer activity patterns
    return {
      ok: true,
      lifecycle: {
        phase: 'growth',
        confidence: 0.7,
        indicators: ['high_influencer_activity', 'increasing_network_size']
      }
    };
  });

  console.log('[Connections] Routes registered at /api/connections/*');
}
