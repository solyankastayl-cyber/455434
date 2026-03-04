/**
 * Engine Result Adapter
 * 
 * Единственная точка маппинга engine → product.
 * Parser возвращает engine-термины (fetchedPosts, finalRisk)
 * Backend использует product-термины (fetched, riskScore)
 */

// === Engine Types (as-is from parser) ===

export interface ParserEngineSummary {
  fetchedPosts?: number;
  planned?: number;
  durationMs?: number;
  finalRisk?: number;
  riskMax?: number;
  aborted?: boolean;
  abortReason?: string;
  profile?: string;
  profileChanges?: number;
  scrollCount?: number;
}

export interface ParserEngineResponse {
  tweets?: any[];
  engineSummary?: ParserEngineSummary;
}

// === Product Types (for API/UI) ===

export interface ProductParseResult {
  status: 'OK' | 'PARTIAL' | 'ABORTED' | 'FAILED';
  fetched: number;
  durationMs: number;
  riskScore: number;
  aborted: boolean;
  abortReason?: string;
}

// === Adapter ===

export class EngineResultAdapter {
  /**
   * Map parser engine response to product format
   */
  static fromParser(response: ParserEngineResponse): ProductParseResult {
    const summary = response.engineSummary || {};
    
    // Map fetchedPosts → fetched (fallback to tweets array length)
    const fetched = summary.fetchedPosts ?? response.tweets?.length ?? 0;
    
    // Map finalRisk/riskMax → riskScore
    const riskScore = Number.isFinite(summary.finalRisk) 
      ? summary.finalRisk 
      : (Number.isFinite(summary.riskMax) ? summary.riskMax : 0);
    
    // Determine status
    let status: ProductParseResult['status'] = 'OK';
    if (summary.aborted) {
      status = fetched > 0 ? 'PARTIAL' : 'ABORTED';
    }
    
    console.log(`[EngineAdapter] Mapped: fetchedPosts=${summary.fetchedPosts} → fetched=${fetched}, finalRisk=${summary.finalRisk} → riskScore=${riskScore}`);
    
    return {
      status,
      fetched,
      durationMs: summary.durationMs ?? 0,
      riskScore,
      aborted: Boolean(summary.aborted),
      abortReason: summary.abortReason,
    };
  }
  
  /**
   * Build engine summary for internal use (session updates, etc.)
   */
  static toEngineSummary(response: ParserEngineResponse): {
    durationMs: number;
    riskMax: number;
    aborted: boolean;
    abortReason?: string;
  } {
    const summary = response.engineSummary || {};
    
    return {
      durationMs: summary.durationMs ?? 0,
      riskMax: Number.isFinite(summary.finalRisk) 
        ? summary.finalRisk 
        : (Number.isFinite(summary.riskMax) ? summary.riskMax : 0),
      aborted: Boolean(summary.aborted),
      abortReason: summary.abortReason,
    };
  }
}
