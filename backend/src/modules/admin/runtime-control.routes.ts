/**
 * Runtime Control API — S4.ADM
 * =============================
 * 
 * Единый центр управления всеми runtime-модулями.
 * Все переключения — только через этот API, не через env.
 * 
 * Модули:
 * - sentiment (MOCK/REAL)
 * - twitter (parser, sentiment, price)
 * - automation (start/stop/kill)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import os from 'os';

// ============================================================
// Runtime State (in-memory, singleton)
// ============================================================

interface RuntimeState {
  // Sentinel
  sentimentMode: 'MOCK' | 'REAL';
  sentimentEnabled: boolean;
  
  // Twitter
  twitterParserEnabled: boolean;
  twitterSentimentEnabled: boolean;
  twitterPriceEnabled: boolean;
  
  // Automation
  automationEnabled: boolean;
  automationRunning: boolean;
  
  // Safety
  globalKillSwitch: boolean;
  softStopActive: boolean;
  
  // Timestamps
  lastStateChange: Date;
  lastKillSwitchActivation: Date | null;
}

// Singleton state
const runtimeState: RuntimeState = {
  // Initialize from env, but can be changed at runtime
  sentimentMode: process.env.SENTIMENT_MOCK_MODE === 'false' ? 'REAL' : 'MOCK',
  sentimentEnabled: process.env.SENTIMENT_ENABLED !== 'false',
  
  twitterParserEnabled: process.env.TWITTER_PARSER_ENABLED === 'true',
  twitterSentimentEnabled: process.env.TWITTER_SENTIMENT_ENABLED === 'true',
  twitterPriceEnabled: process.env.TWITTER_PRICE_ENABLED === 'true',
  
  automationEnabled: process.env.TWITTER_SENTIMENT_AUTOMATION === 'true',
  automationRunning: false,
  
  globalKillSwitch: false,
  softStopActive: false,
  
  lastStateChange: new Date(),
  lastKillSwitchActivation: null,
};

// ============================================================
// RAM Monitoring
// ============================================================

const RAM_THRESHOLD_MB = 500; // Minimum free RAM for REAL mode
const REAL_ML_RAM_ESTIMATE_MB = 1024;

function getRAMStatus() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  return {
    totalMB: Math.round(totalMem / 1024 / 1024),
    freeMB: Math.round(freeMem / 1024 / 1024),
    usedMB: Math.round(usedMem / 1024 / 1024),
    usedPercent: Math.round((usedMem / totalMem) * 100),
    canEnableRealML: freeMem / 1024 / 1024 > RAM_THRESHOLD_MB + REAL_ML_RAM_ESTIMATE_MB,
    threshold: RAM_THRESHOLD_MB,
    realMLEstimate: REAL_ML_RAM_ESTIMATE_MB,
  };
}

// ============================================================
// System Health
// ============================================================

type HealthStatus = 'OK' | 'DEGRADED' | 'CRITICAL';

function getOverallHealth(): { status: HealthStatus; reasons: string[] } {
  const reasons: string[] = [];
  let status: HealthStatus = 'OK';
  
  const ram = getRAMStatus();
  
  // Check RAM
  if (ram.usedPercent > 90) {
    status = 'CRITICAL';
    reasons.push(`RAM critical: ${ram.usedPercent}% used`);
  } else if (ram.usedPercent > 75) {
    status = status === 'OK' ? 'DEGRADED' : status;
    reasons.push(`RAM high: ${ram.usedPercent}% used`);
  }
  
  // Check kill switch
  if (runtimeState.globalKillSwitch) {
    status = 'CRITICAL';
    reasons.push('Global kill switch is ACTIVE');
  }
  
  // Check soft stop
  if (runtimeState.softStopActive) {
    status = status === 'OK' ? 'DEGRADED' : status;
    reasons.push('Soft stop is active');
  }
  
  if (reasons.length === 0) {
    reasons.push('All systems nominal');
  }
  
  return { status, reasons };
}

// ============================================================
// Module Status
// ============================================================

function getModuleStatuses() {
  return {
    sentiment: {
      enabled: runtimeState.sentimentEnabled && !runtimeState.globalKillSwitch,
      mode: runtimeState.sentimentMode,
      status: runtimeState.globalKillSwitch ? 'STOPPED' : 
              runtimeState.sentimentEnabled ? 'RUNNING' : 'DISABLED',
    },
    twitter: {
      parserEnabled: runtimeState.twitterParserEnabled && !runtimeState.globalKillSwitch,
      sentimentEnabled: runtimeState.twitterSentimentEnabled && !runtimeState.globalKillSwitch,
      priceEnabled: runtimeState.twitterPriceEnabled && !runtimeState.globalKillSwitch,
      status: runtimeState.globalKillSwitch ? 'STOPPED' :
              runtimeState.twitterParserEnabled ? 'RUNNING' : 'DISABLED',
    },
    automation: {
      enabled: runtimeState.automationEnabled && !runtimeState.globalKillSwitch,
      running: runtimeState.automationRunning && !runtimeState.globalKillSwitch && !runtimeState.softStopActive,
      status: runtimeState.globalKillSwitch ? 'STOPPED' :
              runtimeState.softStopActive ? 'STOPPING' :
              runtimeState.automationRunning ? 'RUNNING' : 'IDLE',
    },
  };
}

// ============================================================
// Export state getter for other modules
// ============================================================

export function getRuntimeState() {
  return { ...runtimeState };
}

export function isKillSwitchActive() {
  return runtimeState.globalKillSwitch;
}

export function isSoftStopActive() {
  return runtimeState.softStopActive;
}

export function getSentimentMode() {
  return runtimeState.sentimentMode;
}

export function setAutomationRunning(running: boolean) {
  runtimeState.automationRunning = running;
}

// ============================================================
// Routes
// ============================================================

export default async function runtimeControlRoutes(app: FastifyInstance) {
  
  // ==================== ML OVERVIEW ====================
  
  /**
   * GET /api/v4/admin/runtime/overview
   * Overall system status
   */
  app.get('/api/v4/admin/runtime/overview', async (req: FastifyRequest, reply: FastifyReply) => {
    const health = getOverallHealth();
    const ram = getRAMStatus();
    const modules = getModuleStatuses();
    
    return reply.send({
      ok: true,
      data: {
        health,
        ram,
        modules,
        killSwitch: {
          global: runtimeState.globalKillSwitch,
          softStop: runtimeState.softStopActive,
          lastActivation: runtimeState.lastKillSwitchActivation,
        },
        lastStateChange: runtimeState.lastStateChange,
      },
    });
  });
  
  // ==================== SENTIMENT CONTROL ====================
  
  /**
   * GET /api/v4/admin/runtime/sentiment
   * Sentiment module status
   */
  app.get('/api/v4/admin/runtime/sentiment', async (req: FastifyRequest, reply: FastifyReply) => {
    const ram = getRAMStatus();
    
    // Get shadow status
    let shadowStatus = { enabled: false, mode: 'OFF', comparisons: 0 };
    try {
      const { realMLShadowClient } = await import('../sentiment/real-ml-shadow.client.js');
      const shadowData = realMLShadowClient.getStats();
      shadowStatus = {
        enabled: shadowData.enabled,
        mode: shadowData.enabled ? 'SHADOW' : 'OFF',
        comparisons: shadowData.stats.totalComparisons,
      };
    } catch (e) {
      // Shadow client not available
    }
    
    return reply.send({
      ok: true,
      data: {
        enabled: runtimeState.sentimentEnabled,
        mode: runtimeState.sentimentMode,
        shadow: shadowStatus,
        canSwitchToReal: ram.canEnableRealML && !runtimeState.globalKillSwitch,
        realModeBlocked: !ram.canEnableRealML,
        blockReason: !ram.canEnableRealML ? 
          `Insufficient RAM. Need ${RAM_THRESHOLD_MB + REAL_ML_RAM_ESTIMATE_MB}MB free, have ${ram.freeMB}MB` : null,
        version: '1.5.0',
        ruleset: 'A2-stable',
        frozen: true,
        ram: {
          free: ram.freeMB,
          threshold: RAM_THRESHOLD_MB,
          realEstimate: REAL_ML_RAM_ESTIMATE_MB,
        },
      },
    });
  });
  
  /**
   * POST /api/v4/admin/runtime/sentiment/toggle
   * Enable/disable sentiment
   */
  app.post('/api/v4/admin/runtime/sentiment/toggle', async (req: FastifyRequest, reply: FastifyReply) => {
    const { enabled } = req.body as { enabled: boolean };
    
    if (runtimeState.globalKillSwitch) {
      return reply.status(400).send({
        ok: false,
        error: 'KILL_SWITCH_ACTIVE',
        message: 'Cannot change state while global kill switch is active',
      });
    }
    
    runtimeState.sentimentEnabled = enabled;
    runtimeState.lastStateChange = new Date();
    
    console.log(`[Runtime] Sentiment ${enabled ? 'ENABLED' : 'DISABLED'}`);
    
    return reply.send({
      ok: true,
      message: `Sentiment ${enabled ? 'enabled' : 'disabled'}`,
      data: { enabled: runtimeState.sentimentEnabled },
    });
  });
  
  /**
   * POST /api/v4/admin/runtime/sentiment/mode
   * Switch MOCK/REAL mode
   */
  app.post('/api/v4/admin/runtime/sentiment/mode', async (req: FastifyRequest, reply: FastifyReply) => {
    const { mode } = req.body as { mode: 'MOCK' | 'REAL' };
    
    if (runtimeState.globalKillSwitch) {
      return reply.status(400).send({
        ok: false,
        error: 'KILL_SWITCH_ACTIVE',
        message: 'Cannot change mode while global kill switch is active',
      });
    }
    
    if (mode === 'REAL') {
      const ram = getRAMStatus();
      if (!ram.canEnableRealML) {
        return reply.status(400).send({
          ok: false,
          error: 'INSUFFICIENT_RAM',
          message: `Cannot enable REAL mode. Need ${RAM_THRESHOLD_MB + REAL_ML_RAM_ESTIMATE_MB}MB free RAM, have ${ram.freeMB}MB`,
        });
      }
    }
    
    runtimeState.sentimentMode = mode;
    runtimeState.lastStateChange = new Date();
    
    console.log(`[Runtime] Sentiment mode changed to ${mode}`);
    
    return reply.send({
      ok: true,
      message: `Sentiment mode set to ${mode}`,
      data: { mode: runtimeState.sentimentMode },
    });
  });
  
  // ==================== TWITTER CONTROL ====================
  
  /**
   * GET /api/v4/admin/runtime/twitter
   * Twitter module status
   */
  app.get('/api/v4/admin/runtime/twitter', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        parser: {
          enabled: runtimeState.twitterParserEnabled,
          status: runtimeState.globalKillSwitch ? 'STOPPED' : 
                  runtimeState.twitterParserEnabled ? 'RUNNING' : 'DISABLED',
        },
        sentiment: {
          enabled: runtimeState.twitterSentimentEnabled,
        },
        price: {
          enabled: runtimeState.twitterPriceEnabled,
          locked: true,
          lockReason: 'Phase S5 not implemented',
        },
        flags: {
          TWITTER_PARSER_ENABLED: runtimeState.twitterParserEnabled,
          TWITTER_SENTIMENT_ENABLED: runtimeState.twitterSentimentEnabled,
          TWITTER_PRICE_ENABLED: runtimeState.twitterPriceEnabled,
        },
      },
    });
  });
  
  /**
   * POST /api/v4/admin/runtime/twitter/flags
   * Update Twitter runtime flags
   */
  app.post('/api/v4/admin/runtime/twitter/flags', async (req: FastifyRequest, reply: FastifyReply) => {
    const { parser, sentiment, price } = req.body as { 
      parser?: boolean; 
      sentiment?: boolean; 
      price?: boolean;
    };
    
    if (runtimeState.globalKillSwitch) {
      return reply.status(400).send({
        ok: false,
        error: 'KILL_SWITCH_ACTIVE',
        message: 'Cannot change flags while global kill switch is active',
      });
    }
    
    // Price is locked
    if (price === true) {
      return reply.status(400).send({
        ok: false,
        error: 'PRICE_LOCKED',
        message: 'Price module is locked until Phase S5',
      });
    }
    
    if (parser !== undefined) runtimeState.twitterParserEnabled = parser;
    if (sentiment !== undefined) runtimeState.twitterSentimentEnabled = sentiment;
    
    runtimeState.lastStateChange = new Date();
    
    console.log(`[Runtime] Twitter flags updated: parser=${runtimeState.twitterParserEnabled}, sentiment=${runtimeState.twitterSentimentEnabled}`);
    
    return reply.send({
      ok: true,
      message: 'Twitter flags updated',
      data: {
        parser: runtimeState.twitterParserEnabled,
        sentiment: runtimeState.twitterSentimentEnabled,
        price: runtimeState.twitterPriceEnabled,
      },
    });
  });
  
  // ==================== AUTOMATION CONTROL ====================
  
  /**
   * GET /api/v4/admin/runtime/automation
   * Automation status
   */
  app.get('/api/v4/admin/runtime/automation', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        enabled: runtimeState.automationEnabled,
        running: runtimeState.automationRunning,
        blocked: runtimeState.globalKillSwitch || runtimeState.softStopActive,
        blockReason: runtimeState.globalKillSwitch ? 'Global kill switch active' :
                     runtimeState.softStopActive ? 'Soft stop active' : null,
        status: runtimeState.globalKillSwitch ? 'KILLED' :
                runtimeState.softStopActive ? 'STOPPING' :
                runtimeState.automationRunning ? 'RUNNING' : 'IDLE',
      },
    });
  });
  
  /**
   * POST /api/v4/admin/runtime/automation/toggle
   * Enable/disable automation
   */
  app.post('/api/v4/admin/runtime/automation/toggle', async (req: FastifyRequest, reply: FastifyReply) => {
    const { enabled } = req.body as { enabled: boolean };
    
    if (runtimeState.globalKillSwitch) {
      return reply.status(400).send({
        ok: false,
        error: 'KILL_SWITCH_ACTIVE',
        message: 'Cannot change automation while global kill switch is active',
      });
    }
    
    runtimeState.automationEnabled = enabled;
    if (!enabled) {
      runtimeState.automationRunning = false;
    }
    runtimeState.lastStateChange = new Date();
    
    console.log(`[Runtime] Automation ${enabled ? 'ENABLED' : 'DISABLED'}`);
    
    return reply.send({
      ok: true,
      message: `Automation ${enabled ? 'enabled' : 'disabled'}`,
      data: { enabled: runtimeState.automationEnabled },
    });
  });
  
  // ==================== SAFETY / KILL SWITCHES ====================
  
  /**
   * POST /api/v4/admin/runtime/kill-switch
   * Activate global kill switch
   */
  app.post('/api/v4/admin/runtime/kill-switch', async (req: FastifyRequest, reply: FastifyReply) => {
    const { activate } = req.body as { activate: boolean };
    
    runtimeState.globalKillSwitch = activate;
    
    if (activate) {
      // Stop everything
      runtimeState.automationRunning = false;
      runtimeState.lastKillSwitchActivation = new Date();
      
      // ML1: Stop shadow mode on kill switch
      try {
        const { realMLShadowClient } = await import('../sentiment/real-ml-shadow.client.js');
        realMLShadowClient.setEnabled(false);
        console.log('[Runtime] ML1 Shadow disabled by kill switch');
      } catch (e) {
        // Shadow client not available
      }
      
      console.log('[Runtime] 🔴 GLOBAL KILL SWITCH ACTIVATED');
    } else {
      console.log('[Runtime] 🟢 Global kill switch deactivated');
    }
    
    runtimeState.lastStateChange = new Date();
    
    return reply.send({
      ok: true,
      message: activate ? 'GLOBAL KILL SWITCH ACTIVATED' : 'Kill switch deactivated',
      data: {
        globalKillSwitch: runtimeState.globalKillSwitch,
        affectedModules: ['sentiment', 'twitter', 'automation', 'ml1-shadow'],
      },
    });
  });
  
  /**
   * POST /api/v4/admin/runtime/soft-stop
   * Activate soft stop (finish current batch, stop new)
   */
  app.post('/api/v4/admin/runtime/soft-stop', async (req: FastifyRequest, reply: FastifyReply) => {
    const { activate } = req.body as { activate: boolean };
    
    runtimeState.softStopActive = activate;
    runtimeState.lastStateChange = new Date();
    
    console.log(`[Runtime] Soft stop ${activate ? 'ACTIVATED' : 'deactivated'}`);
    
    return reply.send({
      ok: true,
      message: activate ? 'Soft stop activated - finishing current batch' : 'Soft stop deactivated',
      data: { softStopActive: runtimeState.softStopActive },
    });
  });
  
  /**
   * POST /api/v4/admin/runtime/reset
   * Reset all states to defaults
   */
  app.post('/api/v4/admin/runtime/reset', async (req: FastifyRequest, reply: FastifyReply) => {
    // Reset to safe defaults
    runtimeState.globalKillSwitch = false;
    runtimeState.softStopActive = false;
    runtimeState.sentimentMode = 'MOCK';
    runtimeState.sentimentEnabled = true;
    runtimeState.automationEnabled = true;
    runtimeState.automationRunning = false;
    runtimeState.lastStateChange = new Date();
    
    console.log('[Runtime] State reset to defaults');
    
    return reply.send({
      ok: true,
      message: 'Runtime state reset to defaults',
      data: getRuntimeState(),
    });
  });
  
  console.log('[Runtime Control] Routes registered');
}
