// B3.1 - Runtime Errors
// Standardized error handling across all runtimes

export class RuntimeError extends Error {
  constructor(
    message: string,
    public code: string,
    public source?: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export const RuntimeErrorCodes = {
  // Health errors
  HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  TIMEOUT: 'TIMEOUT',
  
  // Auth errors
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  
  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  
  // Data errors
  NOT_FOUND: 'NOT_FOUND',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  PARSE_ERROR: 'PARSE_ERROR',
  
  // Generic
  UNKNOWN: 'UNKNOWN',
} as const;

export type RuntimeErrorCode = typeof RuntimeErrorCodes[keyof typeof RuntimeErrorCodes];

export function createRuntimeError(
  code: RuntimeErrorCode,
  message?: string,
  source?: string
): RuntimeError {
  const defaultMessages: Record<RuntimeErrorCode, string> = {
    HEALTH_CHECK_FAILED: 'Runtime health check failed',
    CONNECTION_REFUSED: 'Connection refused',
    TIMEOUT: 'Request timed out',
    AUTH_REQUIRED: 'Authentication required',
    SESSION_EXPIRED: 'Session expired, re-authentication needed',
    ACCOUNT_LOCKED: 'Account is locked or suspended',
    RATE_LIMITED: 'Rate limit exceeded',
    QUOTA_EXCEEDED: 'API quota exceeded',
    NOT_FOUND: 'Resource not found',
    INVALID_RESPONSE: 'Invalid response from runtime',
    PARSE_ERROR: 'Failed to parse response',
    UNKNOWN: 'Unknown runtime error',
  };

  return new RuntimeError(
    message || defaultMessages[code],
    code,
    source,
    !['ACCOUNT_LOCKED', 'SESSION_EXPIRED'].includes(code)
  );
}
