/**
 * Twitter Parser Module — API Key Guard
 * 
 * Validates API key from Authorization header.
 * Based on: v4.2-final
 */

/**
 * Extract and validate API key from request
 */
export function extractApiKey(authHeader?: string): {
  valid: boolean;
  key?: string;
  error?: string;
} {
  if (!authHeader) {
    return { valid: false, error: 'MISSING_AUTH_HEADER' };
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'INVALID_AUTH_FORMAT' };
  }
  
  const key = authHeader.slice(7).trim();
  
  if (!key) {
    return { valid: false, error: 'EMPTY_API_KEY' };
  }
  
  return { valid: true, key };
}

/**
 * Build unauthorized response
 */
export function unauthorizedResponse(error: string): {
  ok: false;
  error: string;
  message: string;
} {
  const messages: Record<string, string> = {
    'MISSING_AUTH_HEADER': 'Authorization header required',
    'INVALID_AUTH_FORMAT': 'Use Bearer token format',
    'EMPTY_API_KEY': 'API key cannot be empty',
    'INVALID_API_KEY': 'Invalid or revoked API key',
  };
  
  return {
    ok: false,
    error,
    message: messages[error] || 'Unauthorized',
  };
}

/**
 * API key validation hook type
 */
export type ApiKeyValidator = (key: string) => Promise<{
  valid: boolean;
  userId?: string;
  error?: string;
}>;
