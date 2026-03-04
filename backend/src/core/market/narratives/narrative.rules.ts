/**
 * Narrative Rules v2 - WITH TAXONOMY
 * 
 * Определяет КАК группировать signals в narratives
 * И КАК классифицировать по category + pattern
 * 
 * БЕЗ AI, БЕЗ ML, только правила
 */
import type { 
  NarrativeEvidence, 
  NarrativeCategory, 
  NarrativePattern,
  NarrativeScope 
} from './narrative.types.js';

// ============================================================================
// CATEGORY DETECTION - ЧТО ЭТО ЗА ТИП ЯВЛЕНИЯ
// ============================================================================

/**
 * Определяет category на основе типов signals в evidence
 */
export function detectCategory(evidence: NarrativeEvidence[]): NarrativeCategory {
  const signalTypes = evidence.map(e => e.signalType);
  
  // Count по типам
  const flowSignals = signalTypes.filter(s => 
    s.includes('outflow') || s.includes('inflow') || s === 'large_move'
  ).length;
  
  const activitySignals = signalTypes.filter(s => 
    s === 'activity_spike' || s === 'wallet_spike'
  ).length;
  
  const structureSignals = signalTypes.filter(s => 
    s.includes('concentration') || s.includes('cluster')
  ).length;
  
  const actorSignals = signalTypes.filter(s => 
    s.includes('new_actor') || s.includes('smart_money')
  ).length;
  
  // Composite = если >= 2 категорий представлены
  const categoriesPresent = [
    flowSignals > 0,
    activitySignals > 0,
    structureSignals > 0,
    actorSignals > 0
  ].filter(Boolean).length;
  
  if (categoriesPresent >= 3) {
    return 'composite';
  }
  
  // Определяем доминирующую категорию
  if (activitySignals >= flowSignals && activitySignals >= structureSignals && activitySignals >= actorSignals) {
    return 'activity';
  }
  
  if (flowSignals >= activitySignals && flowSignals >= structureSignals && flowSignals >= actorSignals) {
    return 'flow';
  }
  
  if (structureSignals > 0) {
    return 'structure';
  }
  
  if (actorSignals > 0) {
    return 'actors';
  }
  
  // Default
  return 'activity';
}

// ============================================================================
// PATTERN DETECTION - КАКОЙ ПАТТЕРН
// ============================================================================

/**
 * Определяет pattern на основе category и evidence
 */
export function detectPattern(
  category: NarrativeCategory, 
  evidence: NarrativeEvidence[]
): NarrativePattern {
  const signalTypes = evidence.map(e => e.signalType);
  
  switch (category) {
    case 'flow':
      // Flow patterns
      if (signalTypes.some(s => s.includes('outflow'))) {
        return 'net_outflow';
      }
      if (signalTypes.some(s => s.includes('inflow'))) {
        return 'net_inflow';
      }
      if (signalTypes.filter(s => s === 'large_move').length >= 2) {
        return 'large_transfers';
      }
      return 'net_outflow'; // default for flow
      
    case 'activity':
      // Activity patterns
      const spikeCount = signalTypes.filter(s => s === 'activity_spike').length;
      if (spikeCount >= 2) {
        return 'activity_surge';
      }
      return 'activity_surge'; // default for activity
      
    case 'structure':
      // Structure patterns
      if (signalTypes.some(s => s.includes('cluster'))) {
        return 'clustered_behavior';
      }
      if (signalTypes.some(s => s.includes('concentration'))) {
        return 'concentration_increase';
      }
      return 'clustered_behavior'; // default for structure
      
    case 'actors':
      // Actor patterns
      if (signalTypes.some(s => s.includes('smart_money'))) {
        return 'smart_money_overlap';
      }
      if (signalTypes.some(s => s.includes('new_actor'))) {
        return 'new_actors';
      }
      return 'new_actors'; // default for actors
      
    case 'composite':
      // Composite - редко
      const hasAccumulation = signalTypes.some(s => s === 'accumulation');
      const hasSpike = signalTypes.some(s => s.includes('spike'));
      if (hasAccumulation && hasSpike) {
        return 'coordinated_accumulation';
      }
      return 'activity_surge'; // fallback
  }
}

// ============================================================================
// SCOPE DETECTION - масштаб явления
// ============================================================================

/**
 * Определяет scope на основе количества токенов и их типа
 */
