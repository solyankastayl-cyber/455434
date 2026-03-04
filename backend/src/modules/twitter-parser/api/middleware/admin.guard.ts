/**
 * Twitter Parser Module — Admin Guard
 * 
 * Validates admin access.
 * Based on: v4.2-final
 */

/**
 * Check if request has admin access
 * 
 * For now, admin endpoints are open.
 * Host app should implement proper admin validation.
 */
export function isAdminRequest(headers: Record<string, string | undefined>): {
  isAdmin: boolean;
  reason?: string;
} {
  // Check for admin header
  const adminHeader = headers['x-admin-key'];
  
  if (adminHeader) {
    // Host app should validate this
    return { isAdmin: true };
  }
  
  // Check for API key with admin scope
  const authHeader = headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    // For module extraction, we assume admin access
    // Host app should validate scope
    return { isAdmin: true };
  }
  
  return { isAdmin: true }; // Allow for now, host validates
}

/**
 * Build forbidden response
 */
export function forbiddenResponse(): {
  ok: false;
  error: string;
  message: string;
} {
  return {
    ok: false,
    error: 'FORBIDDEN',
    message: 'Admin access required',
  };
}
