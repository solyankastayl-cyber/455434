import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { env } from '../config/env.js';

/**
 * WebSocket Plugin
 * Sets up WebSocket support if enabled
 */

export async function websocketPlugin(app: FastifyInstance): Promise<void> {
  if (!env.WS_ENABLED) {
    app.log.info('WebSocket disabled');
    return;
  }

  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });

  app.log.info('WebSocket plugin registered');
}