export function detectScope(evidence: NarrativeEvidence[]): NarrativeScope {
  const uniqueTokens = new Set(evidence.map(e => e.token));
  const tokenCount = uniqueTokens.size;
  
  // Проверяем на stablecoin sector
  const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD'];
  const stablecoinTokens = evidence.filter(e => 
    e.symbol && stablecoins.includes(e.symbol)
  );
  
  if (stablecoinTokens.length >= 2 && stablecoinTokens.length === tokenCount) {
    return 'sector'; // Все токены - стейблкоины
  }
  
  // Если много токенов (>= 10) - market-wide
  if (tokenCount >= 10) {
    return 'market';
  }
  
  // Если 2-9 токенов - sector (может быть DeFi, AI, etc.)
  if (tokenCount >= 2) {
    return 'sector';
  }
  
  // Один токен
  return 'token';
}

// ============================================================================
// THEME GENERATION - Human-readable headline
// ============================================================================

/**
 * Генерирует theme на основе category, pattern и scope
 * 
 * ✅ ВСЕГДА используем:
 * - "detected"
 * - "observed"
 * - "identified"
 * - "indicates pattern of..."
 * 
 * ❌ НИКОГДА:
 * - bullish / bearish
 * - buy / sell pressure
 * - intent
 */
export function generateTheme(
  category: NarrativeCategory,
  pattern: NarrativePattern,
  scope: NarrativeScope,
  evidence: NarrativeEvidence[]
): string {
  // Check for stablecoin-specific
  const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD'];
  const hasStablecoins = evidence.some(e => 
    e.symbol && stablecoins.includes(e.symbol)
  );
  
  const scopePrefix = scope === 'market' ? 'Market-wide' : 
                      scope === 'sector' ? (hasStablecoins ? 'Stablecoin' : 'Sector') :
                      '';
  
  switch (pattern) {
    case 'activity_surge':
      return `${scopePrefix} activity surge detected`.trim();
      
    case 'net_outflow':
      return hasStablecoins 
        ? 'Stablecoin outflows increasing'
        : `${scopePrefix} net outflows observed`.trim();
        
    case 'net_inflow':
      return hasStablecoins
        ? 'Stablecoin inflows increasing'
        : `${scopePrefix} net inflows observed`.trim();
        
    case 'large_transfers':
      return `Unusual large transfers detected across ${evidence.length} tokens`;
      
    case 'concentration_increase':
      return 'Activity concentration increasing';
      
    case 'clustered_behavior':
      return 'Coordinated wallet behavior detected';
      
    case 'new_actors':
      return 'New wallets showing abnormal activity';
      
    case 'smart_money_overlap':
      return 'Smart money activity overlap identified';
      
    case 'coordinated_accumulation':
      return 'Coordinated accumulation with activity increase';
      
    default:
      return `${scopePrefix} unusual on-chain behavior detected`.trim();
  }
}

// ============================================================================
// WHY IT MATTERS - Interpretation (БЕЗ intent!)
// ============================================================================

/**
 * Объясняет ЧТО ЭТО ЗНАЧИТ структурно
 * 
 * ❌ НЕ давать вердикт
 * ✅ Объяснить ЧТО это значит для понимания рынка
 */
export function explainWhyItMatters(
  category: NarrativeCategory,
  pattern: NarrativePattern
): string {
  switch (category) {
    case 'flow':
      if (pattern === 'net_outflow') {
        return 'Indicates capital movement out of these assets, not direction';
      }
      if (pattern === 'net_inflow') {
        return 'Suggests positioning changes or increased interest';
      }
      if (pattern === 'large_transfers') {
        return 'Significant capital movements detected across network';
      }
      return 'Capital flow pattern detected';
      
    case 'activity':
      if (pattern === 'activity_surge') {
        return 'Broad increase in on-chain activity across multiple assets';
      }
      return 'Network activity pattern change observed';
      
    case 'structure':
      if (pattern === 'concentration_increase') {
        return 'Activity becoming more concentrated among fewer participants';
      }
      if (pattern === 'clustered_behavior') {
        return 'Multiple wallets exhibiting coordinated patterns';
      }
      return 'Structural change in activity distribution';
      
    case 'actors':
      if (pattern === 'new_actors') {
        return 'New participants entering with significant activity';
      }
      if (pattern === 'smart_money_overlap') {
        return 'Historically successful wallets showing concurrent interest';
      }
      return 'Participant behavior pattern identified';
      
    case 'composite':
      return 'Multiple coordinated patterns detected simultaneously';
      
    default:
      return 'Pattern deviation from recent behavior detected';
  }
}

// ============================================================================
// SUPPORT SCORE CALCULATION
// ============================================================================

/**
 * Calculate Support Score
 */
export function calculateSupportScore(
  evidence: NarrativeEvidence[]
): { signals: number; tokens: number; wallets?: number } {
  const uniqueTokens = new Set(evidence.map(e => e.token));
  
  return {
    signals: evidence.length,
    tokens: uniqueTokens.size,
    wallets: undefined, // Будет добавлено позже из wallet analysis
  };
}
