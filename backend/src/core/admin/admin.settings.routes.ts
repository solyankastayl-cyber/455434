/**
 * Admin Settings Routes
 * 
 * GET  /api/admin/settings - All settings
 * GET  /api/admin/settings/:category - Category settings
 * POST /api/admin/settings/:category/update - Update settings
 * POST /api/admin/settings/:category/reset - Reset to defaults
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { logAdminAction } from './admin.audit.js';
import {
  getSettings,
  getAllSettings,
  updateSettings,
  resetSettings,
  SettingsCategory,
} from './admin.settings.service.js';

const VALID_CATEGORIES: SettingsCategory[] = ['system', 'networks', 'ml', 'market'];

export async function adminSettingsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/settings
   * Get all settings categories
   */
  app.get(
    '/settings',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await getAllSettings();
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminSettings] Error getting all:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to get settings',
        });
      }
    }
  );

  /**
   * GET /admin/settings/:category
   * Get specific category settings
   */
  app.get(
    '/settings/:category',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Params: { category: string } }>, reply: FastifyReply) => {
      const { category } = request.params;
      
      if (!VALID_CATEGORIES.includes(category as SettingsCategory)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_CATEGORY',
          message: `Valid categories: ${VALID_CATEGORIES.join(', ')}`,
        });
      }
      
      try {
        const data = await getSettings(category as SettingsCategory);
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminSettings] Error getting category:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to get settings',
        });
      }
    }
  );

  /**
   * POST /admin/settings/:category/update
   * Update category settings (ADMIN only)
   */
  app.post(
    '/settings/:category/update',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: { category: string } }>, reply: FastifyReply) => {
      const { category } = request.params;
      const admin = request.admin!;
      const payload = request.body as Record<string, any>;
      
      if (!VALID_CATEGORIES.includes(category as SettingsCategory)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_CATEGORY',
          message: `Valid categories: ${VALID_CATEGORIES.join(', ')}`,
        });
      }
      
      try {
        const data = await updateSettings(
          category as SettingsCategory,
          payload,
          admin.sub,
          admin.role
        );
        
        // Audit log
        await logAdminAction({
          adminId: admin.sub,
          adminUsername: admin.role,
          action: 'SETTINGS_UPDATE',
          resource: `settings/${category}`,
          payload,
          result: 'success',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });
        
        return reply.send({
          ok: true,
          message: `Settings ${category} updated`,
          data,
        });
      } catch (err: any) {
        console.error('[AdminSettings] Error updating:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to update settings',
        });
      }
    }
  );

  /**
   * POST /admin/settings/:category/reset
   * Reset category to defaults (ADMIN only)
   */
  app.post(
    '/settings/:category/reset',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: { category: string } }>, reply: FastifyReply) => {
      const { category } = request.params;
      const admin = request.admin!;
      
      if (!VALID_CATEGORIES.includes(category as SettingsCategory)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_CATEGORY',
          message: `Valid categories: ${VALID_CATEGORIES.join(', ')}`,
        });
      }
      
      try {
        const data = await resetSettings(
          category as SettingsCategory,
          admin.sub,
          admin.role
        );
        
        // Audit log
        await logAdminAction({
          adminId: admin.sub,
          adminUsername: admin.role,
          action: 'SETTINGS_RESET',
          resource: `settings/${category}`,
          result: 'success',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });
        
        return reply.send({
          ok: true,
          message: `Settings ${category} reset to defaults`,
          data,
        });
      } catch (err: any) {
        console.error('[AdminSettings] Error resetting:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to reset settings',
        });
      }
    }
  );

  console.log('[Admin] Settings routes registered');
}

export default adminSettingsRoutes;
