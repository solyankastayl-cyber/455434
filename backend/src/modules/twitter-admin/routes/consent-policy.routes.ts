/**
 * Admin Consent Policy Routes
 * 
 * Management of versioned data usage policies:
 * - List all policy versions
 * - Create new draft
 * - Edit draft
 * - Publish new version
 * - View consent statistics
 * - Force re-consent for all users
 */

import type { FastifyInstance } from 'fastify';
import { getRequestAdmin } from '../auth/require-admin.hook.js';
import { integrationPolicyService } from '../../twitter-user/services/integration-policy.service.js';
import { IntegrationPolicyModel } from '../../twitter-user/models/integration-policy.model.js';
import { IntegrationConsentLogModel } from '../../twitter-user/models/integration-consent-log.model.js';

export async function registerConsentPolicyRoutes(app: FastifyInstance) {
  console.log('[BOOT] Registering consent policy routes');
  
  // ============================================
  // Policy CRUD
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/consent-policies
   * List all policy versions for a slug
   */
  app.get('/api/v4/admin/twitter/consent-policies', async (req, reply) => {
    try {
      const query = req.query as { slug?: string };
      const slug = query.slug || 'twitter-data-usage';
      
      const policies = await IntegrationPolicyModel.find({ slug })
        .sort({ createdAt: -1 })
        .lean();
      
      // Get consent stats for each version
      const policiesWithStats = await Promise.all(
        policies.map(async (p) => {
          const totalConsents = await IntegrationConsentLogModel.countDocuments({
            policySlug: p.slug,
            policyVersion: p.version,
            revokedAt: null,
          });
          
          return {
            id: p._id.toString(),
            slug: p.slug,
            version: p.version,
            title: p.title,
            isActive: p.isActive,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            contentPreview: p.contentMarkdown.slice(0, 200) + '...',
            stats: {
              activeConsents: totalConsents,
            },
          };
        })
      );
      
      return reply.send({
        ok: true,
        data: policiesWithStats,
      });
    } catch (err: any) {
      app.log.error(err, 'List consent policies error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/consent-policies/:policyId
   * Get full policy content
   */
  app.get('/api/v4/admin/twitter/consent-policies/:policyId', async (req, reply) => {
    try {
      const { policyId } = req.params as { policyId: string };
      
      const policy = await IntegrationPolicyModel.findById(policyId).lean();
      
      if (!policy) {
        return reply.code(404).send({
          ok: false,
          error: 'POLICY_NOT_FOUND',
        });
      }
      
      // Get consent stats
      const totalConsents = await IntegrationConsentLogModel.countDocuments({
        policySlug: policy.slug,
        policyVersion: policy.version,
        revokedAt: null,
      });
      
      const recentConsents = await IntegrationConsentLogModel.find({
        policySlug: policy.slug,
        policyVersion: policy.version,
      })
        .sort({ acceptedAt: -1 })
        .limit(10)
        .lean();
      
      return reply.send({
        ok: true,
        data: {
          id: policy._id.toString(),
          slug: policy.slug,
          version: policy.version,
          title: policy.title,
          contentMarkdown: policy.contentMarkdown,
          isActive: policy.isActive,
          createdAt: policy.createdAt,
          updatedAt: policy.updatedAt,
          stats: {
            activeConsents: totalConsents,
            recentConsents: recentConsents.map(c => ({
              userId: c.userId,
              acceptedAt: c.acceptedAt,
              revokedAt: c.revokedAt,
            })),
          },
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get consent policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/consent-policies
   * Create new policy draft
   */
  app.post('/api/v4/admin/twitter/consent-policies', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const body = req.body as {
        slug?: string;
        version: string;
        title: string;
        contentMarkdown: string;
      };
      
      if (!body.version || !body.title || !body.contentMarkdown) {
        return reply.code(400).send({
          ok: false,
          error: 'MISSING_FIELDS',
          message: 'version, title, and contentMarkdown are required',
        });
      }
      
      const slug = body.slug || 'twitter-data-usage';
      
      // Check if version already exists
      const existing = await IntegrationPolicyModel.findOne({
        slug,
        version: body.version,
      });
      
      if (existing) {
        return reply.code(409).send({
          ok: false,
          error: 'VERSION_EXISTS',
          message: `Policy version ${body.version} already exists`,
        });
      }
      
      // Create new draft (isActive: false)
      const policy = await IntegrationPolicyModel.create({
        slug,
        version: body.version,
        title: body.title,
        contentMarkdown: body.contentMarkdown,
        isActive: false,
      });
      
      app.log.info(`[ConsentPolicy] Admin ${admin.id} created draft v${body.version}`);
      
      return reply.code(201).send({
        ok: true,
        data: {
          id: policy._id.toString(),
          slug: policy.slug,
          version: policy.version,
          title: policy.title,
          isActive: policy.isActive,
          createdAt: policy.createdAt,
        },
        message: 'Policy draft created',
      });
    } catch (err: any) {
      app.log.error(err, 'Create consent policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * PUT /api/v4/admin/twitter/consent-policies/:policyId
   * Update policy draft (only non-active policies)
   */
  app.put('/api/v4/admin/twitter/consent-policies/:policyId', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { policyId } = req.params as { policyId: string };
      const body = req.body as {
        title?: string;
        contentMarkdown?: string;
      };
      
      const policy = await IntegrationPolicyModel.findById(policyId);
      
      if (!policy) {
        return reply.code(404).send({
          ok: false,
          error: 'POLICY_NOT_FOUND',
        });
      }
      
      if (policy.isActive) {
        return reply.code(400).send({
          ok: false,
          error: 'CANNOT_EDIT_ACTIVE',
          message: 'Cannot edit active policy. Create a new version instead.',
        });
      }
      
      // Update draft
      if (body.title) policy.title = body.title;
      if (body.contentMarkdown) policy.contentMarkdown = body.contentMarkdown;
      await policy.save();
      
      app.log.info(`[ConsentPolicy] Admin ${admin.id} updated draft v${policy.version}`);
      
      return reply.send({
        ok: true,
        data: {
          id: policy._id.toString(),
          slug: policy.slug,
          version: policy.version,
          title: policy.title,
          isActive: policy.isActive,
          updatedAt: policy.updatedAt,
        },
        message: 'Policy draft updated',
      });
    } catch (err: any) {
      app.log.error(err, 'Update consent policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * DELETE /api/v4/admin/twitter/consent-policies/:policyId
   * Delete policy draft (only non-active policies)
   */
  app.delete('/api/v4/admin/twitter/consent-policies/:policyId', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { policyId } = req.params as { policyId: string };
      
      const policy = await IntegrationPolicyModel.findById(policyId);
      
      if (!policy) {
        return reply.code(404).send({
          ok: false,
          error: 'POLICY_NOT_FOUND',
        });
      }
      
      if (policy.isActive) {
        return reply.code(400).send({
          ok: false,
          error: 'CANNOT_DELETE_ACTIVE',
          message: 'Cannot delete active policy.',
        });
      }
      
      await IntegrationPolicyModel.deleteOne({ _id: policyId });
      
      app.log.info(`[ConsentPolicy] Admin ${admin.id} deleted draft v${policy.version}`);
      
      return reply.send({
        ok: true,
        message: `Policy draft v${policy.version} deleted`,
      });
    } catch (err: any) {
      app.log.error(err, 'Delete consent policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Publish & Re-consent
  // ============================================
  
  /**
   * POST /api/v4/admin/twitter/consent-policies/:policyId/publish
   * Publish a policy draft (makes it active, deactivates previous)
   */
  app.post('/api/v4/admin/twitter/consent-policies/:policyId/publish', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { policyId } = req.params as { policyId: string };
      
      const policy = await IntegrationPolicyModel.findById(policyId);
      
      if (!policy) {
        return reply.code(404).send({
          ok: false,
          error: 'POLICY_NOT_FOUND',
        });
      }
      
      if (policy.isActive) {
        return reply.code(400).send({
          ok: false,
          error: 'ALREADY_ACTIVE',
          message: 'This policy is already active.',
        });
      }
      
      // Deactivate all other policies with same slug
      await IntegrationPolicyModel.updateMany(
        { slug: policy.slug, isActive: true },
        { $set: { isActive: false } }
      );
      
      // Activate this policy
      policy.isActive = true;
      await policy.save();
      
      // Count affected users (users who consented to previous versions)
      const affectedUsers = await IntegrationConsentLogModel.distinct('userId', {
        policySlug: policy.slug,
        policyVersion: { $ne: policy.version },
        revokedAt: null,
      });
      
      app.log.info(`[ConsentPolicy] Admin ${admin.id} published v${policy.version}. ${affectedUsers.length} users require re-consent.`);
      
      return reply.send({
        ok: true,
        data: {
          id: policy._id.toString(),
          version: policy.version,
          isActive: true,
          affectedUsersCount: affectedUsers.length,
        },
        message: `Policy v${policy.version} is now active. ${affectedUsers.length} users will be required to re-consent.`,
      });
    } catch (err: any) {
      app.log.error(err, 'Publish consent policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/consent-policies/force-reconsent
   * Force all users to re-consent (invalidates all existing consents)
   */
  app.post('/api/v4/admin/twitter/consent-policies/force-reconsent', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const body = req.body as { slug?: string; reason?: string };
      const slug = body.slug || 'twitter-data-usage';
      
      // Get current active policy
      const activePolicy = await IntegrationPolicyModel.findOne({ slug, isActive: true });
      
      if (!activePolicy) {
        return reply.code(400).send({
          ok: false,
          error: 'NO_ACTIVE_POLICY',
          message: 'No active policy found',
        });
      }
      
      // Revoke all existing consents
      const result = await IntegrationConsentLogModel.updateMany(
        { policySlug: slug, revokedAt: null },
        { 
          $set: { 
            revokedAt: new Date(), 
            revokeReason: body.reason || 'Admin forced re-consent' 
          } 
        }
      );
      
      app.log.info(`[ConsentPolicy] Admin ${admin.id} forced re-consent for ${slug}. ${result.modifiedCount} consents revoked.`);
      
      return reply.send({
        ok: true,
        data: {
          revokedCount: result.modifiedCount,
          activeVersion: activePolicy.version,
        },
        message: `${result.modifiedCount} consents revoked. All users must re-accept policy.`,
      });
    } catch (err: any) {
      app.log.error(err, 'Force re-consent error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Consent Statistics
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/consent-policies/stats
   * Get overall consent statistics
   */
  app.get('/api/v4/admin/twitter/consent-policies/stats', async (req, reply) => {
    try {
      const query = req.query as { slug?: string };
      const slug = query.slug || 'twitter-data-usage';
      
      // Get active policy
      const activePolicy = await IntegrationPolicyModel.findOne({ slug, isActive: true }).lean();
      
      if (!activePolicy) {
        return reply.send({
          ok: true,
          data: {
            hasActivePolicy: false,
            stats: null,
          },
        });
      }
      
      // Count consents
      const [
        totalActiveConsents,
        consentsForCurrentVersion,
        outdatedConsents,
        revokedConsents,
      ] = await Promise.all([
        IntegrationConsentLogModel.countDocuments({
          policySlug: slug,
          revokedAt: null,
        }),
        IntegrationConsentLogModel.countDocuments({
          policySlug: slug,
          policyVersion: activePolicy.version,
          revokedAt: null,
        }),
        IntegrationConsentLogModel.countDocuments({
          policySlug: slug,
          policyVersion: { $ne: activePolicy.version },
          revokedAt: null,
        }),
        IntegrationConsentLogModel.countDocuments({
          policySlug: slug,
          revokedAt: { $ne: null },
        }),
      ]);
      
      // Recent consent activity (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const recentConsents = await IntegrationConsentLogModel.countDocuments({
        policySlug: slug,
        acceptedAt: { $gte: sevenDaysAgo },
        revokedAt: null,
      });
      
      return reply.send({
        ok: true,
        data: {
          hasActivePolicy: true,
          activePolicy: {
            version: activePolicy.version,
            title: activePolicy.title,
            createdAt: activePolicy.createdAt,
          },
          stats: {
            totalActiveConsents,
            consentsForCurrentVersion,
            outdatedConsents, // Users who need to re-consent
            revokedConsents,
            recentConsents7d: recentConsents,
          },
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get consent stats error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/consent-policies/logs
   * Get consent audit log
   */
  app.get('/api/v4/admin/twitter/consent-policies/logs', async (req, reply) => {
    try {
      const query = req.query as { 
        slug?: string; 
        userId?: string;
        limit?: string;
        includeRevoked?: string;
      };
      
      const slug = query.slug || 'twitter-data-usage';
      const limit = Math.min(parseInt(query.limit || '50', 10), 200);
      const includeRevoked = query.includeRevoked === 'true';
      
      const filter: any = { policySlug: slug };
      if (query.userId) filter.userId = query.userId;
      if (!includeRevoked) filter.revokedAt = null;
      
      const logs = await IntegrationConsentLogModel.find(filter)
        .sort({ acceptedAt: -1 })
        .limit(limit)
        .lean();
      
      return reply.send({
        ok: true,
        data: logs.map(l => ({
          id: l._id.toString(),
          userId: l.userId,
          policyVersion: l.policyVersion,
          acceptedAt: l.acceptedAt,
          revokedAt: l.revokedAt,
          revokeReason: l.revokeReason,
          ip: l.ip,
        })),
      });
    } catch (err: any) {
      app.log.error(err, 'Get consent logs error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
