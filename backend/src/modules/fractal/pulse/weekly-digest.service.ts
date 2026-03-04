/**
 * BLOCK 76.2 — Weekly Telegram Digest Service
 * 
 * Sends institutional weekly intelligence report.
 * Not counted against daily 3/24h limit.
 * BTC-only.
 */

import { attributionAggregatorService } from '../memory/attribution/attribution-aggregator.service.js';
import { consensusPulseService } from './consensus-pulse.service.js';
import { tgSendMessage, getTelegramConfig } from '../ops/telegram.notifier.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface WeeklyDigestPayload {
  period: { from: string; to: string };
  consensus: {
    current: number;
    delta7d: number;
    dominance: string;
    structuralLock: boolean;
    syncState: string;
  };
  divergence: {
    grade: string;
    score: number;
    trend: string;
  };
  attribution: {
    tierBest: { tier: string; hitRate: number };
    tierWorst: { tier: string; hitRate: number };
    regimeBest: { regime: string; hitRate: number };
    sampleCount: number;
  };
  insights: string[];
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class WeeklyDigestService {
  
  /**
   * Build weekly digest payload
   */
  async buildDigest(symbol: string = 'BTC'): Promise<WeeklyDigestPayload> {
    // Get date range (last 7 days)
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    
    // Get consensus pulse
    const pulse = await consensusPulseService.getConsensusPulse(symbol, 7);
    
    // Get attribution data
    const attribution = await attributionAggregatorService.getAttributionData(
      symbol, '90d', 'balanced', 'ACTIVE'
    );
    
    // Find best/worst tiers
    const sortedTiers = [...attribution.tiers].sort((a, b) => b.hitRate - a.hitRate);
    const tierBest = sortedTiers[0] || { tier: 'N/A', hitRate: 0 };
    const tierWorst = sortedTiers[sortedTiers.length - 1] || { tier: 'N/A', hitRate: 0 };
    
    // Find best regime
    const sortedRegimes = [...attribution.regimes].sort((a, b) => b.hitRate - a.hitRate);
    const regimeBest = sortedRegimes[0] || { regime: 'N/A', hitRate: 0 };
    
    // Determine divergence trend
    let divergenceTrend = 'stable';
    if (pulse.series.length >= 2) {
      const first = pulse.series[0].divergenceScore;
      const last = pulse.series[pulse.series.length - 1].divergenceScore;
      if (last > first + 5) divergenceTrend = 'improving';
      else if (last < first - 5) divergenceTrend = 'worsening';
    }
    
    // Get last point for current state
    const lastPoint = pulse.series[pulse.series.length - 1];
    
    // Build insights
    const insights: string[] = [];
    
    if (pulse.summary.lockDays >= 3) {
      insights.push(`Structure dominated ${pulse.summary.lockDays} of 7 days`);
    }
    
    if (tierBest.hitRate > tierWorst.hitRate + 0.1) {
      insights.push(`${tierBest.tier} outperforms ${tierWorst.tier} by ${((tierBest.hitRate - tierWorst.hitRate) * 100).toFixed(0)}%`);
    }
    
    if (divergenceTrend === 'improving') {
      insights.push('Divergence improving (better model fit)');
    } else if (divergenceTrend === 'worsening') {
      insights.push('Divergence worsening (review required)');
    }
    
    if (attribution.insights.length > 0) {
      insights.push(...attribution.insights.slice(0, 2).map(i => i.message));
    }
    
    return {
      period: { from: fromStr, to: toStr },
      consensus: {
        current: pulse.summary.current,
        delta7d: pulse.summary.delta7d,
        dominance: lastPoint?.dominance || 'TACTICAL',
        structuralLock: lastPoint?.structuralLock || false,
        syncState: pulse.summary.syncState
      },
      divergence: {
        grade: lastPoint?.divergenceGrade || 'C',
        score: lastPoint?.divergenceScore || 50,
        trend: divergenceTrend
      },
      attribution: {
        tierBest: { tier: tierBest.tier, hitRate: tierBest.hitRate },
        tierWorst: { tier: tierWorst.tier, hitRate: tierWorst.hitRate },
        regimeBest: { regime: regimeBest.regime, hitRate: regimeBest.hitRate },
        sampleCount: attribution.meta.sampleCount
      },
      insights
    };
  }
  
  /**
   * Format digest as Telegram message
   */
  formatTelegramMessage(digest: WeeklyDigestPayload): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`📊 <b>BTC Weekly Intelligence Digest</b>`);
    lines.push(`Period: ${digest.period.from} → ${digest.period.to}`);
    lines.push('');
    
    // Consensus section
    lines.push(`<b>Consensus</b>`);
    const delta = digest.consensus.delta7d;
    const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
    lines.push(`Current: <b>${digest.consensus.current}</b> (${deltaStr} 7d)`);
    lines.push(`Dominance: ${digest.consensus.dominance}${digest.consensus.structuralLock ? ' 🔒' : ''}`);
    lines.push(`Sync: ${digest.consensus.syncState}`);
    lines.push('');
    
    // Divergence section
    lines.push(`<b>Divergence</b>`);
    lines.push(`Grade: ${digest.divergence.grade} (${digest.divergence.score})`);
    lines.push(`Trend: ${digest.divergence.trend}`);
    lines.push('');
    
    // Attribution section
    if (digest.attribution.sampleCount > 0) {
      lines.push(`<b>Attribution (${digest.attribution.sampleCount} samples)</b>`);
      lines.push(`Best Tier: ${digest.attribution.tierBest.tier} ${(digest.attribution.tierBest.hitRate * 100).toFixed(0)}%`);
      lines.push(`Worst Tier: ${digest.attribution.tierWorst.tier} ${(digest.attribution.tierWorst.hitRate * 100).toFixed(0)}%`);
      lines.push(`Best Regime: ${digest.attribution.regimeBest.regime} ${(digest.attribution.regimeBest.hitRate * 100).toFixed(0)}%`);
      lines.push('');
    }
    
    // Insights section
    if (digest.insights.length > 0) {
      lines.push(`<b>Insights</b>`);
      for (const insight of digest.insights.slice(0, 4)) {
        lines.push(`• ${insight}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Send weekly digest (main entry point)
   */
  async sendWeeklyDigest(symbol: string = 'BTC'): Promise<{ success: boolean; message: string }> {
    try {
      const digest = await this.buildDigest(symbol);
      const message = this.formatTelegramMessage(digest);
      
      // Get Telegram config
      const tgConfig = getTelegramConfig();
      
      if (!tgConfig.enabled) {
        console.log('[WeeklyDigest] Telegram not enabled or configured');
        return { success: false, message: 'Telegram not configured (set FRACTAL_ALERTS_ENABLED=true and TG_BOT_TOKEN/TG_ADMIN_CHAT_ID)' };
      }
      
      // Send to Telegram (bypasses daily limit as it's weekly)
      const result = await tgSendMessage(console, {
        token: tgConfig.token,
        chatId: tgConfig.chatId,
        text: message,
        parseMode: 'HTML'
      });
      
      if (result.ok) {
        console.log('[WeeklyDigest] Sent successfully');
        return { success: true, message: 'Weekly digest sent' };
      } else {
        console.log('[WeeklyDigest] Failed to send:', result.error);
        return { success: false, message: result.error || 'Telegram send failed' };
      }
    } catch (err: any) {
      console.error('[WeeklyDigest] Error:', err);
      return { success: false, message: err.message };
    }
  }
}

export const weeklyDigestService = new WeeklyDigestService();
