/**
 * PHASE 4 — Final Decision Service
 * ==================================
 * Core policy engine for Buy/Sell/Avoid
 * 
 * RULES (LOCKED v1):
 * - Only LIVE data allowed
 * - Only when ML is ready
 * - Risk overrides always win
 * - Thresholds: BUY/SELL >= 0.65
 * - Everything else → AVOID
 */

import {
  Action,
  DecisionContext,
  FinalDecision,
  DECISION_THRESHOLDS,
  AvoidReason,
} from '../contracts/decision.types.js';
import { DecisionRecordModel } from '../storage/decision.storage.js';
import { timelineService } from '../../observability/services/timeline.service.js';

const POLICY_VERSION = 'v1.0.0';

class FinalDecisionService {
  
  /**
   * Main decision function
   * Takes context from Meta-Brain and returns Buy/Sell/Avoid
   */
  decide(context: DecisionContext): FinalDecision {
    const appliedRules: string[] = [];
    const timestamp = context.timestamp || Date.now();
    
    // ═══════════════════════════════════════════════════════════
    // GATE 1: Data Quality
    // ═══════════════════════════════════════════════════════════
    
    if (context.dataMode !== 'LIVE') {
      appliedRules.push('GATE_DATA_MODE');
      return this.avoid(context, 'NON_LIVE_DATA', appliedRules);
    }
    appliedRules.push('PASS_DATA_MODE');
    
    // ═══════════════════════════════════════════════════════════
    // GATE 2: ML Readiness
    // ═══════════════════════════════════════════════════════════
    
    if (!context.mlReady) {
      appliedRules.push('GATE_ML_NOT_READY');
      return this.avoid(context, 'ML_NOT_READY', appliedRules);
    }
    appliedRules.push('PASS_ML_READY');
    
    // ML drift warning (don't block, but log)
    if (context.mlDrift) {
      appliedRules.push('WARN_ML_DRIFT');
    }
    
    // ═══════════════════════════════════════════════════════════
    // GATE 3: Risk Overrides (ALWAYS WIN)
    // ═══════════════════════════════════════════════════════════
    
    if (context.risk.whaleRisk === 'HIGH') {
      appliedRules.push('GATE_WHALE_RISK');
      return this.avoid(context, 'WHALE_RISK', appliedRules);
    }
    appliedRules.push('PASS_WHALE_RISK');
    
    if (context.risk.marketStress === 'EXTREME') {
      appliedRules.push('GATE_MARKET_STRESS');
      return this.avoid(context, 'MARKET_STRESS', appliedRules);
    }
    appliedRules.push('PASS_MARKET_STRESS');
    
    if (context.risk.contradiction) {
      appliedRules.push('GATE_CONTRADICTION');
      return this.avoid(context, 'CONTRADICTION', appliedRules);
    }
    appliedRules.push('PASS_NO_CONTRADICTION');
    
    // ═══════════════════════════════════════════════════════════
    // GATE 4: Verdict + Confidence → Action
    // ═══════════════════════════════════════════════════════════
    
    const confidence = context.mlAdjustedConfidence;
    
    // BULLISH → BUY
    if (context.verdict === 'BULLISH') {
      appliedRules.push('VERDICT_BULLISH');
      
      if (confidence >= DECISION_THRESHOLDS.BUY) {
        appliedRules.push('CONFIDENCE_ABOVE_BUY_THRESHOLD');
        return this.buy(context, appliedRules);
      }
      
      appliedRules.push('CONFIDENCE_BELOW_BUY_THRESHOLD');
      return this.avoid(context, 'LOW_CONFIDENCE', appliedRules);
    }
    
    // BEARISH → SELL
    if (context.verdict === 'BEARISH') {
      appliedRules.push('VERDICT_BEARISH');
      
      if (confidence >= DECISION_THRESHOLDS.SELL) {
        appliedRules.push('CONFIDENCE_ABOVE_SELL_THRESHOLD');
        return this.sell(context, appliedRules);
      }
      
      appliedRules.push('CONFIDENCE_BELOW_SELL_THRESHOLD');
      return this.avoid(context, 'LOW_CONFIDENCE', appliedRules);
    }
    
    // NEUTRAL → AVOID
    appliedRules.push('VERDICT_NEUTRAL');
    return this.avoid(context, 'NEUTRAL_VERDICT', appliedRules);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DECISION BUILDERS
  // ═══════════════════════════════════════════════════════════════
  
  private buy(context: DecisionContext, appliedRules: string[]): FinalDecision {
    return this.buildDecision(context, 'BUY', 'STRONG_BULLISH_CONTEXT', appliedRules);
  }
  
  private sell(context: DecisionContext, appliedRules: string[]): FinalDecision {
    return this.buildDecision(context, 'SELL', 'STRONG_BEARISH_CONTEXT', appliedRules);
  }
  
  private avoid(
    context: DecisionContext,
    reason: AvoidReason,
    appliedRules: string[]
  ): FinalDecision {
    return this.buildDecision(context, 'AVOID', reason, appliedRules, reason);
  }
  
  private buildDecision(
    context: DecisionContext,
    action: Action,
    reason: string,
    appliedRules: string[],
    blockedBy?: string
  ): FinalDecision {
    return {
      symbol: context.symbol,
      timestamp: context.timestamp || Date.now(),
      action,
      confidence: context.mlAdjustedConfidence,
      reason,
      explainability: {
        verdict: context.verdict,
        rawConfidence: context.rawConfidence,
        mlAdjustedConfidence: context.mlAdjustedConfidence,
        dataMode: context.dataMode,
        mlReady: context.mlReady,
        appliedRules,
        blockedBy,
        riskFlags: context.risk,
      },
      policyVersion: POLICY_VERSION,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STORAGE & TRACKING
  // ═══════════════════════════════════════════════════════════════
  
  async saveDecision(decision: FinalDecision, price?: number): Promise<void> {
    await DecisionRecordModel.create({
      ...decision,
      outcome: price ? { priceAtDecision: price } : undefined,
    });
    
    // Emit timeline event for non-AVOID decisions
    if (decision.action !== 'AVOID') {
      await timelineService.emit({
        type: 'VERDICT_EMITTED',
        severity: 'INFO',
        symbol: decision.symbol,
        message: `Final decision: ${decision.action} (confidence: ${(decision.confidence * 100).toFixed(1)}%)`,
        data: {
          action: decision.action,
          confidence: decision.confidence,
          reason: decision.reason,
        },
      });
    }
  }
  
  async getLatestDecision(symbol: string): Promise<FinalDecision | null> {
    const doc = await DecisionRecordModel
      .findOne({ symbol })
      .sort({ timestamp: -1 })
      .lean();
    
    return doc as FinalDecision | null;
  }
  
  async getDecisionHistory(
    symbol: string,
    limit = 50
  ): Promise<FinalDecision[]> {
    const docs = await DecisionRecordModel
      .find({ symbol })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    return docs as FinalDecision[];
  }
  
  async getDecisionStats(symbol?: string): Promise<{
    total: number;
    buy: number;
    sell: number;
    avoid: number;
    avgConfidence: number;
  }> {
    const query = symbol ? { symbol } : {};
    
    const [total, buy, sell, avoid] = await Promise.all([
      DecisionRecordModel.countDocuments(query),
      DecisionRecordModel.countDocuments({ ...query, action: 'BUY' }),
      DecisionRecordModel.countDocuments({ ...query, action: 'SELL' }),
      DecisionRecordModel.countDocuments({ ...query, action: 'AVOID' }),
    ]);
    
    const avgResult = await DecisionRecordModel.aggregate([
      { $match: { ...query, action: { $ne: 'AVOID' } } },
      { $group: { _id: null, avgConf: { $avg: '$confidence' } } },
    ]);
    
    const avgConfidence = avgResult[0]?.avgConf ?? 0;
    
    return { total, buy, sell, avoid, avgConfidence };
  }
}

export const finalDecisionService = new FinalDecisionService();

console.log('[Phase 4] Final Decision Service loaded');
