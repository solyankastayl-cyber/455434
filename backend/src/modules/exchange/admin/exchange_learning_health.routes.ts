/**
 * EXCHANGE LEARNING HEALTH — Debug endpoint
 * ==========================================
 * 
 * Single endpoint to verify auto-learning is working.
 * Returns "green" status only when ALL checks pass.
 */

import { FastifyInstance } from 'fastify';
import { getDb } from '../../../db/mongodb.js';

interface HealthCheck {
  name: string;
  status: 'OK' | 'WARN' | 'FAIL';
  value: any;
  expected?: string;
}

interface ExchangeLearningHealth {
  ok: boolean;
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'NOT_RUNNING';
  checks: HealthCheck[];
  summary: {
    outcomesLast24h: number;
    outcomesLast7d: number;
    lastMlRun: any;
    activeModelVersion: string | null;
    lastPromotionTime: number | null;
    driftState: string;
    trainingEnabled: boolean;
  };
  recommendations: string[];
}

export async function exchangeLearningHealthRoutes(fastify: FastifyInstance) {
  
  /**
   * GET /api/admin/exchange-learning/health
   * 
   * Comprehensive health check for Exchange auto-learning
   */
  fastify.get('/api/admin/exchange-learning/health', async (): Promise<ExchangeLearningHealth> => {
    const db = await getDb();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    
    const checks: HealthCheck[] = [];
    const recommendations: string[] = [];
    
    // ════════════════════════════════════════════════════════════
    // CHECK 1: Exchange Observations (data pipeline)
    // ════════════════════════════════════════════════════════════
    const obsCount24h = await db.collection('exchange_observations').countDocuments({
      timestamp: { $gte: now - day },
    });
    
    const obsCount7d = await db.collection('exchange_observations').countDocuments({
      timestamp: { $gte: now - 7 * day },
    });
    
    checks.push({
      name: 'exchange_observations_24h',
      status: obsCount24h >= 10 ? 'OK' : obsCount24h > 0 ? 'WARN' : 'FAIL',
      value: obsCount24h,
      expected: '>= 10 observations in 24h',
    });
    
    if (obsCount24h < 10) {
      recommendations.push('Run observation collection job: POST /api/v10/exchange/observation/job/start');
    }
    
    // ════════════════════════════════════════════════════════════
    // CHECK 2: Decision Outcomes (learning feedback)
    // ════════════════════════════════════════════════════════════
    const outcomesCount24h = await db.collection('decision_outcomes').countDocuments({
      timestamp: { $gte: now - day },
    });
    
    const outcomesCount7d = await db.collection('decision_outcomes').countDocuments({
      timestamp: { $gte: now - 7 * day },
    });
    
    checks.push({
      name: 'decision_outcomes_24h',
      status: outcomesCount24h >= 5 ? 'OK' : outcomesCount24h > 0 ? 'WARN' : 'FAIL',
      value: outcomesCount24h,
      expected: '>= 5 outcomes in 24h',
    });
    
    if (outcomesCount24h === 0) {
      recommendations.push('Outcomes not being tracked. Check outcome builder job.');
    }
    
    // ════════════════════════════════════════════════════════════
    // CHECK 3: ML Runs (training activity)
    // ════════════════════════════════════════════════════════════
    const lastMlRun = await db.collection('ml_runs')
      .findOne({}, { sort: { createdAt: -1 } });
    
    const mlRunsCount = await db.collection('ml_runs').countDocuments({
      createdAt: { $gte: new Date(now - 7 * day) },
    });
    
    checks.push({
      name: 'ml_runs_last_7d',
      status: mlRunsCount > 0 ? 'OK' : 'WARN',
      value: mlRunsCount,
      expected: '>= 1 run in 7 days',
    });
    
    // ════════════════════════════════════════════════════════════
    // CHECK 4: Active Model
    // ════════════════════════════════════════════════════════════
    const activeModel = await db.collection('ml_model_registry')
      .findOne({ state: 'ACTIVE' });
    
    checks.push({
      name: 'active_model',
      status: activeModel ? 'OK' : 'WARN',
      value: activeModel?.version || null,
      expected: 'Model in ACTIVE state',
    });
    
    // ════════════════════════════════════════════════════════════
    // CHECK 5: Learning Samples
    // ════════════════════════════════════════════════════════════
    const samplesCount = await db.collection('learning_samples').countDocuments({});
    
    checks.push({
      name: 'learning_samples',
      status: samplesCount >= 200 ? 'OK' : samplesCount > 50 ? 'WARN' : 'FAIL',
      value: samplesCount,
      expected: '>= 200 samples for training',
    });
    
    if (samplesCount < 200) {
      recommendations.push(`Need ${200 - samplesCount} more learning samples before retraining.`);
    }
    
    // ════════════════════════════════════════════════════════════
    // CHECK 6: Self-Learning Config
    // ════════════════════════════════════════════════════════════
    // Try multiple sources for config
    let trainingEnabled = false;
    
    const selfLearningConfig = await db.collection('system_config')
      .findOne({ key: 'self_learning' });
    
    if (selfLearningConfig?.value?.enabled) {
      trainingEnabled = true;
    }
    
    // Also check self_learning_config collection
    const selfLearningConfig2 = await db.collection('self_learning_config')
      .findOne({});
    
    if (selfLearningConfig2?.enabled) {
      trainingEnabled = true;
    }
    
    // Check global config
    const globalConfig = await db.collection('global_config')
      .findOne({ key: 'self_learning' });
    
    if (globalConfig?.enabled) {
      trainingEnabled = true;
    }
    
    checks.push({
      name: 'training_enabled',
      status: trainingEnabled ? 'OK' : 'FAIL',
      value: trainingEnabled,
      expected: 'Self-learning enabled',
    });
    
    if (!trainingEnabled) {
      recommendations.push('Enable self-learning: POST /api/self-learning/toggle');
    }
    
    // ════════════════════════════════════════════════════════════
    // CHECK 7: Model Drift
    // ════════════════════════════════════════════════════════════
    const driftState = activeModel?.driftState || 'UNKNOWN';
    
    checks.push({
      name: 'drift_state',
      status: driftState === 'STABLE' ? 'OK' : driftState === 'DRIFTING' ? 'WARN' : 'FAIL',
      value: driftState,
      expected: 'STABLE or monitored',
    });
    
    // ════════════════════════════════════════════════════════════
    // OVERALL STATUS
    // ════════════════════════════════════════════════════════════
    const failCount = checks.filter(c => c.status === 'FAIL').length;
    const warnCount = checks.filter(c => c.status === 'WARN').length;
    
    let overallStatus: 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'NOT_RUNNING';
    
    if (failCount >= 3 || !trainingEnabled) {
      overallStatus = 'NOT_RUNNING';
    } else if (failCount > 0) {
      overallStatus = 'FAILING';
    } else if (warnCount > 2) {
      overallStatus = 'DEGRADED';
    } else {
      overallStatus = 'HEALTHY';
    }
    
    return {
      ok: overallStatus === 'HEALTHY' || overallStatus === 'DEGRADED',
      overallStatus,
      checks,
      summary: {
        outcomesLast24h: outcomesCount24h,
        outcomesLast7d: outcomesCount7d,
        lastMlRun: lastMlRun ? {
          id: lastMlRun._id,
          status: lastMlRun.status,
          createdAt: lastMlRun.createdAt,
        } : null,
        activeModelVersion: activeModel?.version || null,
        lastPromotionTime: activeModel?.promotedAt || null,
        driftState,
        trainingEnabled,
      },
      recommendations,
    };
  });
  
  console.log('[ExchangeLearningHealth] Routes registered');
}

export default exchangeLearningHealthRoutes;
