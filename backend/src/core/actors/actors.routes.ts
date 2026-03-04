/**
 * Actors Routes - PLACEHOLDER
 */

import type { FastifyInstance } from 'fastify';
import { actorsService } from './actors.service.js';
import { CreateActorSchema, UpdateActorSchema } from './actors.schema.js';
import { NotFoundError } from '../../common/errors.js';
import { ObjectIdSchema } from '../../common/types.js';

export async function actorsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/actors
  app.get('/', async () => {
    const actors = await actorsService.getAll();
    return { ok: true, data: actors };
  });

  // GET /api/actors/:id
  app.get('/:id', async (req) => {
    const { id } = req.validateParams(ObjectIdSchema.transform((v) => ({ id: v })));
    const actor = await actorsService.getById(id);
    if (!actor) throw new NotFoundError('Actor', id);
    return { ok: true, data: actor };
  });

  // POST /api/actors
  app.post('/', async (req) => {
    const input = req.validateBody(CreateActorSchema);
    const actor = await actorsService.create(input);
    return { ok: true, data: actor };
  });

  // PUT /api/actors/:id
  app.put('/:id', async (req) => {
    const { id } = req.validateParams(ObjectIdSchema.transform((v) => ({ id: v })));
    const input = req.validateBody(UpdateActorSchema);
    const actor = await actorsService.update(id, input);
    if (!actor) throw new NotFoundError('Actor', id);
    return { ok: true, data: actor };
  });

  // DELETE /api/actors/:id
  app.delete('/:id', async (req) => {
    const { id } = req.validateParams(ObjectIdSchema.transform((v) => ({ id: v })));
    const deleted = await actorsService.delete(id);
    if (!deleted) throw new NotFoundError('Actor', id);
    return { ok: true };
  });
}
