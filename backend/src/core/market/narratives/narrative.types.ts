/**
 * Narrative Types v2 - WITH TAXONOMY
 * 
 * Narrative = агрегированный факт более высокого порядка
 * 
 * ❌ НЕ intent
 * ❌ НЕ прогноз
 * ❌ НЕ рекомендация
 * ✅ Синтез фактов
 * ✅ Обнаруженная повторяемость
 * ✅ Объединённая аномалия
 */

// ============================================================================
// TAXONOMY - Язык системы
// ============================================================================

/**
 * NarrativeCategory - ЧТО ЭТО ЗА ТИП ЯВЛЕНИЯ
 */
export type NarrativeCategory = 
  | 'flow'        // Движение капитала
  | 'activity'    // Изменение интенсивности сети
  | 'structure'   // Как распределена активность
  | 'actors'      // Кто появился / изменился
  | 'composite';  // Комбинация (редко, но мощно)

/**
 * NarrativePattern - КАКОЙ ПАТТЕРН (машинная классификация)
 * 
 * Один narrative = 1 pattern
 */
export type NarrativePattern =
  // Flow patterns
  | 'activity_surge'
  | 'net_outflow'
  | 'net_inflow'
  | 'large_transfers'
  // Structure patterns
  | 'concentration_increase'
  | 'clustered_behavior'
  // Actor patterns
  | 'new_actors'
  | 'smart_money_overlap'
  // Composite (редко)
  | 'coordinated_accumulation';

/**
 * NarrativeScope - масштаб явления
 */
export type NarrativeScope = 
  | 'token'      // Один токен
  | 'sector'     // Группа токенов (DeFi, Stablecoins, etc.)
  | 'market';    // Весь рынок

// ============================================================================
// Evidence - строго фактическая
// ============================================================================

export interface NarrativeEvidence {
  token: string;           // Token address
  symbol?: string;         // Token symbol (если известен)
  signalType: string;      // 'activity_spike', 'large_move', etc.
  deviation: number;       // Во сколько раз отклонение от baseline (x7.0)
  timestamp: Date;
  window: '1h' | '6h' | '24h' | '7d';
}

// ============================================================================
// SupportScore - НЕ confidence! Показывает масштаб, не "насколько это правда"
// ============================================================================

export interface NarrativeSupportScore {
  signals: number;         // Количество сигналов
  tokens: number;          // Количество токенов
  wallets?: number;        // Количество кошельков (опционально)
}

// ============================================================================
// Narrative - финальная модель
// ============================================================================

export interface Narrative {
  id: string;              // Уникальный ID
  
  // TAXONOMY
  category: NarrativeCategory;
  pattern: NarrativePattern;
  scope: NarrativeScope;
  
  // HUMAN-READABLE
  theme: string;           // Human-readable headline
  whyItMatters: string;    // One-line context (БЕЗ intent!)
  
  // EVIDENCE
  evidence: NarrativeEvidence[];
  
  // SUPPORT
  supportScore: NarrativeSupportScore;
  
  // METADATA
  window: '1h' | '6h' | '24h' | '7d';
  firstDetected: Date;
  
  // SECTOR (опционально, для sector aggregation)
  sector?: string;         // 'stablecoins', 'defi', 'infra', 'meme', 'ai'
}

/**
 * Правила построения Narrative:
 * - ≥ 2 signals
 * - ≥ 2 tokens
 * - в одном time window
 * - с общей характеристикой
 * 
 * ВАЖНО:
 * - supportScore ≠ confidence
 * - theme ≠ interpretation
 * - pattern ≠ intent
 */
export interface NarrativeRules {
  minSignals: number;      // Default: 2
  minTokens: number;       // Default: 2
  window: '1h' | '6h' | '24h' | '7d';
  maxNarratives: number;   // Default: 5
}

// ============================================================================
// SEMANTIC RULES - Жёсткие запреты
// ============================================================================

/**
 * ❌ НИКОГДА:
 * - bullish / bearish
 * - buy / sell pressure
 * - intent
 * - prediction
 * - "suggests accumulation"
 * 
 * ✅ ВСЕГДА:
 * - "detected"
 * - "observed"
 * - "identified"
 * - "indicates pattern of..."
 */

