/**
 * Narrative Engine v2 - WITH TAXONOMY
 * 
 * Группирует existing signals в narratives
 * БЕЗ AI, БЕЗ внешних данных, только агрегация
 */
import type { Narrative, NarrativeEvidence, NarrativeRules } from './narrative.types.js';
import { 
  detectCategory,
  detectPattern,
  detectScope,
  generateTheme,
  explainWhyItMatters,
  calculateSupportScore
} from './narrative.rules.js';
import { v4 as uuidv4 } from 'uuid';
import { detectSector } from './sector.definitions.js';

/**
 * Build Narratives from Signals
 * 
 * Принимает массив сигналов, группирует их в narratives с taxonomy
 */
export async function buildNarratives(
  signals: any[], // Signals from signal.engine.ts
  options: Partial<NarrativeRules> = {}
): Promise<Narrative[]> {
  const rules: NarrativeRules = {
    minSignals: options.minSignals || 2,
    minTokens: options.minTokens || 2,
    window: options.window || '24h',
    maxNarratives: options.maxNarratives || 5,
  };
  
  // Convert signals to evidence
  const evidence: NarrativeEvidence[] = signals.map(signal => ({
    token: signal.tokenAddress,
    symbol: signal.tokenSymbol,
    signalType: signal.type,
    deviation: signal.evidence?.deviation || signal.severity / 20, // Normalize
    timestamp: signal.detectedAt || new Date(),
    window: rules.window,
  }));
  
  // Filter: минимум signals
  if (evidence.length < rules.minSignals) {
    return [];
  }
  
  // Group by potential themes
  const narratives: Narrative[] = [];
  
  // Strategy 1: Group by signal type (homogeneous patterns)
  const groupedByType = groupEvidenceBySignalType(evidence);
  for (const [signalType, group] of Object.entries(groupedByType)) {
    if (group.length >= rules.minSignals) {
      const uniqueTokens = new Set(group.map(e => e.token));
      if (uniqueTokens.size >= rules.minTokens) {
        const narrative = createNarrativeWithTaxonomy(group, rules.window);
        if (narrative) {
          narratives.push(narrative);
        }
      }
    }
  }
  
  // Strategy 2: Sector-specific patterns
  const sectorGroups = groupEvidenceBySector(evidence);
  for (const [sector, group] of Object.entries(sectorGroups)) {
    if (group.length >= rules.minSignals) {
      const uniqueTokens = new Set(group.map(e => e.token));
      if (uniqueTokens.size >= rules.minTokens) {
        const narrative = createNarrativeWithTaxonomy(group, rules.window, sector);
        if (narrative) {
          narratives.push(narrative);
        }
      }
    }
  }
  
  // Strategy 3: Market-wide mixed patterns (если не покрыто выше)
  if (narratives.length === 0 && evidence.length >= rules.minSignals) {
    const uniqueTokens = new Set(evidence.map(e => e.token));
    if (uniqueTokens.size >= rules.minTokens) {
      const narrative = createNarrativeWithTaxonomy(evidence, rules.window);
      if (narrative) {
        narratives.push(narrative);
      }
    }
  }
  
  // Deduplicate and sort
  const uniqueNarratives = deduplicateNarratives(narratives);
  const sortedNarratives = sortBySupportScore(uniqueNarratives);
  
  // Return top N
  return sortedNarratives.slice(0, rules.maxNarratives);
}

/**
 * Group evidence by signal type
 */
function groupEvidenceBySignalType(
  evidence: NarrativeEvidence[]
): Record<string, NarrativeEvidence[]> {
  const groups: Record<string, NarrativeEvidence[]> = {};
  
  for (const e of evidence) {
    if (!groups[e.signalType]) {
      groups[e.signalType] = [];
    }
    groups[e.signalType].push(e);
  }
  
  return groups;
}

/**
 * Group evidence by sector
 */
function groupEvidenceBySector(
  evidence: NarrativeEvidence[]
): Record<string, NarrativeEvidence[]> {
  const groups: Record<string, NarrativeEvidence[]> = {};
  
  for (const e of evidence) {
    const sector = detectSector(e.token, e.symbol);
    if (sector) {
      if (!groups[sector]) {
        groups[sector] = [];
      }
      groups[sector].push(e);
    }
  }
  
  return groups;
}

/**
 * Create Narrative with full taxonomy
 */
function createNarrativeWithTaxonomy(
  evidence: NarrativeEvidence[],
  window: '1h' | '6h' | '24h' | '7d',
  forceSector?: string
): Narrative | null {
  // Detect taxonomy
  const category = detectCategory(evidence);
  const pattern = detectPattern(category, evidence);
  const scope = forceSector ? 'sector' : detectScope(evidence);
  
  // Generate human-readable
  const theme = generateTheme(category, pattern, scope, evidence);
  const whyItMatters = explainWhyItMatters(category, pattern);
  
  // Calculate support
  const supportScore = calculateSupportScore(evidence);
  
  // Find earliest detection
  const timestamps = evidence.map(e => e.timestamp.getTime());
  const firstDetected = new Date(Math.min(...timestamps));
  
  // Detect sector (if not forced)
  const sector = forceSector || detectSector(evidence[0].token, evidence[0].symbol);
  
  return {
    id: uuidv4(),
    category,
    pattern,
    scope,
    theme,
    whyItMatters,
    evidence: evidence.slice(0, 5), // Top 5 для UI
    supportScore,
    window,
    firstDetected,
    sector,
  };
}

/**
 * Deduplicate narratives with similar themes
 */
function deduplicateNarratives(narratives: Narrative[]): Narrative[] {
  const seen = new Map<string, Narrative>();
  
  for (const narrative of narratives) {
    // Key = category + pattern + scope
    const key = `${narrative.category}_${narrative.pattern}_${narrative.scope}`;
    
    const existing = seen.get(key);
    if (!existing || narrative.supportScore.signals > existing.supportScore.signals) {
      seen.set(key, narrative);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Sort narratives by support score
 */
function sortBySupportScore(narratives: Narrative[]): Narrative[] {
  return narratives.sort((a, b) => {
    // Sort by: tokens DESC, then signals DESC
    if (a.supportScore.tokens !== b.supportScore.tokens) {
      return b.supportScore.tokens - a.supportScore.tokens;
    }
    return b.supportScore.signals - a.supportScore.signals;
  });
}
