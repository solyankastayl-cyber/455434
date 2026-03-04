/**
 * Parse Search Request DTO - Phase 1.4
 */

export interface ParseSearchRequest {
  /** Поисковый запрос */
  query: string;
  
  /** Лимит твитов */
  limit: number;
  
  /** Фильтры (опционально) */
  filters?: {
    minLikes?: number;
    minReposts?: number;
    timeRange?: '1h' | '6h' | '24h' | '7d';
  };
}

export interface ParseAccountRequest {
  /** Username Twitter аккаунта */
  username: string;
  
  /** Лимит твитов */
  limit: number;
}

export interface ParseSearchResponse {
  /** Статус выполнения */
  status: 'OK' | 'PARTIAL' | 'ABORTED' | 'FAILED';
  
  /** Количество полученных твитов */
  fetched?: number;
  
  /** Время выполнения (ms) */
  durationMs?: number;
  
  /** Причина abort (если есть) */
  reason?: string;
  
  /** Task ID для tracking */
  taskId?: string;
  
  /** ID аккаунта который использовался */
  accountId?: string;
}

export interface ParserEngineSummary {
  fetched: number;
  planned: number;
  durationMs: number;
  riskMax: number;
  aborted: boolean;
  abortReason?: 'CAPTCHA' | 'RATE_LIMIT' | 'RISK_SPIKE' | 'EMPTY_FEED' | 'SESSION_EXPIRED';
  profile: string;
  profileChanges: number;
  scrollCount: number;
}
