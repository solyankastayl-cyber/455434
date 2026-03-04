/**
 * FOMO AI WebSocket Service
 * 
 * Provides real-time decision updates for FOMO AI
 * - Broadcasts decision changes on channel `fomo:${symbol}`
 * - Periodic updates every 5 seconds for subscribed symbols
 */

import { wsServer } from '../../../ws/ws.server.js';

// Active symbols being monitored
const activeSymbols = new Set<string>();

// Update intervals per symbol
const updateIntervals = new Map<string, NodeJS.Timeout>();

// Last decision cache to detect changes
const lastDecisionCache = new Map<string, { action: string; confidence: number }>();

/**
 * Build decision context and get decision
 */
async function getDecisionForSymbol(symbol: string) {
  try {
    // Dynamically import to avoid circular deps
    const { finalDecisionService } = await import('../../finalDecision/services/finalDecision.service.js');
    const { buildDecisionContext } = await import('../../finalDecision/services/context.builder.js');
    
    // Build context
    const context = await buildDecisionContext(symbol);
    
    // Get decision
    const decision = finalDecisionService.decide(context);
    
    return {
      ok: true,
      ...decision,
    };
  } catch (error) {
    console.error(`[FOMO WS] Failed to get decision for ${symbol}:`, error);
    return { ok: false, error: String(error) };
  }
}

/**
 * Start monitoring a symbol for decision updates
 */
export function startFomoMonitor(symbol: string): void {
  if (activeSymbols.has(symbol)) return;
  
  activeSymbols.add(symbol);
  console.log(`[FOMO WS] Started monitoring ${symbol}`);
  
  // Initial broadcast
  broadcastDecision(symbol);
  
  // Set up periodic updates (every 5 seconds)
  const interval = setInterval(() => {
    broadcastDecision(symbol);
  }, 5000);
  
  updateIntervals.set(symbol, interval);
}

/**
 * Stop monitoring a symbol
 */
export function stopFomoMonitor(symbol: string): void {
  const interval = updateIntervals.get(symbol);
  if (interval) {
    clearInterval(interval);
    updateIntervals.delete(symbol);
  }
  activeSymbols.delete(symbol);
  lastDecisionCache.delete(symbol);
  console.log(`[FOMO WS] Stopped monitoring ${symbol}`);
}

/**
 * Broadcast decision update for a symbol
 */
async function broadcastDecision(symbol: string): Promise<void> {
  try {
    const decision = await getDecisionForSymbol(symbol);
    
    if (!decision.ok) {
      console.error(`[FOMO WS] Failed to get decision for ${symbol}`);
      return;
    }
    
    // Check if decision changed
    const lastDecision = lastDecisionCache.get(symbol);
    const currentDecision = { 
      action: decision.action, 
      confidence: Math.round(decision.confidence * 1000) / 1000 
    };
    
    const changed = !lastDecision || 
      lastDecision.action !== currentDecision.action ||
      Math.abs(lastDecision.confidence - currentDecision.confidence) > 0.01;
    
    // Update cache
    lastDecisionCache.set(symbol, currentDecision);
    
    // Broadcast to channel
    const channel = `fomo:${symbol}`;
    wsServer.broadcast(channel, 'decision_update', {
      symbol: decision.symbol,
      action: decision.action,
      confidence: decision.confidence,
      timestamp: decision.timestamp,
      explainability: decision.explainability,
      context: decision.context,
      changed,
    });
    
    if (changed) {
      console.log(`[FOMO WS] Decision changed for ${symbol}: ${decision.action} @ ${(decision.confidence * 100).toFixed(1)}%`);
      
      // Dispatch FOMO AI alerts
      try {
        const { fomoAlertEngine } = await import('../../fomo-alerts/index.js');
        
        // DECISION_CHANGED alert
        if (lastDecision) {
          await fomoAlertEngine.emitDecisionChanged({
            symbol: decision.symbol,
            previousAction: lastDecision.action as 'BUY' | 'SELL' | 'AVOID',
            newAction: decision.action as 'BUY' | 'SELL' | 'AVOID',
            previousConfidence: lastDecision.confidence,
            newConfidence: decision.confidence,
            reasons: decision.explainability?.appliedRules?.slice(0, 4) || [],
            timestamp: decision.timestamp,
          });
        }
        
        // HIGH_CONFIDENCE alert (for new BUY/SELL)
        if (decision.action === 'BUY' || decision.action === 'SELL') {
          await fomoAlertEngine.emitHighConfidence({
            symbol: decision.symbol,
            action: decision.action as 'BUY' | 'SELL',
            confidence: decision.confidence,
            drivers: decision.explainability?.appliedRules?.slice(0, 4) || [],
            riskLevel: decision.explainability?.riskFlags?.whaleRisk || 'LOW',
            dataMode: decision.explainability?.dataMode || 'LIVE',
          });
        }
      } catch (alertErr) {
        console.error('[FOMO WS] FOMO Alert dispatch failed:', alertErr);
      }
    }
  } catch (error) {
    console.error(`[FOMO WS] Error broadcasting decision for ${symbol}:`, error);
  }
}

/**
 * Get active monitors status
 */
export function getMonitorStatus(): {
  activeSymbols: string[];
  clientCount: number;
} {
  return {
    activeSymbols: Array.from(activeSymbols),
    clientCount: wsServer.getClientCount(),
  };
}

/**
 * Manually trigger decision broadcast
 */
export async function triggerBroadcast(symbol: string): Promise<void> {
  await broadcastDecision(symbol);
}

// Auto-start monitoring for common symbols
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

export function initFomoWsMonitor(): void {
  console.log('[FOMO WS] Initializing monitors...');
  
  for (const symbol of DEFAULT_SYMBOLS) {
    startFomoMonitor(symbol);
  }
  
  console.log(`[FOMO WS] Monitoring ${DEFAULT_SYMBOLS.length} symbols`);
}

console.log('[FOMO WS] FOMO AI WebSocket Service loaded');
