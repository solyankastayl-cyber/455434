/**
 * DEV ONLY - Schema Introspection Endpoint
 * Temporary endpoint to peek at collection schemas
 * REMOVE AFTER DATA CONTRACTS ARE DOCUMENTED
 */
import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';

export async function registerDevSchemaRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV !== 'development') {
    return; // Only in dev
  }

  /**
   * GET /api/dev/schema-peek?collection=<name>
   */
  app.get<{
    Querystring: { collection: string };
  }>('/api/dev/schema-peek', async (request, reply) => {
    try {
      const { collection } = request.query;

      if (!collection) {
        return reply.code(400).send({ error: 'collection parameter required' });
      }

      const db = mongoose.connection.db;
      
      if (!db) {
        return reply.code(500).send({ error: 'Database not connected' });
      }

      // Get sample document
      const sample = await db.collection(collection).findOne({});

      if (!sample) {
        return reply.send({
          collection,
          exists: false,
          sample: null,
          schema: null,
        });
      }

      // Extract schema structure (keys only, no values)
      const extractSchema = (obj: any, depth: number = 0, maxDepth: number = 3): any => {
        if (depth > maxDepth || !obj || typeof obj !== 'object') {
          return typeof obj;
        }

        if (Array.isArray(obj)) {
          if (obj.length === 0) return '[]';
          return [extractSchema(obj[0], depth + 1, maxDepth)];
        }

        const schema: any = {};
        for (const key of Object.keys(obj)) {
          if (key === '_id') {
            schema[key] = 'ObjectId';
          } else {
            schema[key] = extractSchema(obj[key], depth + 1, maxDepth);
          }
        }
        return schema;
      };

      const schema = extractSchema(sample);

      // Get collection stats
      const count = await db.collection(collection).countDocuments();

      return reply.send({
        collection,
        exists: true,
        count,
        schema,
        sampleKeys: Object.keys(sample),
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/dev/collections
   * List all available collections
   */
  app.get('/api/dev/collections', async (request, reply) => {
    try {
      const db = mongoose.connection.db;
      
      if (!db) {
        return reply.code(500).send({ error: 'Database not connected' });
      }

      const collections = await db.listCollections().toArray();
      
      const collectionNames = collections.map(c => c.name);

      return reply.send({
        ok: true,
        collections: collectionNames,
        count: collectionNames.length,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  app.log.warn('[DEV] Schema introspection routes registered - REMOVE IN PRODUCTION');
}
