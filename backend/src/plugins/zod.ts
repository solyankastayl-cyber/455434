import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError, ZodSchema } from 'zod';
import { ValidationError } from '../common/errors.js';

/**
 * Zod Validation Plugin
 * Provides request validation utilities
 */

declare module 'fastify' {
  interface FastifyRequest {
    validateBody: <T>(schema: ZodSchema<T>) => T;
    validateQuery: <T>(schema: ZodSchema<T>) => T;
    validateParams: <T>(schema: ZodSchema<T>) => T;
  }
}

export async function zodPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('validateBody', function <T>(this: FastifyRequest, schema: ZodSchema<T>): T {
    const result = schema.safeParse(this.body);
    if (!result.success) {
      throw new ValidationError(formatZodError(result.error));
    }
    return result.data;
  });

  app.decorateRequest('validateQuery', function <T>(this: FastifyRequest, schema: ZodSchema<T>): T {
    const result = schema.safeParse(this.query);
    if (!result.success) {
      throw new ValidationError(formatZodError(result.error));
    }
    return result.data;
  });

  app.decorateRequest('validateParams', function <T>(this: FastifyRequest, schema: ZodSchema<T>): T {
    const result = schema.safeParse(this.params);
    if (!result.success) {
      throw new ValidationError(formatZodError(result.error));
    }
    return result.data;
  });
}

function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join(', ');
}
