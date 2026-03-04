// ExecutionScope - Fundamental enum for USER vs SYSTEM context
// This determines behavior across the entire parsing pipeline

export enum ExecutionScope {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export enum OwnerType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

// Helper to convert OwnerType to ExecutionScope (they align)
export function ownerTypeToScope(ownerType: OwnerType | string): ExecutionScope {
  return ownerType === 'SYSTEM' ? ExecutionScope.SYSTEM : ExecutionScope.USER;
}

// Helper to check if scope is system
export function isSystemScope(scope: ExecutionScope | string): boolean {
  return scope === ExecutionScope.SYSTEM;
}

// Helper to check if scope is user
export function isUserScope(scope: ExecutionScope | string): boolean {
  return scope === ExecutionScope.USER;
}
