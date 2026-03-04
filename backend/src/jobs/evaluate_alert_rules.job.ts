/**
 * Evaluate Alert Rules Job (P0 FIX)
 * 
 * THE MISSING PIECE: This job evaluates user-created alert rules against actual blockchain data.
 * Without this, alerts are created but never triggered.
 * 
 * Flow:
 * 1. Get all active AlertRules
 * 2. For each rule, check if conditions are met
 * 3. If met, create normalized event → A0-A4 pipeline → Telegram notification
 * 
 * Runs every 60 seconds (1 minute)
 */
import { AlertRuleModel, IAlertRule } from '../core/alerts/alert_rules.model.js';
import { TransferModel } from '../core/transfers/transfers.model.js';
import { alertPipeline } from '../core/alerts/alert.pipeline.js';

let lastRunTime: Date | null = null;

export interface EvaluateAlertRulesResult {
  rulesEvaluated: number;
  eventsTriggered: number;
  duration: number;
}

/**
 * Evaluate all active alert rules
 */
export async function evaluateAlertRules(): Promise<EvaluateAlertRulesResult> {
  const startTime = Date.now();
  let rulesEvaluated = 0;
  let eventsTriggered = 0;
  
  try {
    // Get all active alert rules
    const rules = await AlertRuleModel
      .find({ 
        active: true,
        status: 'active', // Only active, not paused
      })
      .lean() as IAlertRule[];
    
    if (rules.length === 0) {
      lastRunTime = new Date();
      return { rulesEvaluated: 0, eventsTriggered: 0, duration: Date.now() - startTime };
    }
    
    // Use last run time or 5 minutes ago if first run
    const checkSince = lastRunTime || new Date(Date.now() - 5 * 60 * 1000);
    
    // Group rules by target for efficient querying
    const rulesByTarget = new Map<string, IAlertRule[]>();
    for (const rule of rules) {
      const key = `${rule.targetType}:${rule.targetId}`;
      if (!rulesByTarget.has(key)) {
        rulesByTarget.set(key, []);
      }
      rulesByTarget.get(key)!.push(rule);
    }
    
    // Evaluate each target
    for (const [targetKey, targetRules] of rulesByTarget.entries()) {
      const [targetType, targetId] = targetKey.split(':');
      
      try {
        if (targetType === 'token') {
          // Check token activity
          const triggered = await evaluateTokenRules(targetId, targetRules, checkSince);
          eventsTriggered += triggered;
          rulesEvaluated += targetRules.length;
        } else if (targetType === 'wallet') {
          // Check wallet activity
          const triggered = await evaluateWalletRules(targetId, targetRules, checkSince);
          eventsTriggered += triggered;
          rulesEvaluated += targetRules.length;
        }
      } catch (err) {
        console.error(`[Evaluate Alert Rules] Error evaluating ${targetKey}:`, err);
      }
    }
    
    lastRunTime = new Date();
    
    console.log(`[Evaluate Alert Rules] Evaluated ${rulesEvaluated} rules, triggered ${eventsTriggered} events (${Date.now() - startTime}ms)`);
    
  } catch (err) {
    console.error('[Evaluate Alert Rules] Job failed:', err);
  }
  
  return {
    rulesEvaluated,
    eventsTriggered,
    duration: Date.now() - startTime,
  };
}

/**
 * Evaluate rules for a specific token
 */
async function evaluateTokenRules(
  tokenAddress: string,
  rules: IAlertRule[],
  since: Date
): Promise<number> {
  let triggered = 0;
  
  // Get recent transfers for this token
  const transfers = await TransferModel
    .find({
      tokenAddress: tokenAddress.toLowerCase(),
      timestamp: { $gt: since },
    })
    .sort({ timestamp: -1 })
    .limit(1000)
    .lean();
  
  if (transfers.length === 0) {
    return 0;
  }
  
  // Calculate aggregated metrics
  const metrics = calculateTokenMetrics(transfers);
  
  // Check each rule
  for (const rule of rules) {
    try {
      const shouldTrigger = checkRuleCondition(rule, metrics);
      
      if (shouldTrigger) {
        // Create raw signal for pipeline
        const rawSignal = {
          type: rule.trigger.type || 'accumulation',
          scope: 'token',
          targetType: 'token' as const,
          targetId: tokenAddress,
          chain: 'ethereum',
          value: metrics.netFlow,
          window: rule.trigger.params?.window || '1h',
          direction: metrics.netFlow > 0 ? 'in' : 'out',
          metadata: {
            txCount: metrics.txCount,
            uniqueWallets: metrics.uniqueWallets,
          },
        };
        
        // Send through A0-A4 pipeline
        await alertPipeline.process(rawSignal, rule._id.toString(), rule.userId);
        
        // Update rule trigger tracking
        await AlertRuleModel.updateOne(
          { _id: rule._id },
          {
            $set: {
              lastTriggeredAt: new Date(),
              updatedAt: new Date(),
            },
            $inc: { triggerCount: 1 },
          }
        );
        
        triggered++;
      }
    } catch (err) {
      console.error(`[Evaluate Alert Rules] Error checking rule ${rule._id}:`, err);
    }
  }
  
  return triggered;
}

/**
 * Evaluate rules for a specific wallet
 */
