/**
 * FRACTAL FREEZE GUARD
 * 
 * Middleware and guards for frozen mode.
 * Blocks any write operations that modify model behavior.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getFreezeConfig, isOperationAllowed, isSymbolAllowed } from './fractal.freeze.config.js';

export class FreezeGuardError extends Error {
  statusCode: number;
  operation: string;
  
  constructor(operation: string, message: string) {
    super(message);
    this.name = 'FreezeGuardError';
    this.statusCode = 409; // Conflict
    this.operation = operation;
  }
}

/**
 * Assert operation is allowed (throws if not)
 */
export function assertNotFrozen(operation: string): void {
  if (!isOperationAllowed(operation)) {
    const config = getFreezeConfig();
    throw new FreezeGuardError(
      operation,
      `Operation '${operation}' blocked: module is FROZEN (${config.version})`
    );
  }
}

/**
 * Assert symbol is allowed (throws if not)
 */
export function assertSymbolAllowed(symbol: string): void {
  if (!isSymbolAllowed(symbol)) {
    throw new FreezeGuardError(
      'SYMBOL_CHECK',
      `Symbol '${symbol}' not allowed. Only BTC supported.`
    );
  }
}

/**
 * Fastify preHandler hook for freeze guard
 */
export function createFreezeGuardHook(operation: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      assertNotFrozen(operation);
    } catch (err: any) {
      if (err instanceof FreezeGuardError) {
        reply.status(err.statusCode).send({
          error: 'FROZEN',
          operation: err.operation,
          message: err.message,
          version: getFreezeConfig().version
        });
        throw err;
      }
      throw err;
    }
  };
}

/**
 * Express-style middleware for freeze guard
 */
export function freezeGuardMiddleware(operation: string) {
  return (req: any, res: any, next: any) => {
    try {
      assertNotFrozen(operation);
      next();
    } catch (err: any) {
      if (err instanceof FreezeGuardError) {
        res.status(err.statusCode).json({
          error: 'FROZEN',
          operation: err.operation,
          message: err.message
        });
        return;
      }
      next(err);
    }
  };
}

/**
 * Check freeze status
 */
export function getFreezeStatus(): {
  frozen: boolean;
  version: string;
  frozenAt: string | null;
  allowedSymbols: string[];
  allowedHorizons: number[];
} {
  const config = getFreezeConfig();
  return {
    frozen: config.frozen,
    version: config.version,
    frozenAt: config.frozenAt,
    allowedSymbols: config.allowedSymbols,
    allowedHorizons: config.allowedHorizons
  };
}
