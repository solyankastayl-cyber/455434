/**
 * Twitter Errors Module Index
 * 
 * Runtime exports + Type exports separated correctly
 */

// Runtime exports
export { 
  TwitterErrorCode, 
  ERROR_SEVERITY,
  createErrorResponse,
  isRecoverable,
  getSuggestedWaitTime 
} from './twitter-error-codes.js';

export { 
  sendTwitterError, 
  handleError, 
  mapLegacyError 
} from './error-helper.js';

// Type-only exports
export type { 
  ErrorSeverity, 
  TwitterErrorResponse 
} from './twitter-error-codes.js';
