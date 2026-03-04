/**
 * DEBUG Routes - Session Selector Diagnostics
 */
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { requireUser } from '../auth/require-user.hook.js';
import { userScope } from '../acl/ownership.js';
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../models/twitter-session.model.js';

export async function registerDebugRoutes(app: FastifyInstance) {
  /**
   * GET /api/v4/twitter/debug/selector
   * 
   * Debug endpoint to see exact query and results
   */
  app.get('/api/v4/twitter/debug/selector', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);

      const result: any = {
        userId: u.id,
        userIdType: typeof u.id,
        scope,
        accounts: [],
        sessions: [],
        queries: [],
      };

      // Get accounts
      const accounts = await UserTwitterAccountModel.find({
        ...scope,
        enabled: true,
      }).lean();

      result.accounts = accounts.map(a => ({
        id: String(a._id),
        username: a.username,
        enabled: a.enabled,
        ownerUserId: a.ownerUserId,
        ownerType: a.ownerType,
      }));

      // For each account, try to find sessions
      for (const account of accounts) {
        const accountIdStr = String(account._id);
        const accountObjectId = account._id; // Already ObjectId from Mongoose
        
        // Query 1: Exact as selector does (with ObjectId)
        const query1 = {
          ...scope,
          accountId: accountObjectId,  // ObjectId
          isActive: true,
          status: 'OK',
        };

        result.queries.push({
          accountId: accountIdStr,
          query: 'ObjectId query',
          accountIdType: typeof account._id,
          accountIdIsObjectId: account._id instanceof mongoose.Types.ObjectId,
        });

        const session1 = await UserTwitterSessionModel.findOne(query1).lean();

        if (session1) {
          result.sessions.push({
            id: String(session1._id),
            accountId: String(session1.accountId),
            accountIdType: typeof session1.accountId,
            status: session1.status,
            isActive: session1.isActive,
            ownerUserId: session1.ownerUserId,
            ownerType: session1.ownerType,
            foundBy: 'query1-objectid',
          });
        }

        // Query 2: Try with string accountId
        const query2 = {
          ...scope,
          accountId: accountIdStr,  // String
          isActive: true,
          status: 'OK',
        };

        const session2 = await UserTwitterSessionModel.findOne(query2).lean();

        if (session2 && !session1) {
          result.sessions.push({
            id: String(session2._id),
            accountId: String(session2.accountId),
            accountIdType: typeof session2.accountId,
            status: session2.status,
            isActive: session2.isActive,
            ownerUserId: session2.ownerUserId,
            ownerType: session2.ownerType,
            foundBy: 'query2-string',
          });
        }

        // Query 3: Get all sessions for this account (no filters)
        const allSessions = await UserTwitterSessionModel.find({
          ...scope,
          accountId: accountObjectId,
        }).lean();

        result.queries.push({
          accountId: accountIdStr,
          allSessionsCount: allSessions.length,
          statuses: allSessions.map(s => ({ status: s.status, isActive: s.isActive })),
        });
      }

      return reply.send({
        ok: true,
        debug: result,
      });
    } catch (err: any) {
      app.log.error(err, 'Debug selector error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
