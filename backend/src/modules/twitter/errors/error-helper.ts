/**
 * PHASE 2.2 — Error Response Helper
 * 
 * Utility functions to send standardized error responses
 * from Fastify controllers.
 */

import { FastifyReply } from 'fastify';

// Runtime imports (enum, const, function)
import {
  TwitterErrorCode,
  createErrorResponse,
  ERROR_SEVERITY,
} from './twitter-error-codes.js';

// Type-only imports (interface, type)
import type { 
  ErrorSeverity, 
  TwitterErrorResponse 
} from './twitter-error-codes.js';

/**
 * HTTP status codes for each error severity
 */
const SEVERITY_STATUS_CODES: Record<ErrorSeverity, number> = {
  INFO: 200,
  WARNING: 409,
  BLOCKED: 412,
};

/**
 * Specific status codes for certain errors
 */
const ERROR_STATUS_CODES: Partial<Record<TwitterErrorCode, number>> = {
  [TwitterErrorCode.SESSION_NOT_FOUND]: 404,
  [TwitterErrorCode.ACCOUNT_NOT_FOUND]: 404,
  [TwitterErrorCode.INVALID_REQUEST]: 400,
  [TwitterErrorCode.MISSING_PARAMETER]: 400,
  [TwitterErrorCode.INVALID_PARAMETER]: 400,
  [TwitterErrorCode.RATE_LIMITED]: 429,
  [TwitterErrorCode.RATE_LIMITED_SOFT]: 429,
  [TwitterErrorCode.QUOTA_EXCEEDED]: 429,
  [TwitterErrorCode.SERVICE_UNAVAILABLE]: 503,
  [TwitterErrorCode.PARSER_DOWN]: 503,
  [TwitterErrorCode.INTERNAL_ERROR]: 500,
  [TwitterErrorCode.TIMEOUT]: 504,
};

/**
 * Get HTTP status code for an error
 */
function getStatusCode(code: TwitterErrorCode): number {
  if (ERROR_STATUS_CODES[code]) {
    return ERROR_STATUS_CODES[code]!;
  }
  const severity = ERROR_SEVERITY[code] || 'INFO';
  return SEVERITY_STATUS_CODES[severity];
}

/**
 * Send a standardized Twitter error response
 */
export function sendTwitterError(
  reply: FastifyReply,
  code: TwitterErrorCode,
  meta?: TwitterErrorResponse['meta'],
  severityOverride?: ErrorSeverity
): FastifyReply {
  const response = createErrorResponse(code, meta, severityOverride);
  const statusCode = getStatusCode(code);
  return reply.status(statusCode).send(response);
}

/**
 * Convert legacy error to Twitter error code
 */
export function mapLegacyError(error: Error | string): TwitterErrorCode {
  const message = typeof error === 'string' ? error : error.message;
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('session') && lowerMessage.includes('invalid')) {
    return TwitterErrorCode.SESSION_INVALID;
  }
  if (lowerMessage.includes('session') && lowerMessage.includes('expired')) {
    return TwitterErrorCode.SESSION_EXPIRED;
  }
  if (lowerMessage.includes('session') && lowerMessage.includes('not found')) {
    return TwitterErrorCode.SESSION_NOT_FOUND;
  }
  if (lowerMessage.includes('cookie') && (lowerMessage.includes('missing') || lowerMessage.includes('empty'))) {
    return TwitterErrorCode.COOKIES_MISSING;
  }
  if (lowerMessage.includes('auth_token') && lowerMessage.includes('missing')) {
    return TwitterErrorCode.AUTH_TOKEN_MISSING;
  }
  if (lowerMessage.includes('auth_token') && lowerMessage.includes('expired')) {
    return TwitterErrorCode.AUTH_TOKEN_EXPIRED;
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('rate_limit')) {
    return TwitterErrorCode.RATE_LIMITED;
  }
  if (lowerMessage.includes('too many requests')) {
    return TwitterErrorCode.RATE_LIMITED;
  }
  if (lowerMessage.includes('parser') && (lowerMessage.includes('down') || lowerMessage.includes('unavailable'))) {
    return TwitterErrorCode.PARSER_DOWN;
  }
  if (lowerMessage.includes('browser') && !lowerMessage.includes('ready')) {
    return TwitterErrorCode.BROWSER_NOT_READY;
  }
  if (lowerMessage.includes('account') && lowerMessage.includes('suspended')) {
    return TwitterErrorCode.ACCOUNT_SUSPENDED;
  }
  if (lowerMessage.includes('account') && lowerMessage.includes('locked')) {
    return TwitterErrorCode.ACCOUNT_LOCKED;
  }
  if (lowerMessage.includes('account') && lowerMessage.includes('restricted')) {
    return TwitterErrorCode.ACCOUNT_RESTRICTED;
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return TwitterErrorCode.TIMEOUT;
  }
  if (lowerMessage.includes('required') || lowerMessage.includes('missing')) {
    return TwitterErrorCode.MISSING_PARAMETER;
  }
  if (lowerMessage.includes('invalid')) {
    return TwitterErrorCode.INVALID_PARAMETER;
  }
  
  return TwitterErrorCode.UNKNOWN_ERROR;
}

/**
 * Handle any error and convert to Twitter error response
 */
export function handleError(
  reply: FastifyReply,
  error: Error | string,
  meta?: TwitterErrorResponse['meta']
): FastifyReply {
  const code = mapLegacyError(error);
  const errorMeta = {
    ...meta,
    originalError: typeof error === 'string' ? error : error.message,
  };
  return sendTwitterError(reply, code, errorMeta);
}

// Re-export runtime values for convenience
export { TwitterErrorCode, createErrorResponse, ERROR_SEVERITY };

// Re-export types
export type { ErrorSeverity, TwitterErrorResponse };