async function evaluateWalletRules(
  walletAddress: string,
  rules: IAlertRule[],
  since: Date
): Promise<number> {
  let triggered = 0;
  
  // Get recent transfers FROM this wallet
  const outTransfers = await TransferModel
    .find({
      from: walletAddress.toLowerCase(),
      timestamp: { $gt: since },
    })
    .sort({ timestamp: -1 })
    .limit(500)
    .lean();
  
  // Get recent transfers TO this wallet
  const inTransfers = await TransferModel
    .find({
      to: walletAddress.toLowerCase(),
      timestamp: { $gt: since },
    })
    .sort({ timestamp: -1 })
    .limit(500)
    .lean();
  
  const allTransfers = [...outTransfers, ...inTransfers];
  
  if (allTransfers.length === 0) {
    return 0;
  }
  
  // Calculate wallet metrics
  const metrics = calculateWalletMetrics(outTransfers, inTransfers);
  
  // Check each rule
  for (const rule of rules) {
    try {
      const shouldTrigger = checkRuleCondition(rule, metrics);
      
      if (shouldTrigger) {
        // Determine signal type based on activity
        let signalType = 'activity_spike';
        if (metrics.netFlow > 0) {
          signalType = 'accumulation';
        } else if (metrics.netFlow < 0) {
          signalType = 'distribution';
        }
        if (metrics.maxTxValue > (rule.trigger.params?.amount || 10000)) {
          signalType = 'large_move';
        }
        
        // Create raw signal for pipeline
        const rawSignal = {
          type: signalType,
          scope: 'wallet',
          targetType: 'wallet' as const,
          targetId: walletAddress,
          chain: 'ethereum',
          value: Math.abs(metrics.netFlow),
          window: rule.trigger.params?.window || '1h',
          direction: metrics.netFlow > 0 ? 'in' : 'out',
          metadata: {
            txCount: metrics.txCount,
            maxTxValue: metrics.maxTxValue,
          },
        };
        
        // Send through A0-A4 pipeline
        await alertPipeline.process(rawSignal, rule._id.toString(), rule.userId);
        
        // Update rule trigger tracking
        await AlertRuleModel.updateOne(
          { _id: rule._id },
          {
            $set: {
              lastTriggeredAt: new Date(),
              updatedAt: new Date(),
            },
            $inc: { triggerCount: 1 },
          }
        );
        
        triggered++;
      }
    } catch (err) {
      console.error(`[Evaluate Alert Rules] Error checking rule ${rule._id}:`, err);
    }
  }
  
  return triggered;
}

/**
 * Calculate token metrics from transfers
 */
function calculateTokenMetrics(transfers: any[]): {
  netFlow: number;
  totalIn: number;
  totalOut: number;
  txCount: number;
  uniqueWallets: number;
} {
  let totalIn = 0;
  let totalOut = 0;
  const wallets = new Set<string>();
  
  for (const tx of transfers) {
    const value = parseFloat(tx.value || tx.valueUSD || '0');
    
    // Simplified: assume positive values are IN, negative are OUT
    // In real implementation, check transfer direction
    if (value > 0) {
      totalIn += value;
    } else {
      totalOut += Math.abs(value);
    }
    
    if (tx.from) wallets.add(tx.from);
    if (tx.to) wallets.add(tx.to);
  }
  
  return {
    netFlow: totalIn - totalOut,
    totalIn,
    totalOut,
    txCount: transfers.length,
    uniqueWallets: wallets.size,
  };
}

/**
 * Calculate wallet metrics from transfers
 */
function calculateWalletMetrics(outTransfers: any[], inTransfers: any[]): {
  netFlow: number;
  totalIn: number;
  totalOut: number;
  txCount: number;
  maxTxValue: number;
} {
  let totalIn = 0;
  let totalOut = 0;
  let maxTxValue = 0;
  
  for (const tx of inTransfers) {
    const value = parseFloat(tx.valueUSD || '0');
    totalIn += value;
    maxTxValue = Math.max(maxTxValue, value);
  }
  
  for (const tx of outTransfers) {
    const value = parseFloat(tx.valueUSD || '0');
    totalOut += value;
    maxTxValue = Math.max(maxTxValue, value);
  }
  
  return {
    netFlow: totalIn - totalOut,
    totalIn,
    totalOut,
    txCount: inTransfers.length + outTransfers.length,
    maxTxValue,
  };
}

/**
 * Check if rule condition is met
 */
function checkRuleCondition(rule: IAlertRule, metrics: any): boolean {
  const triggerType = rule.trigger.type || rule.triggerTypes?.[0];
  const params = rule.trigger.params || {};
  
  switch (triggerType) {
    case 'accumulation':
      // Check if net inflow exceeds threshold
      return metrics.netFlow > (params.amount || 1000);
    
    case 'distribution':
      // Check if net outflow exceeds threshold
      return metrics.netFlow < -(params.amount || 1000);
    
    case 'large_move':
      // Check if any single transaction exceeds threshold
      return metrics.maxTxValue > (params.amount || 10000);
    
    case 'activity_spike':
      // Check if transaction count is unusually high
      return metrics.txCount > (params.txThreshold || 20);
    
    case 'smart_money_entry':
    case 'smart_money_exit':
      // Would require smart money detection - simplified for now
      return metrics.netFlow > (params.amount || 5000);
    
    default:
      // If no specific type, trigger on any significant activity
      return Math.abs(metrics.netFlow) > (params.amount || 1000) || metrics.txCount > 10;
  }
}

/**
 * Get job status
 */
export async function getEvaluateAlertRulesStatus(): Promise<{
  lastRun: string | null;
  activeRules: number;
}> {
  const activeRules = await AlertRuleModel.countDocuments({
    active: true,
    status: 'active',
  });
  
  return {
    lastRun: lastRunTime?.toISOString() || null,
    activeRules,
  };
}
