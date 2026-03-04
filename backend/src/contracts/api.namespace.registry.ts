/**
 * API NAMESPACE REGISTRY — P1.E
 * ==============================
 * 
 * Canonical list of API namespaces.
 * Prevents routing conflicts during P2 merge.
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// CORE NAMESPACES (ACTIVE)
// ═══════════════════════════════════════════════════════════════

export const CORE_NAMESPACES = {
  /** Health endpoints */
  HEALTH: '/api/health',
  
  /** Meta-Brain (decision engine) */
  META_BRAIN: '/api/v10/meta-brain',
  
  /** Macro Intelligence */
  MACRO_INTEL: '/api/v10/macro-intel',
  
  /** Exchange data */
  EXCHANGE: '/api/v10/exchange',
  
  /** Labs (research/analysis) */
  LABS: '/api/v10/labs',
  
  /** MLOps (model management) */
  MLOPS: '/api/v10/mlops',
  
  /** Learning (auto-learning) */
  LEARNING: '/api/v10/learning',
  
  /** ML calibration */
  ML: '/api/v10/ml',
  
  /** Signals */
  SIGNALS: '/api/v10/signals',
  
  /** Admin */
  ADMIN: '/api/v10/admin',
  
  /** Macro (legacy) */
  MACRO: '/api/v10/macro',
  
  /** FOMO AI */
  FOMO: '/api/v10/fomo',
} as const;

// ═══════════════════════════════════════════════════════════════
// RESERVED NAMESPACES (P2)
// ═══════════════════════════════════════════════════════════════

export const RESERVED_NAMESPACES = {
  /** Connections module — RESERVED for P2 */
  CONNECTIONS: '/api/connections',
  
  /** Intelligence layer — RESERVED for P2 */
  INTELLIGENCE: '/api/intelligence',
  
  /** Cross-module queries — RESERVED for P2 */
  CROSS: '/api/v10/cross',
  
  /** Graph queries — RESERVED for future */
  GRAPH: '/api/v10/graph',
  
  /** Aggregations — RESERVED for future */
  AGGREGATE: '/api/v10/aggregate',
} as const;

// ═══════════════════════════════════════════════════════════════
// NAMESPACE TYPE
// ═══════════════════════════════════════════════════════════════

export type CoreNamespace = typeof CORE_NAMESPACES[keyof typeof CORE_NAMESPACES];
export type ReservedNamespace = typeof RESERVED_NAMESPACES[keyof typeof RESERVED_NAMESPACES];
export type AnyNamespace = CoreNamespace | ReservedNamespace;

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

const ALL_CORE = Object.values(CORE_NAMESPACES);
const ALL_RESERVED = Object.values(RESERVED_NAMESPACES);

/**
 * Check if a route belongs to a core namespace
 */
export function isCoreRoute(path: string): boolean {
  return ALL_CORE.some(ns => path.startsWith(ns));
}

/**
 * Check if a route belongs to a reserved namespace
 */
export function isReservedRoute(path: string): boolean {
  return ALL_RESERVED.some(ns => path.startsWith(ns));
}

/**
 * Validate that a new route doesn't conflict with reserved namespaces
 */
export function validateNewRoute(path: string): {
  valid: boolean;
  error?: string;
} {
  // Check if route uses reserved namespace
  for (const [name, prefix] of Object.entries(RESERVED_NAMESPACES)) {
    if (path.startsWith(prefix)) {
      return {
        valid: false,
        error: `Route ${path} conflicts with reserved namespace ${name} (${prefix})`,
      };
    }
  }
  
  return { valid: true };
}

/**
 * Get namespace for a route
 */
export function getRouteNamespace(path: string): string | null {
  // Check core namespaces
  for (const [name, prefix] of Object.entries(CORE_NAMESPACES)) {
    if (path.startsWith(prefix)) {
      return name;
    }
  }
  
  // Check reserved namespaces
  for (const [name, prefix] of Object.entries(RESERVED_NAMESPACES)) {
    if (path.startsWith(prefix)) {
      return `RESERVED:${name}`;
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY INFO
// ═══════════════════════════════════════════════════════════════

export function getNamespaceRegistry(): {
  version: string;
  core: Record<string, string>;
  reserved: Record<string, string>;
  totalCore: number;
  totalReserved: number;
} {
  return {
    version: 'v1.0',
    core: CORE_NAMESPACES,
    reserved: RESERVED_NAMESPACES,
    totalCore: Object.keys(CORE_NAMESPACES).length,
    totalReserved: Object.keys(RESERVED_NAMESPACES).length,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTE DOCUMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate route documentation for a namespace
 */
export function generateNamespaceDoc(namespace: keyof typeof CORE_NAMESPACES): {
  name: string;
  prefix: string;
  description: string;
  status: 'ACTIVE' | 'DEPRECATED' | 'BETA';
} {
  const descriptions: Record<string, { desc: string; status: 'ACTIVE' | 'DEPRECATED' | 'BETA' }> = {
    HEALTH: { desc: 'System health checks', status: 'ACTIVE' },
    META_BRAIN: { desc: 'Decision engine & verdicts', status: 'ACTIVE' },
    MACRO_INTEL: { desc: 'Market regime intelligence', status: 'ACTIVE' },
    EXCHANGE: { desc: 'CEX data & indicators', status: 'ACTIVE' },
    LABS: { desc: 'Research & analysis tools', status: 'ACTIVE' },
    MLOPS: { desc: 'ML model lifecycle management', status: 'ACTIVE' },
    LEARNING: { desc: 'Auto-learning & outcomes', status: 'ACTIVE' },
    ML: { desc: 'ML calibration endpoints', status: 'ACTIVE' },
    SIGNALS: { desc: 'Trading signals', status: 'ACTIVE' },
    ADMIN: { desc: 'Admin visibility & controls', status: 'ACTIVE' },
    MACRO: { desc: 'Legacy macro endpoints', status: 'DEPRECATED' },
    FOMO: { desc: 'FOMO AI frontend API', status: 'ACTIVE' },
  };
  
  const info = descriptions[namespace] || { desc: 'Unknown namespace', status: 'ACTIVE' as const };
  
  return {
    name: namespace,
    prefix: CORE_NAMESPACES[namespace],
    description: info.desc,
    status: info.status,
  };
}

console.log('[P1.E] API namespace registry loaded');
console.log('[P1.E] Core namespaces:', Object.keys(CORE_NAMESPACES).length);
console.log('[P1.E] Reserved namespaces:', Object.keys(RESERVED_NAMESPACES).length);
