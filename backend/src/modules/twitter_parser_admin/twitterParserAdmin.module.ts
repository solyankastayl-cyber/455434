// Twitter Parser Admin Module - v4.0 Control Plane
// Registration and initialization

import { FastifyInstance } from 'fastify';
import { getDb } from '../../db/mongodb.js';
import { TwitterAccountService } from './services/twitterAccount.service.js';
import { TwitterEgressSlotService } from './services/twitterEgressSlot.service.js';
import { registerTwitterAccountRoutes } from './controllers/twitterAccount.controller.js';
import { registerTwitterEgressSlotRoutes } from './controllers/twitterEgressSlot.controller.js';

export async function registerTwitterParserAdminModule(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // Initialize services
  const accountService = new TwitterAccountService(db);
  const slotService = new TwitterEgressSlotService(db, accountService);

  // Ensure indexes
  await accountService.ensureIndexes();
  await slotService.ensureIndexes();

  // Register routes with prefix
  await app.register(
    async (instance) => {
      registerTwitterAccountRoutes(instance, accountService);
      registerTwitterEgressSlotRoutes(instance, slotService, accountService);
    },
    { prefix: '/api/admin/twitter-parser' }
  );

  app.log.info('[Twitter Parser Admin] Module registered at /api/admin/twitter-parser');
}
