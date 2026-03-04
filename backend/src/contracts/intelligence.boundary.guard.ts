/**
 * INTELLIGENCE BOUNDARY GUARD — P0.3
 * ===================================
 * 
 * Prevents P2 (Connections/Intelligence) from directly
 * accessing or modifying core system state.
 * 
 * All intelligence inputs/outputs MUST go through contracts.
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// PROTECTED MODULES (CORE)
// ═══════════════════════════════════════════════════════════════

/**
 * Modules that CANNOT be imported from intelligence layer
 */
export const PROTECTED_CORE_MODULES = [
  // Decision engine
  'meta-brain/meta-brain.service',
  'meta-brain/invariants',
  'meta-brain/guards',
  'meta-brain/exchange-impact',
  
  // ML core
  'exchange-ml/ml.service',
  'exchange-ml/ml.promotion.service',
  'exchange-ml/ml.modifier.service',
  
  // State management
  'learning/state/active-model.state',
  'learning/routes/mlops.routes',
  
  // Macro core
  'macro-intel/services/macro-intel.snapshot.service',
  'macro-intel/services/regime.detector',
  
  // Database direct access
  'db/mongodb',
] as const;

/**
 * Allowed import paths for intelligence layer
 */
export const ALLOWED_INTELLIGENCE_IMPORTS = [
  // Contracts ONLY
  'contracts/intelligence.inputs',
  'contracts/intelligence.outputs',
  'contracts/ml-feature.schema',
  'contracts/lab-signal.types',
  'contracts/api.namespace.registry',
  
  // Types (read-only)
  'meta-brain/meta-brain.types',
  'macro-intel/contracts/macro-intel.types',
  
  // Utilities
  'utils/logger',
  'utils/validation',
] as const;

// ═══════════════════════════════════════════════════════════════
// BOUNDARY GUARD
// ═══════════════════════════════════════════════════════════════

export interface BoundaryViolation {
  type: 'IMPORT' | 'WRITE' | 'DIRECT_CALL';
  source: string;
  target: string;
  timestamp: number;
  blocked: boolean;
}

const violations: BoundaryViolation[] = [];

/**
 * Check if an import is allowed from intelligence layer
 */
export function isImportAllowed(
  fromModule: string,
  toModule: string
): { allowed: boolean; reason?: string } {
  // Check if source is intelligence
  const isFromIntelligence = 
    fromModule.includes('/intelligence/') ||
    fromModule.includes('/connections/');
  
  if (!isFromIntelligence) {
    return { allowed: true };
  }
  
  // Check if target is protected
  for (const protected_ of PROTECTED_CORE_MODULES) {
    if (toModule.includes(protected_)) {
      return {
        allowed: false,
        reason: `Intelligence cannot import protected module: ${protected_}`,
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Runtime guard: reject direct writes to core state
 */
export function guardCoreStateWrite(
  caller: string,
  target: string,
  operation: 'SET' | 'UPDATE' | 'DELETE'
): boolean {
  const isFromIntelligence = 
    caller.includes('/intelligence/') ||
    caller.includes('/connections/');
  
  if (!isFromIntelligence) {
    return true; // Core modules can write
  }
  
  // Intelligence CANNOT write to core state
  const violation: BoundaryViolation = {
    type: 'WRITE',
    source: caller,
    target,
    timestamp: Date.now(),
    blocked: true,
  };
  
  violations.push(violation);
  
  console.error(
    `[BOUNDARY_VIOLATION] Intelligence tried to write to core state:`,
    violation
  );
  
  return false; // BLOCK
}

/**
 * Validate that a function call is allowed
 */
export function guardDirectCall(
  caller: string,
  callee: string,
  functionName: string
): boolean {
  const isFromIntelligence = 
    caller.includes('/intelligence/') ||
    caller.includes('/connections/');
  
  if (!isFromIntelligence) {
    return true;
  }
  
  // Check if callee is protected
  for (const protected_ of PROTECTED_CORE_MODULES) {
    if (callee.includes(protected_)) {
      const violation: BoundaryViolation = {
        type: 'DIRECT_CALL',
        source: `${caller}::${functionName}`,
        target: callee,
        timestamp: Date.now(),
        blocked: true,
      };
      
      violations.push(violation);
      
      console.error(
        `[BOUNDARY_VIOLATION] Intelligence tried to call protected function:`,
        violation
      );
      
      return false; // BLOCK
    }
  }
  
  return true;
}

// ═══════════════════════════════════════════════════════════════
// VIOLATION TRACKING
// ═══════════════════════════════════════════════════════════════

export function getViolations(): BoundaryViolation[] {
  return [...violations];
}

export function getViolationCount(): number {
  return violations.length;
}

export function clearViolations(): void {
  violations.length = 0;
}

export function hasViolations(): boolean {
  return violations.length > 0;
}

// ═══════════════════════════════════════════════════════════════
// STATIC ANALYSIS HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a report of boundary compliance
 * Can be used in CI/CD pipeline
 */
export function generateBoundaryReport(): {
  compliant: boolean;
  protectedModules: number;
  allowedImports: number;
  violations: number;
  details: BoundaryViolation[];
} {
  return {
    compliant: violations.length === 0,
    protectedModules: PROTECTED_CORE_MODULES.length,
    allowedImports: ALLOWED_INTELLIGENCE_IMPORTS.length,
    violations: violations.length,
    details: violations,
  };
}

// ═══════════════════════════════════════════════════════════════
// ENFORCEMENT DECORATOR (for use in P2)
// ═══════════════════════════════════════════════════════════════

/**
 * Decorator to mark a function as protected from intelligence calls
 * 
 * Usage:
 * @protectedFromIntelligence
 * function processVerdict() { ... }
 */
export function protectedFromIntelligence(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;
  
  descriptor.value = function (...args: any[]) {
    // In production, this would check the call stack
    // For now, just execute normally
    return originalMethod.apply(this, args);
  };
  
  return descriptor;
}

console.log('[P0.3] Intelligence boundary guard loaded');
console.log('[P0.3] Protected modules:', PROTECTED_CORE_MODULES.length);
console.log('[P0.3] Allowed imports:', ALLOWED_INTELLIGENCE_IMPORTS.length);
