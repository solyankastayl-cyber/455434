/**
 * Wallet Routes (B1 + B2 + B3 + B4 + P2.1)
 * 
 * API endpoints for wallet profiles, token correlations, clusters, smart money, and pattern detection
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { walletProfileEngine, RawWalletData } from './wallet_profile.engine.js';
import { walletTokenCorrelationEngine } from './wallet_token_correlation.engine.js';
import { walletClusterEngine } from './wallet_cluster.engine.js';
import { smartMoneyEngine } from './smart_money_profile.engine.js';
import * as patternService from './pattern_detection.service.js';
import type { WalletTag } from './wallet_profile.schema.js';
import type { SmartLabel } from './smart_money_profile.schema.js';

interface WalletParams {
  address: string;
}

interface ClusterParams {
  id: string;
}

interface SearchQuery {
  tags?: string;
  limit?: string;
}

interface BuildProfileBody {
  address: string;
  chain?: string;
  transactions: RawWalletData['transactions'];
  isContract?: boolean;
  labels?: string[];
}

export async function walletRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/wallets/:address/patterns
   * Analyze wallet for bot/farm patterns (P2.1)
   */
  fastify.get<{ Params: WalletParams }>(
    '/wallets/:address/patterns',
    async (request, reply) => {
      const { address } = request.params;
      
      try {
        const result = await patternService.analyzeWalletPatterns(address);
        
        // Remove internal confidence from response
        const { confidence, ...publicResult } = result;
        
        return reply.send({ ok: true, data: publicResult });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'PATTERN_ANALYSIS_FAILED'
        });
      }
    }
  );

  /**
   * GET /api/wallets/:address
   * Get wallet profile by address
   */
  fastify.get<{ Params: WalletParams; Querystring: { chain?: string } }>(
    '/wallets/:address',
    async (request, reply) => {
      const { address } = request.params;
      const chain = request.query.chain || 'Ethereum';
      
      try {
        const profile = await walletProfileEngine.getProfileByAddress(
          address.toLowerCase(),
          chain
        );
        
        if (!profile) {
          return reply.status(404).send({
            error: 'Profile not found',
            message: `No profile found for address ${address} on ${chain}`,
          });
        }
        
        // Return clean JSON (exclude MongoDB _id)
        const { ...cleanProfile } = profile as any;
        delete cleanProfile._id;
        delete cleanProfile.__v;
        
        return reply.send(cleanProfile);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Failed to get wallet profile',
        });
      }
    }
  );

  /**
   * POST /api/wallets/profile
   * Build or refresh wallet profile
   */
  fastify.post<{ Body: BuildProfileBody }>(
    '/wallets/profile',
    async (request, reply) => {
      const { address, chain, transactions, isContract, labels } = request.body;
      
      if (!address) {
        return reply.status(400).send({
          error: 'Address is required',
        });
      }
      
      if (!transactions || transactions.length === 0) {
        return reply.status(400).send({
          error: 'Transactions array is required and cannot be empty',
        });
      }
      
      try {
        const rawData: RawWalletData = {
          address: address.toLowerCase(),
          chain: chain || 'Ethereum',
          transactions: transactions.map(tx => ({
            ...tx,
            timestamp: new Date(tx.timestamp),
          })),
          isContract,
          labels,
        };
        
        const profile = await walletProfileEngine.buildProfile(rawData);
        
        // Return clean JSON
        const { ...cleanProfile } = profile as any;
        delete cleanProfile._id;
        delete cleanProfile.__v;
        
        return reply.status(201).send(cleanProfile);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Failed to build wallet profile',
        });
      }
    }
  );

  /**
   * GET /api/wallets/search
   * Search wallets by tags
   */
  fastify.get<{ Querystring: SearchQuery }>(
    '/wallets/search',
    async (request, reply) => {
      const { tags, limit } = request.query;
      
      try {
        let profiles;
        
        if (tags) {
          const tagList = tags.split(',').map(t => t.trim()) as WalletTag[];
          profiles = await walletProfileEngine.searchByTags(
            tagList,
            parseInt(limit || '50')
          );
        } else {
          // Return high-volume wallets by default
          profiles = await walletProfileEngine.getHighVolumeWallets(
            parseInt(limit || '20')
          );
        }
        
        // Clean MongoDB fields
        const cleanProfiles = profiles.map(p => {
          const { ...clean } = p as any;
          delete clean._id;
          delete clean.__v;
          return clean;
        });
        
        return reply.send({
          count: cleanProfiles.length,
          profiles: cleanProfiles,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Failed to search wallets',
        });
      }
    }
  );

  /**
   * GET /api/wallets/high-volume
   * Get high-volume wallets
   */
  fastify.get<{ Querystring: { limit?: string } }>(
    '/wallets/high-volume',
    async (request, reply) => {
      const limit = parseInt(request.query.limit || '20');
      
      try {
        const profiles = await walletProfileEngine.getHighVolumeWallets(limit);
        
        const cleanProfiles = profiles.map(p => {
          const { ...clean } = p as any;
          delete clean._id;
          delete clean.__v;
          return clean;
        });
        
        return reply.send({
          count: cleanProfiles.length,
          profiles: cleanProfiles,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Failed to get high-volume wallets',
        });
      }
    }
  );

  /**
   * GET /api/wallets/tags
   * Get available wallet tags
   */
  fastify.get('/wallets/tags', async (request, reply) => {
    const tags = {
      activity: ['active', 'dormant', 'new'],
      volume: ['high-volume', 'low-volume', 'whale'],
      behavior: ['trader', 'holder', 'flipper', 'degen'],
      technical: ['bridge-user', 'cex-like', 'contract', 'multisig'],
    };
    
    return reply.send(tags);
  });

  // ========== B2: Wallet Token Correlation Routes ==========

  /**
   * GET /api/tokens/:address/drivers
   * Get wallets driving activity on this token
   * "Who is driving this activity?"
   */
  fastify.get<{ Params: { address: string }; Querystring: { chain?: string; limit?: string } }>(
    '/tokens/:address/drivers',
    async (request, reply) => {
      const { address } = request.params;
      const chain = request.query.chain || 'Ethereum';
      const limit = parseInt(request.query.limit || '5');
      
      try {
        const drivers = await walletTokenCorrelationEngine.getTokenActivityDrivers(
          address,
          chain,
          limit
        );
        
        if (!drivers) {
          return reply.send({
            ok: true,
            data: null,
            message: 'No activity data available for this token',
          });
        }
        
        return reply.send({
          ok: true,
          data: drivers,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get token drivers',
        });
      }
    }
  );

  /**
   * POST /api/tokens/:address/drivers/calculate
   * Trigger fresh correlation calculation
   */
  fastify.post<{ Params: { address: string }; Body: { chain?: string; windowHours?: number } }>(
    '/tokens/:address/drivers/calculate',
    async (request, reply) => {
      const { address } = request.params;
      const { chain = 'Ethereum', windowHours = 24 } = request.body || {};
      
      try {
        const correlations = await walletTokenCorrelationEngine.calculateTokenCorrelations(
          address,
          chain,
          windowHours
        );
        
        return reply.send({
          ok: true,
          data: {
            calculated: correlations.length,
            topDriver: correlations[0] || null,
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to calculate correlations',
        });
      }
    }
  );

  /**
   * GET /api/wallets/:address/token-influence
   * Get tokens where this wallet has influence
   */
  fastify.get<{ Params: WalletParams; Querystring: { limit?: string } }>(
    '/wallets/:address/token-influence',
    async (request, reply) => {
      const { address } = request.params;
      const limit = parseInt(request.query.limit || '10');
      
      try {
        const correlations = await walletTokenCorrelationEngine.getWalletCorrelations(
          address,
          limit
        );
        
        return reply.send({
          ok: true,
          data: correlations,
          count: correlations.length,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get wallet correlations',
        });
      }
    }
  );

  /**
   * GET /api/alerts/groups/:groupId/drivers
   * Get wallet drivers for an alert group
   */
  fastify.get<{ Params: { groupId: string } }>(
    '/alerts/groups/:groupId/drivers',
    async (request, reply) => {
      const { groupId } = request.params;
      
      try {
        const drivers = await walletTokenCorrelationEngine.getAlertGroupDrivers(groupId);
        
        return reply.send({
          ok: true,
          data: drivers,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get alert group drivers',
        });
      }
    }
  );

  /**
   * POST /api/alerts/groups/:groupId/drivers/link
   * Link drivers to an alert group
   */
  fastify.post<{ Params: { groupId: string }; Body: { tokenAddress: string; chain?: string } }>(
    '/alerts/groups/:groupId/drivers/link',
    async (request, reply) => {
      const { groupId } = request.params;
      const { tokenAddress, chain = 'Ethereum' } = request.body || {};
      
      if (!tokenAddress) {
        return reply.status(400).send({
          ok: false,
          error: 'tokenAddress is required',
        });
      }
      
      try {
        const drivers = await walletTokenCorrelationEngine.linkDriversToAlertGroup(
          groupId,
          tokenAddress,
          chain
        );
        
        return reply.send({
          ok: true,
          data: drivers,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to link drivers to alert group',
        });
      }
    }
  );

  // ========== B3: Wallet Clusters Routes ==========

  /**
   * GET /api/wallets/:address/clusters
   * Get clusters for a wallet
   */
  fastify.get<{ Params: WalletParams }>(
    '/wallets/:address/clusters',
    async (request, reply) => {
      const { address } = request.params;
      
      try {
        const clusters = await walletClusterEngine.getWalletClusters(address);
        
        return reply.send({
          ok: true,
          data: clusters,
          count: clusters.length,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get wallet clusters',
        });
      }
    }
  );

  /**
   * POST /api/wallets/:address/clusters/analyze
   * Analyze and find related wallets
   */
  fastify.post<{ Params: WalletParams; Body: { chain?: string } }>(
    '/wallets/:address/clusters/analyze',
    async (request, reply) => {
      const { address } = request.params;
      const { chain = 'Ethereum' } = request.body || {};
      
      try {
        const cluster = await walletClusterEngine.findRelatedWallets(address, chain);
        
        if (!cluster) {
          return reply.send({
            ok: true,
            data: null,
            message: 'No related wallets found',
          });
        }
        
        return reply.send({
          ok: true,
          data: cluster,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to analyze wallet relationships',
        });
      }
    }
  );

  /**
   * GET /api/clusters/:id
   * Get cluster by ID
   */
  fastify.get<{ Params: ClusterParams }>(
    '/clusters/:id',
    async (request, reply) => {
      const { id } = request.params;
      
      try {
        const cluster = await walletClusterEngine.getCluster(id);
        
        if (!cluster) {
          return reply.status(404).send({
            ok: false,
            error: 'Cluster not found',
          });
        }
        
        return reply.send({
          ok: true,
          data: cluster,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get cluster',
        });
      }
    }
  );

  /**
   * GET /api/clusters/:id/review
   * Get cluster for review (detailed evidence)
   */
  fastify.get<{ Params: ClusterParams }>(
    '/clusters/:id/review',
    async (request, reply) => {
      const { id } = request.params;
      
      try {
        const review = await walletClusterEngine.getClusterForReview(id);
        
        if (!review) {
          return reply.status(404).send({
            ok: false,
            error: 'Cluster not found',
          });
        }
        
        return reply.send({
          ok: true,
          data: review,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get cluster review',
        });
      }
    }
  );

  /**
   * POST /api/clusters/:id/confirm
   * Confirm a cluster (user action)
   */
  fastify.post<{ Params: ClusterParams; Body: { notes?: string } }>(
    '/clusters/:id/confirm',
    async (request, reply) => {
      const { id } = request.params;
      const { notes } = request.body || {};
      
      try {
        const cluster = await walletClusterEngine.confirmCluster(id, notes);
        
        if (!cluster) {
          return reply.status(404).send({
            ok: false,
            error: 'Cluster not found',
          });
        }
        
        return reply.send({
          ok: true,
          data: cluster,
          message: 'Cluster confirmed',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to confirm cluster',
        });
      }
    }
  );

  /**
   * POST /api/clusters/:id/reject
   * Reject a cluster (user action)
   */
  fastify.post<{ Params: ClusterParams; Body: { notes?: string } }>(
    '/clusters/:id/reject',
    async (request, reply) => {
      const { id } = request.params;
      const { notes } = request.body || {};
      
      try {
        const cluster = await walletClusterEngine.rejectCluster(id, notes);
        
        if (!cluster) {
          return reply.status(404).send({
            ok: false,
            error: 'Cluster not found',
          });
        }
        
        return reply.send({
          ok: true,
          data: cluster,
          message: 'Cluster rejected',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to reject cluster',
        });
      }
    }
  );

  // ========== B4: Smart Money Routes ==========

  /**
   * GET /api/wallets/:address/smart-profile
   * Get wallet's smart money profile
   */
  fastify.get<{ Params: WalletParams; Querystring: { chain?: string } }>(
    '/wallets/:address/smart-profile',
    async (request, reply) => {
      const { address } = request.params;
      const chain = request.query.chain || 'Ethereum';
      
      try {
        const profile = await smartMoneyEngine.getWalletProfile(address);
        
        if (!profile) {
          return reply.send({
            ok: true,
            data: null,
            message: 'Not enough data to calculate smart money profile',
          });
        }
        
        return reply.send({
          ok: true,
          data: profile,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get smart money profile',
        });
      }
    }
  );

  /**
   * POST /api/wallets/:address/smart-profile/calculate
   * Force recalculate smart money profile
   */
  fastify.post<{ Params: WalletParams; Body: { chain?: string } }>(
    '/wallets/:address/smart-profile/calculate',
    async (request, reply) => {
      const { address } = request.params;
      const { chain = 'Ethereum' } = request.body || {};
      
      try {
        const profile = await smartMoneyEngine.calculateWalletProfile(address, chain);
        
        if (!profile) {
          return reply.send({
            ok: true,
            data: null,
            message: 'Not enough data to calculate smart money profile',
          });
        }
        
        return reply.send({
          ok: true,
          data: profile,
          message: 'Profile calculated',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to calculate smart money profile',
        });
      }
    }
  );

  /**
   * GET /api/clusters/:id/smart-profile
   * Get cluster's smart money profile
   */
  fastify.get<{ Params: ClusterParams }>(
    '/clusters/:id/smart-profile',
    async (request, reply) => {
      const { id } = request.params;
      
      try {
        const profile = await smartMoneyEngine.getClusterProfile(id);
        
        if (!profile) {
          return reply.send({
            ok: true,
            data: null,
            message: 'Cluster not found or not enough data',
          });
        }
        
        return reply.send({
          ok: true,
          data: profile,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get cluster smart money profile',
        });
      }
    }
  );

  /**
   * GET /api/smart-money/top
   * Get top smart money performers
   */
  fastify.get<{ Querystring: { limit?: string; minLabel?: string } }>(
    '/smart-money/top',
    async (request, reply) => {
      const limit = parseInt(request.query.limit || '10');
      const minLabel = (request.query.minLabel || 'proven') as SmartLabel;
      
      try {
        const profiles = await smartMoneyEngine.getTopPerformers(limit, minLabel);
        
        return reply.send({
          ok: true,
          data: profiles,
          count: profiles.length,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get top performers',
        });
      }
    }
  );

  /**
   * POST /api/smart-money/summary
   * Get smart money summary for a list of wallets
   */
  fastify.post<{ Body: { addresses: string[] } }>(
    '/smart-money/summary',
    async (request, reply) => {
      const { addresses } = request.body || {};
      
      if (!addresses || !Array.isArray(addresses)) {
        return reply.status(400).send({
          ok: false,
          error: 'addresses array is required',
        });
      }
      
      try {
        const summary = await smartMoneyEngine.getSmartMoneySummary(addresses);
        
        return reply.send({
          ok: true,
          data: summary,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get smart money summary',
        });
      }
    }
  );

  /**
   * GET /api/alerts/groups/:groupId/smart-money
   * Get smart money context for alert group
   */
  fastify.get<{ Params: { groupId: string } }>(
    '/alerts/groups/:groupId/smart-money',
    async (request, reply) => {
      const { groupId } = request.params;
      
      try {
        // Get drivers for this group
        const drivers = await walletTokenCorrelationEngine.getAlertGroupDrivers(groupId);
        const driverAddresses = drivers?.drivers?.map(d => d.walletAddress) || [];
        
        const context = await smartMoneyEngine.getAlertSmartMoneyContext(groupId, driverAddresses);
        
        return reply.send({
          ok: true,
          data: context,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get alert smart money context',
        });
      }
    }
  );

  fastify.log.info('Wallet routes registered (B1 + B2 + B3 + B4)');
  
  // ============================================================================
  // WALLET ANALYTICS ENDPOINTS (Mirroring TokensPage)
  // ============================================================================
  
  /**
   * GET /api/wallets/:address/activity-snapshot
   * Wallet Activity Snapshot - inflow/outflow/netFlow
   * 
   * Query params:
   * - window: '24h' | '7d' | '30d' (default: '24h')
   */
  fastify.get<{ Params: WalletParams; Querystring: { window?: string } }>(
    '/wallets/:address/activity-snapshot',
    async (request, reply) => {
      const { address } = request.params;
      // Support 24h, 7d, 30d windows
      let windowHours = 24;
      if (request.query.window === '1h') windowHours = 1;
      else if (request.query.window === '6h') windowHours = 6;
      else if (request.query.window === '24h') windowHours = 24;
      else if (request.query.window === '7d') windowHours = 24 * 7;  // 168 hours
      else if (request.query.window === '30d') windowHours = 24 * 30; // 720 hours
      
      try {
        const { getWalletActivitySnapshot } = await import('./wallet_analytics.service.js');
        const snapshot = await getWalletActivitySnapshot(address, windowHours);
        
        return reply.send({
          ok: true,
          data: snapshot,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get wallet activity snapshot',
        });
      }
    }
  );
  
  /**
   * GET /api/wallets/:address/signals
   * Wallet Signals - deviations from baseline
   * 
   * Query params:
   * - window: '24h' | '7d' | '30d' (default: '24h')
   */
  fastify.get<{ Params: WalletParams; Querystring: { window?: string } }>(
    '/wallets/:address/signals',
    async (request, reply) => {
      const { address } = request.params;
      // Support 24h, 7d, 30d windows (used for baseline calculation)
      let windowHours = 24;
      if (request.query.window === '7d') windowHours = 24 * 7;
      else if (request.query.window === '30d') windowHours = 24 * 30;
      
      try {
        const { getWalletSignals } = await import('./wallet_analytics.service.js');
        const signals = await getWalletSignals(address, windowHours);
        
        return reply.send({
          ok: true,
          data: signals,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get wallet signals',
        });
      }
    }
  );
  
  /**
   * GET /api/wallets/:address/related
   * Related Addresses - timing correlation (B3)
   */
  fastify.get<{ Params: WalletParams }>(
    '/wallets/:address/related',
    async (request, reply) => {
      const { address } = request.params;
      
      try {
        const { getRelatedAddresses } = await import('./wallet_analytics.service.js');
        const related = await getRelatedAddresses(address);
        
        return reply.send({
          ok: true,
          data: related,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get related addresses',
        });
      }
    }
  );
  
  /**
   * GET /api/wallets/:address/performance
   * Wallet Historical Performance (B4)
   */
  fastify.get<{ Params: WalletParams }>(
    '/wallets/:address/performance',
    async (request, reply) => {
      const { address } = request.params;
      
      try {
        const { getWalletHistoricalPerformance } = await import('./wallet_analytics.service.js');
        const performance = await getWalletHistoricalPerformance(address);
        
        return reply.send({
          ok: true,
          data: performance,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to get wallet performance',
        });
      }
    }
  );
}
