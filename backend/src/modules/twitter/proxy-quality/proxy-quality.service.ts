// P1: Proxy Quality Service
// Monitors and scores proxy health

import { ProxySlotModel, IProxySlot } from '../slots/proxy-slot.model.js';
import { ProxyQualityMetrics, DEFAULT_PROXY_QUALITY_CONFIG } from './proxy-quality.types.js';

// Store historical metrics in memory (in production: use MongoDB)
const metricsStore = new Map<string, {
  requests: Array<{ timestamp: number; success: boolean; latency: number; error?: string }>;
}>();

export class ProxyQualityService {
  private config = DEFAULT_PROXY_QUALITY_CONFIG;

  /**
   * Record a request result for proxy quality tracking
   */
  async recordRequest(
    slotId: string,
    result: {
      success: boolean;
      latency: number;
      error?: string;
      isTimeout?: boolean;
      isRateLimit?: boolean;
    }
  ): Promise<void> {
    // Get or create metrics for this slot
    let slotMetrics = metricsStore.get(slotId);
    if (!slotMetrics) {
      slotMetrics = { requests: [] };
      metricsStore.set(slotId, slotMetrics);
    }

    // Add new request
    slotMetrics.requests.push({
      timestamp: Date.now(),
      success: result.success,
      latency: result.latency,
      error: result.error,
    });

    // Cleanup old entries (keep last 24h)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    slotMetrics.requests = slotMetrics.requests.filter(r => r.timestamp > cutoff);

    // Update MongoDB with aggregated stats
    await this.updateSlotStats(slotId);
  }

  /**
   * Calculate quality score for a proxy
   * Returns 0-100 (100 = excellent quality)
   */
  calculateScore(metrics: ProxyQualityMetrics): number {
    let score = 100;

    // Penalty for low success rate
    const successPenalty = (1 - metrics.successRate24h) * 100;
    score -= successPenalty * this.config.successWeight;

    // Penalty for timeouts
    const timeoutPenalty = metrics.timeoutRate24h * 100;
    score -= timeoutPenalty * this.config.timeoutWeight;

    // Penalty for rate limits
    const rateLimitPenalty = metrics.rateLimitRate24h * 100;
    score -= rateLimitPenalty * this.config.rateLimitWeight;

    // Penalty for high latency
    const latencyPenalty = metrics.latencyP95 > this.config.latencyThresholdMs
      ? Math.min(30, (metrics.latencyP95 - this.config.latencyThresholdMs) / 100)
      : 0;
    score -= latencyPenalty * this.config.latencyWeight;

    return Math.max(0, Math.round(score));
  }

  /**
   * Get quality metrics for a specific proxy
   */
  async getMetrics(slotId: string): Promise<ProxyQualityMetrics | null> {
    const slot = await ProxySlotModel.findById(slotId).lean();
    if (!slot) return null;

    const stored = metricsStore.get(slotId);
    const requests = stored?.requests || [];

    if (requests.length === 0) {
      return {
        slotId,
        successRate24h: 1,
        timeoutRate24h: 0,
        rateLimitRate24h: 0,
        latencyP50: 0,
        latencyP95: 0,
        totalRequests24h: 0,
        score: 100,
      };
    }

    // Calculate rates
    const successCount = requests.filter(r => r.success).length;
    const timeoutCount = requests.filter(r => r.error?.includes('timeout')).length;
    const rateLimitCount = requests.filter(r => r.error?.includes('rate') || r.error?.includes('429')).length;

    // Calculate latencies
    const latencies = requests.map(r => r.latency).sort((a, b) => a - b);
    const p50Index = Math.floor(latencies.length * 0.5);
    const p95Index = Math.floor(latencies.length * 0.95);

    const metrics: ProxyQualityMetrics = {
      slotId,
      successRate24h: successCount / requests.length,
      timeoutRate24h: timeoutCount / requests.length,
      rateLimitRate24h: rateLimitCount / requests.length,
      latencyP50: latencies[p50Index] || 0,
      latencyP95: latencies[p95Index] || latencies[latencies.length - 1] || 0,
      totalRequests24h: requests.length,
      score: 0,
    };

    metrics.score = this.calculateScore(metrics);
    return metrics;
  }

  /**
   * Get quality metrics for all proxies
   */
  async getAllMetrics(): Promise<ProxyQualityMetrics[]> {
    const slots = await ProxySlotModel.find().lean();
    const results: ProxyQualityMetrics[] = [];

    for (const slot of slots) {
      const metrics = await this.getMetrics(slot._id.toString());
      if (metrics) {
        results.push(metrics);
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get proxy quality report
   */
  async getReport(): Promise<{
    total: number;
    healthy: number;
    degraded: number;
    critical: number;
    avgScore: number;
    proxies: ProxyQualityMetrics[];
  }> {
    const metrics = await this.getAllMetrics();
    
    let healthy = 0;
    let degraded = 0;
    let critical = 0;
    let totalScore = 0;

    for (const m of metrics) {
      totalScore += m.score;
      if (m.score >= 80) healthy++;
      else if (m.score >= 50) degraded++;
      else critical++;
    }

    return {
      total: metrics.length,
      healthy,
      degraded,
      critical,
      avgScore: metrics.length > 0 ? Math.round(totalScore / metrics.length) : 100,
      proxies: metrics,
    };
  }

  /**
   * Update MongoDB slot with aggregated quality stats
   */
  private async updateSlotStats(slotId: string): Promise<void> {
    const metrics = await this.getMetrics(slotId);
    if (!metrics) return;

    // Store quality score in notes or a separate field
    // For now, just log
    console.log(`[ProxyQuality] ${slotId}: score=${metrics.score}, success=${(metrics.successRate24h * 100).toFixed(1)}%`);
  }
}

export const proxyQualityService = new ProxyQualityService();
