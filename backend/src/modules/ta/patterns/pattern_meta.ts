/**
 * Pattern Meta — Type definitions for pattern registry
 * 
 * Phase A: Registries & Taxonomy
 */

import { 
  ExclusivityKey, 
  PatternDirection, 
  PatternFamily, 
  PatternGroup, 
  PatternStage, 
  RegistryPatternType,
  PatternRequirement
} from './pattern_groups.js';

// ═══════════════════════════════════════════════════════════════
// Pattern Metadata Structure
// ═══════════════════════════════════════════════════════════════

export type PatternMeta = {
  // Unique identifier
  type: RegistryPatternType;
  
  // Category (12 groups)
  group: PatternGroup;
  
  // Semantic family within group
  family: PatternFamily;
  
  // Direction: BULL/BEAR/NEUTRAL/BOTH
  direction: PatternDirection;
  
  // Exclusivity key for Conflict Engine
  // Patterns with same key cannot coexist in one hypothesis
  exclusivityKey: ExclusivityKey;
  
  // Stage: CORE (always active), ADVANCED (good data), EXOTIC (rare)
  stage: PatternStage;
  
  // Priority within group (1-100, higher = more important)
  priority: number;
  
  // Required context/indicators
  requires?: PatternRequirement[];
  
  // Debug/audit notes
  notes?: string;
  
  // Whether detector is implemented
  implemented?: boolean;
};

export type PatternMetaMap = Record<RegistryPatternType, PatternMeta>;

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Define pattern metadata with type safety
 */
export function define(meta: PatternMeta): PatternMeta {
  return meta;
}

/**
 * Get patterns by group
 */
export function getPatternsByGroup(
  registry: PatternMetaMap,
  group: PatternGroup
): PatternMeta[] {
  return Object.values(registry).filter(p => p.group === group);
}

/**
 * Get patterns by direction
 */
export function getPatternsByDirection(
  registry: PatternMetaMap,
  direction: PatternDirection
): PatternMeta[] {
  return Object.values(registry).filter(
    p => p.direction === direction || p.direction === 'BOTH'
  );
}

/**
 * Get patterns by stage
 */
export function getPatternsByStage(
  registry: PatternMetaMap,
  stage: PatternStage
): PatternMeta[] {
  return Object.values(registry).filter(p => p.stage === stage);
}

/**
 * Get implemented patterns only
 */
export function getImplementedPatterns(registry: PatternMetaMap): PatternMeta[] {
  return Object.values(registry).filter(p => p.implemented === true);
}

/**
 * Get patterns by exclusivity key
 */
export function getPatternsByExclusivity(
  registry: PatternMetaMap,
  key: ExclusivityKey
): PatternMeta[] {
  return Object.values(registry).filter(p => p.exclusivityKey === key);
}
