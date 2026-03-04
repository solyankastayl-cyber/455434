/**
 * PHASE 2.2 — Twitter Error Code Registry
 * 
 * Unified error codes for all Twitter-related errors.
 * Backend returns MACHINE codes → Extension translates to HUMAN messages.
 * 
 * NO human-readable text here - just codes and metadata.
 */

/**
 * Error severity levels
 */
export type ErrorSeverity = 'INFO' | 'WARNING' | 'BLOCKED';

/**
 * All possible Twitter error codes
 */
export enum TwitterErrorCode {
  // === Session Errors (P0) ===
  SESSION_INVALID = 'SESSION_INVALID',
  SESSION_STALE = 'SESSION_STALE',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // === Cookie Errors (P0) ===
  COOKIES_MISSING = 'COOKIES_MISSING',
  COOKIES_EMPTY = 'COOKIES_EMPTY',
  COOKIES_EXPIRED = 'COOKIES_EXPIRED',
  AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  
  // === Account Errors (P0) ===
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  ACCOUNT_RESTRICTED = 'ACCOUNT_RESTRICTED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  
  // === Rate Limiting (P1) ===
  RATE_LIMITED = 'RATE_LIMITED',
  RATE_LIMITED_SOFT = 'RATE_LIMITED_SOFT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  
  // === Service Errors (P1) ===
  PARSER_DOWN = 'PARSER_DOWN',
  PARSER_BUSY = 'PARSER_BUSY',
  BROWSER_NOT_READY = 'BROWSER_NOT_READY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  
  // === Policy & Risk Errors (P1) ===
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  HIGH_ABORT_RATE = 'HIGH_ABORT_RATE',
  RISK_THRESHOLD_EXCEEDED = 'RISK_THRESHOLD_EXCEEDED',
  COOLDOWN_ACTIVE = 'COOLDOWN_ACTIVE',
  
  // === Preflight Errors (P1) ===
  PREFLIGHT_FAILED = 'PREFLIGHT_FAILED',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  
  // === Validation Errors (P2) ===
  INVALID_REQUEST = 'INVALID_REQUEST',
  MISSING_PARAMETER = 'MISSING_PARAMETER',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  
  // === Generic (P2) ===
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  TIMEOUT = 'TIMEOUT',
}

/**
 * Default severity for each error code
 */
export const ERROR_SEVERITY: Record<TwitterErrorCode, ErrorSeverity> = {
  // Session - mostly BLOCKED
  [TwitterErrorCode.SESSION_INVALID]: 'BLOCKED',
  [TwitterErrorCode.SESSION_STALE]: 'WARNING',
  [TwitterErrorCode.SESSION_NOT_FOUND]: 'BLOCKED',
  [TwitterErrorCode.SESSION_EXPIRED]: 'BLOCKED',
  
  // Cookies - mostly BLOCKED
  [TwitterErrorCode.COOKIES_MISSING]: 'BLOCKED',
  [TwitterErrorCode.COOKIES_EMPTY]: 'BLOCKED',
  [TwitterErrorCode.COOKIES_EXPIRED]: 'BLOCKED',
  [TwitterErrorCode.AUTH_TOKEN_MISSING]: 'BLOCKED',
  [TwitterErrorCode.AUTH_TOKEN_EXPIRED]: 'BLOCKED',
  [TwitterErrorCode.AUTH_TOKEN_INVALID]: 'BLOCKED',
  
  // Account - mixed
  [TwitterErrorCode.ACCOUNT_NOT_FOUND]: 'BLOCKED',
  [TwitterErrorCode.ACCOUNT_DISABLED]: 'BLOCKED',
  [TwitterErrorCode.ACCOUNT_RESTRICTED]: 'BLOCKED',
  [TwitterErrorCode.ACCOUNT_SUSPENDED]: 'BLOCKED',
  [TwitterErrorCode.ACCOUNT_LOCKED]: 'BLOCKED',
  
  // Rate limiting - WARNING
  [TwitterErrorCode.RATE_LIMITED]: 'WARNING',
  [TwitterErrorCode.RATE_LIMITED_SOFT]: 'WARNING',
  [TwitterErrorCode.QUOTA_EXCEEDED]: 'WARNING',
  
  // Service - INFO or WARNING
  [TwitterErrorCode.PARSER_DOWN]: 'INFO',
  [TwitterErrorCode.PARSER_BUSY]: 'WARNING',
  [TwitterErrorCode.BROWSER_NOT_READY]: 'INFO',
  [TwitterErrorCode.SERVICE_UNAVAILABLE]: 'INFO',
  
  // Policy - BLOCKED
  [TwitterErrorCode.POLICY_BLOCKED]: 'BLOCKED',
  [TwitterErrorCode.HIGH_ABORT_RATE]: 'WARNING',
  [TwitterErrorCode.RISK_THRESHOLD_EXCEEDED]: 'WARNING',
  [TwitterErrorCode.COOLDOWN_ACTIVE]: 'WARNING',
  
  // Preflight - BLOCKED
  [TwitterErrorCode.PREFLIGHT_FAILED]: 'BLOCKED',
  [TwitterErrorCode.PRECONDITION_FAILED]: 'BLOCKED',
  
  // Validation - WARNING
  [TwitterErrorCode.INVALID_REQUEST]: 'WARNING',
  [TwitterErrorCode.MISSING_PARAMETER]: 'WARNING',
  [TwitterErrorCode.INVALID_PARAMETER]: 'WARNING',
  
  // Generic - INFO
  [TwitterErrorCode.UNKNOWN_ERROR]: 'INFO',
  [TwitterErrorCode.INTERNAL_ERROR]: 'INFO',
  [TwitterErrorCode.TIMEOUT]: 'WARNING',
};

/**
 * Structured error response
 */
export interface TwitterErrorResponse {
  ok: false;
  errorCode: TwitterErrorCode;
  severity: ErrorSeverity;
  meta?: {
    account?: string;
    sessionId?: string;
    lastValidAt?: string;
    retryAfter?: number;
    blockers?: Array<{ code: string; message: string }>;
    [key: string]: any;
  };
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  code: TwitterErrorCode,
  meta?: TwitterErrorResponse['meta'],
  severityOverride?: ErrorSeverity
): TwitterErrorResponse {
  return {
    ok: false,
    errorCode: code,
    severity: severityOverride || ERROR_SEVERITY[code] || 'INFO',
    meta,
  };
}

/**
 * Check if an error is recoverable (can retry)
 */
export function isRecoverable(code: TwitterErrorCode): boolean {
  const nonRecoverableCodes = [
    TwitterErrorCode.ACCOUNT_SUSPENDED,
    TwitterErrorCode.ACCOUNT_LOCKED,
    TwitterErrorCode.POLICY_BLOCKED,
  ];
  return !nonRecoverableCodes.includes(code);
}

/**
 * Get suggested wait time for rate-limited errors
 */
export function getSuggestedWaitTime(code: TwitterErrorCode): number | null {
  switch (code) {
    case TwitterErrorCode.RATE_LIMITED:
      return 30 * 60 * 1000; // 30 minutes
    case TwitterErrorCode.RATE_LIMITED_SOFT:
      return 5 * 60 * 1000; // 5 minutes
    case TwitterErrorCode.COOLDOWN_ACTIVE:
      return 15 * 60 * 1000; // 15 minutes
    case TwitterErrorCode.PARSER_BUSY:
      return 60 * 1000; // 1 minute
    default:
      return null;
  }
}
