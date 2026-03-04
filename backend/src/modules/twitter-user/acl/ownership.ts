// ACL and Ownership utilities
import type { OwnerType } from '../models/_types.js';

export function userScope(userId: string) {
  return { ownerType: 'USER' as const, ownerUserId: userId };
}

export function systemScope() {
  return { ownerType: 'SYSTEM' as const };
}

export function requireOwnerFields(ownerType: OwnerType, ownerUserId?: string) {
  if (ownerType === 'USER' && !ownerUserId) {
    throw new Error('ownerUserId is required for USER scope');
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = 'Access denied') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
