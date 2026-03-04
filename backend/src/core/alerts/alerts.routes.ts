/**
 * Alerts Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './alerts.service.js';
import * as rulesRepo from './alert_rules.repository.js';
import {
  CreateAlertRuleBody,
  UpdateAlertRuleBody,
  GetAlertRulesQuery,
  GetAlertFeedQuery,
  RuleIdParams,
  AlertIdParams,
} from './alerts.schema.js';

// Helper to get userId
function getUserId(request: FastifyRequest): string {
  const userId = request.headers['x-user-id'] as string;
  return userId || 'anonymous';
}

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  // ========== ALERT RULES ==========
  
  /**
   * POST /api/alerts/rules
   * Create new alert rule (auto-creates WatchlistItem)
   */
  app.post('/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const body = CreateAlertRuleBody.parse(request.body);
    
    const rule = await service.createAlertRule(
      userId,
      body.scope,
      body.targetId,
      body.triggerTypes,
      {
        trigger: body.trigger,
        channels: body.channels,
        minSeverity: body.minSeverity,
        minConfidence: body.minConfidence,
        minStability: body.minStability,
        throttle: body.throttle,
        sensitivity: body.sensitivity,  // A5.4: Pass sensitivity
        name: body.name,
        targetMeta: body.targetMeta,
      }
    );
    
    return reply.status(201).send({ ok: true, data: rule });
  });
  
  /**
   * GET /api/alerts/rules
   * Get user's alert rules
   */
  app.get('/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const query = GetAlertRulesQuery.parse(request.query);
    
    const rules = await service.getUserAlertRules(userId, query.activeOnly);
    
    return { ok: true, data: rules, count: rules.length };
  });
  
  /**
   * PUT /api/alerts/rules/:id
   * Update alert rule
   */
  app.put('/rules/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = RuleIdParams.parse(request.params);
    const body = UpdateAlertRuleBody.parse(request.body);
    
    const rule = await service.updateAlertRule(params.id, userId, body);
    
    if (!rule) {
      return reply.status(404).send({ ok: false, error: 'Rule not found' });
    }
    
    return { ok: true, data: rule };
  });
  
  /**
   * DELETE /api/alerts/rules/:id
   * Delete alert rule
   */
  app.delete('/rules/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = RuleIdParams.parse(request.params);
    
    const deleted = await service.deleteAlertRule(params.id, userId);
    
    if (!deleted) {
      return reply.status(404).send({ ok: false, error: 'Rule not found' });
    }
    
    return { ok: true };
  });
  
  // ========== ALERTS FEED ==========
  
  /**
   * GET /api/alerts/feed
   * Get user's alert feed
   */
  app.get('/feed', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const query = GetAlertFeedQuery.parse(request.query);
    
    const alerts = await service.getAlertFeed(userId, {
      unacknowledgedOnly: query.unacknowledged,
      limit: query.limit,
      offset: query.offset,
    });
    
    const unacknowledgedCount = await service.getUnacknowledgedCount(userId);
    
    return { ok: true, data: alerts, count: alerts.length, unacknowledgedCount };
  });
  
  /**
   * POST /api/alerts/:id/ack
   * Acknowledge alert
   */
  app.post('/:id/ack', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = AlertIdParams.parse(request.params);
    
    const alert = await service.acknowledgeAlert(params.id, userId);
    
    if (!alert) {
      return reply.status(404).send({ ok: false, error: 'Alert not found' });
    }
    
    return { ok: true, data: alert };
  });
  
  /**
   * POST /api/alerts/ack-all
   * Acknowledge all alerts
   */
  app.post('/ack-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    const count = await service.acknowledgeAllAlerts(userId);
    
    return { ok: true, acknowledgedCount: count };
  });
  
  /**
   * GET /api/alerts/stats
   * Get alerts statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    const [alertStats, rulesStats] = await Promise.all([
      service.getAlertsStats(userId),
      rulesRepo.getAlertRulesStats(),
    ]);
    
    return {
      ok: true,
      data: {
        alerts: alertStats,
        rules: rulesStats,
      },
    };
  });
  
  // ========== FEEDBACK LOOP (P3) ==========
  
  /**
   * GET /api/alerts/rules/:id/feedback
   * Get feedback status for a rule (A5.1 stats)
   */
  app.get('/rules/:id/feedback', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = RuleIdParams.parse(request.params);
    
    const rule = await rulesRepo.getAlertRuleById(params.id);
    
    if (!rule || rule.userId !== userId) {
      return reply.status(404).send({ ok: false, error: 'Rule not found' });
    }
    
    // Get fresh stats
    const { getAlertStats } = await import('./alert_rules.model.js');
    const stats = await getAlertStats(params.id);
    
    // Calculate triggers in last 24h from recentTriggerTimestamps
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const triggersIn24h = (rule.recentTriggerTimestamps || [])
      .filter((ts: Date) => new Date(ts) > twentyFourHoursAgo)
      .length;
    
    const noiseScore = stats?.noiseScore || triggersIn24h;
    
    // Determine feedback based on A5.1 rules
    // noiseScore >= 3 → suggest reduce sensitivity
    // noiseScore >= 6 + highestPriority !== high → suggest pause
    const shouldReduceSensitivity = noiseScore >= 3 && stats?.highestPriority24h !== 'high';
    const shouldPause = noiseScore >= 6 && stats?.highestPriority24h !== 'high';
    
    let recommendation = null;
    if (shouldPause) {
      recommendation = 'This monitoring has triggered frequently with moderate priority. Consider pausing to reduce noise.';
    } else if (shouldReduceSensitivity) {
      recommendation = 'This monitoring is triggering often. Consider reducing sensitivity to focus on more significant events.';
    }
    
    return {
      ok: true,
      data: {
        // A5.1: Full stats
        stats: {
          triggers24h: stats?.triggers24h || triggersIn24h,
          suppressedCount24h: stats?.suppressedCount24h || 0,
          highestPriority24h: stats?.highestPriority24h || 'low',
          dominantReason24h: stats?.dominantReason24h || null,
          noiseScore,
        },
        
        // Legacy fields
        triggersIn24h,
        totalTriggerCount: rule.triggerCount,
        
        // Feedback decisions
        showFeedback: shouldReduceSensitivity,
        suggestPause: shouldPause,
        feedbackSent: rule.feedbackStatus?.feedbackSent || false,
        recommendation,
        
        // Current sensitivity
        currentSensitivity: rule.sensitivity || 'medium',
      },
    };
  });
  
  /**
   * POST /api/alerts/rules/:id/pause
   * Pause alert rule (from feedback action)
   */
  app.post('/rules/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = RuleIdParams.parse(request.params);
    
    const rule = await service.updateAlertRule(params.id, userId, { status: 'paused' });
    
    if (!rule) {
      return reply.status(404).send({ ok: false, error: 'Rule not found' });
    }
    
    // Reset feedback status after user action
    const { resetFeedbackStatus } = await import('./alert_rules.model.js');
    await resetFeedbackStatus(params.id);
    
    return { ok: true, data: rule };
  });
  
  /**
   * POST /api/alerts/rules/:id/reduce-sensitivity
   * Reduce sensitivity (move from high→medium→low)
   */
  app.post('/rules/:id/reduce-sensitivity', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = RuleIdParams.parse(request.params);
    
    const existingRule = await rulesRepo.getAlertRuleById(params.id);
    
    if (!existingRule || existingRule.userId !== userId) {
      return reply.status(404).send({ ok: false, error: 'Rule not found' });
    }
    
    // Map current sensitivity to next lower level
    const { sensitivityToMinSeverity, sensitivityToThrottle } = await import('./alert_rules.model.js');
    
    const currentSensitivity = existingRule.sensitivity || 'medium';
    const nextSensitivity = currentSensitivity === 'high' ? 'medium' : 'low';
    
    const newSeverity = sensitivityToMinSeverity(nextSensitivity);
    const newThrottle = sensitivityToThrottle(nextSensitivity);
    
    const rule = await service.updateAlertRule(params.id, userId, { 
      minSeverity: newSeverity,
      throttle: newThrottle,
      sensitivity: nextSensitivity,
    });
    
    // Reset feedback status after user action
    const { resetFeedbackStatus } = await import('./alert_rules.model.js');
    await resetFeedbackStatus(params.id);
    
    return { 
      ok: true, 
      data: rule,
      previousSensitivity: currentSensitivity,
      newSensitivity: nextSensitivity,
      message: `Sensitivity changed from ${currentSensitivity} to ${nextSensitivity}. Expected fewer triggers.`,
    };
  });
  
  /**
   * GET /api/alerts/sensitivity-presets
   * Get sensitivity preset configurations for UI
   */
  app.get('/sensitivity-presets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { 
      TOKEN_SENSITIVITY_PRESETS, 
      WALLET_SENSITIVITY_PRESETS 
    } = await import('./alert_rules.model.js');
    
    return {
      ok: true,
      data: {
        token: TOKEN_SENSITIVITY_PRESETS,
        wallet: WALLET_SENSITIVITY_PRESETS,
        levels: ['low', 'medium', 'high'],
        descriptions: {
          high: {
            label: 'High',
            description: 'Get notified about any unusual activity',
            frequency: 'May trigger multiple times per day',
          },
          medium: {
            label: 'Medium',
            description: 'Get notified about notable activity only',
            frequency: 'A few times per week',
          },
          low: {
            label: 'Low',
            description: 'Get notified about major movements only',
            frequency: 'Rarely, only significant events',
          },
        },
      },
    };
  });
  
  /**
   * PUT /api/alerts/rules/:id/sensitivity
   * Update sensitivity level for a rule
   */
  app.put('/rules/:id/sensitivity', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = RuleIdParams.parse(request.params);
    const body = request.body as { sensitivity: string };
    
    if (!['low', 'medium', 'high'].includes(body.sensitivity)) {
      return reply.status(400).send({ ok: false, error: 'Invalid sensitivity level' });
    }
    
    const existingRule = await rulesRepo.getAlertRuleById(params.id);
    
    if (!existingRule || existingRule.userId !== userId) {
      return reply.status(404).send({ ok: false, error: 'Rule not found' });
    }
    
    const { sensitivityToMinSeverity, sensitivityToThrottle, getSensitivityConfig } = await import('./alert_rules.model.js');
    
    const newSensitivity = body.sensitivity as 'low' | 'medium' | 'high';
    const newSeverity = sensitivityToMinSeverity(newSensitivity);
    const newThrottle = sensitivityToThrottle(newSensitivity);
    const config = getSensitivityConfig(existingRule.scope, newSensitivity);
    
    const rule = await service.updateAlertRule(params.id, userId, { 
      minSeverity: newSeverity,
      throttle: newThrottle,
      sensitivity: newSensitivity,
    });
    
    // Reset feedback status after sensitivity change
    const { resetFeedbackStatus } = await import('./alert_rules.model.js');
    await resetFeedbackStatus(params.id);
    
    return { 
      ok: true, 
      data: rule,
      sensitivityConfig: config,
      message: `Sensitivity set to ${newSensitivity}. ${config.expectedFrequency}`,
    };
  });
}
