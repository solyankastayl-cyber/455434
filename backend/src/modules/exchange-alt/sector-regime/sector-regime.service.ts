/**
 * BLOCK 25 — Sector/Regime Overlay Service
 * =========================================
 * 
 * Adjusts scores based on sector and regime context.
 */

import type { Venue } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  MarketRegime,
  Sector,
  RegimeSectorPerformance,
  SectorOverlay,
  RegimeOverlay,
  SROResponse,
} from './sector-regime.types.js';
import {
  SRO_CONFIG,
  calculateMultiplier,
  getRecommendation,
  isSectorHealthy,
} from './sector-regime.types.js';
import { patternMemoryService } from '../pattern-memory/pattern-memory.service.js';
import { getSector } from '../portfolio-filter/portfolio-filter.types.js';

// ═══════════════════════════════════════════════════════════════
// SECTOR/REGIME OVERLAY SERVICE
// ═══════════════════════════════════════════════════════════════

export class SectorRegimeOverlayService {
  private regimeStartTime: number = Date.now();
  private currentRegime: MarketRegime = 'RANGE';

  /**
   * Generate sector/regime overlay analysis
   */
  analyze(
    marketContext: MarketContext,
    venue: Venue = 'MOCK'
  ): SROResponse {
    // Update regime if changed
    const detectedRegime = this.detectRegime(marketContext);
    if (detectedRegime !== this.currentRegime) {
      this.currentRegime = detectedRegime;
      this.regimeStartTime = Date.now();
    }

    // Build performance matrix
    const performanceMatrix = this.buildPerformanceMatrix();

    // Build sector overlays
    const sectorOverlays = this.buildSectorOverlays(performanceMatrix);

    // Build regime overlay
    const regimeOverlay = this.buildRegimeOverlay(performanceMatrix);

    // Calculate active multipliers
    const activeMultipliers = this.calculateActiveMultipliers(performanceMatrix);

    return {
      ok: true,
      asOf: Date.now(),
      venue,
      currentRegime: this.currentRegime,
      regimeConfidence: this.calculateRegimeConfidence(marketContext),
      regimeOverlay,
      sectorOverlays,
      performanceMatrix,
      activeMultipliers,
    };
  }

  /**
   * Get score multiplier for a symbol
   */
  getMultiplier(symbol: string): number {
    const sector = getSector(symbol) as Sector;
    const record = this.findPerformance(this.currentRegime, sector);
    
    if (!record) return 1.0;
    
    return record.multiplier;
  }

  /**
   * Get recommendation for a symbol
   */
  getRecommendation(symbol: string): RegimeSectorPerformance['recommendation'] {
    const sector = getSector(symbol) as Sector;
    const record = this.findPerformance(this.currentRegime, sector);
    
    if (!record) return 'NORMAL';
    
    return record.recommendation;
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILDERS
  // ═══════════════════════════════════════════════════════════════

  private buildPerformanceMatrix(): RegimeSectorPerformance[] {
    const matrix: RegimeSectorPerformance[] = [];
    const regimes: MarketRegime[] = ['BULL', 'BEAR', 'RANGE', 'RISK_OFF'];
    const sectors: Sector[] = ['L1', 'L2', 'DEFI', 'AI', 'GAMING', 'MEME', 'OTHER'];

    // Get all pattern records
    const allRecords = patternMemoryService.getAllRecords();

    // Calculate average performance across all
    let totalHitRate = 0;
    let totalSamples = 0;
    for (const record of allRecords) {
      totalHitRate += record.hitRate * record.totalTrades;
      totalSamples += record.totalTrades;
    }
    const avgHitRate = totalSamples > 0 ? totalHitRate / totalSamples : 0.5;

    // Build matrix
    for (const regime of regimes) {
      for (const sector of sectors) {
        const perf = this.calculateRegimeSectorPerf(
          allRecords,
          regime,
          sector,
          avgHitRate
        );
        matrix.push(perf);
      }
    }

    return matrix;
  }

  private calculateRegimeSectorPerf(
    records: ReturnType<typeof patternMemoryService.getAllRecords>,
    regime: MarketRegime,
    sector: Sector,
    avgHitRate: number
  ): RegimeSectorPerformance {
    // Filter records that have data for this regime and sector
    let totalHits = 0;
    let totalTrades = 0;
    let totalReturn = 0;

    for (const record of records) {
      const regimeData = record.byRegime[regime];
      const sectorData = record.bySector[sector];
      
      if (regimeData && sectorData) {
        // Combine regime and sector performance
        const weight = Math.min(regimeData.samples, sectorData.samples);
        totalHits += ((regimeData.hitRate + sectorData.hitRate) / 2) * weight;
        totalTrades += weight;
        totalReturn += ((regimeData.avgReturn + sectorData.avgReturn) / 2) * weight;
      }
    }

    const hitRate = totalTrades > 0 ? totalHits / totalTrades : 0.5;
    const avgReturn = totalTrades > 0 ? totalReturn / totalTrades : 0;
    const samples = totalTrades;

    // Calculate expectancy
    const avgWin = avgReturn > 0 ? avgReturn * 1.5 : 5;
    const avgLoss = avgReturn < 0 ? Math.abs(avgReturn) * 1.5 : 3;
    const expectancy = hitRate * avgWin - (1 - hitRate) * avgLoss;

    // Comparison to average
    const vsAllRegimes = avgHitRate > 0 ? ((hitRate - avgHitRate) / avgHitRate) * 100 : 0;
    const vsAllSectors = vsAllRegimes; // Simplified

    // Multiplier and recommendation
    const multiplier = calculateMultiplier(hitRate, samples);
    const recommendation = getRecommendation(hitRate, samples);

    return {
      regime,
      sector,
      hitRate,
      avgReturn,
      samples,
      expectancy,
      vsAllRegimes,
      vsAllSectors,
      multiplier,
      recommendation,
    };
  }

  private buildSectorOverlays(
    matrix: RegimeSectorPerformance[]
  ): SectorOverlay[] {
    const sectors: Sector[] = ['L1', 'L2', 'DEFI', 'AI', 'GAMING', 'MEME', 'OTHER'];
    const overlays: SectorOverlay[] = [];

    for (const sector of sectors) {
      const sectorPerfs = matrix.filter(m => m.sector === sector);
      const currentRegimePerf = sectorPerfs.find(p => p.regime === this.currentRegime);

      // Find best and worst regimes
      const sorted = [...sectorPerfs].sort((a, b) => b.hitRate - a.hitRate);
      const bestRegime = sorted[0]?.regime ?? 'RANGE';
      const worstRegime = sorted[sorted.length - 1]?.regime ?? 'RISK_OFF';

      // Health check
      const isHealthy = currentRegimePerf 
        ? isSectorHealthy(currentRegimePerf.hitRate, currentRegimePerf.samples)
        : true;

      let healthReason = 'Healthy';
      if (!isHealthy) {
        healthReason = `Low hit rate (${((currentRegimePerf?.hitRate ?? 0) * 100).toFixed(0)}%) in current ${this.currentRegime} regime`;
      }

      // Count active patterns
      const records = patternMemoryService.query({ sector });
      const activePatterns = records.filter(r => 
        r.lastSeen > Date.now() - 7 * 24 * 60 * 60 * 1000
      ).length;

      // Top pattern
      const topRecord = records
        .filter(r => r.totalTrades >= 5)
        .sort((a, b) => b.hitRate - a.hitRate)[0];

      overlays.push({
        sector,
        currentRegimePerf: {
          hitRate: currentRegimePerf?.hitRate ?? 0.5,
          avgReturn: currentRegimePerf?.avgReturn ?? 0,
          samples: currentRegimePerf?.samples ?? 0,
        },
        bestRegime,
        worstRegime,
        isHealthy,
        healthReason,
        activePatterns,
        topPattern: topRecord?.patternId ?? null,
      });
    }

    return overlays;
  }

  private buildRegimeOverlay(
    matrix: RegimeSectorPerformance[]
  ): RegimeOverlay {
    const currentPerfs = matrix.filter(m => m.regime === this.currentRegime);

    // Rank sectors by performance
    const sectorRankings = currentPerfs
      .sort((a, b) => b.hitRate - a.hitRate)
      .map((p, i) => ({
        sector: p.sector,
        hitRate: p.hitRate,
        avgReturn: p.avgReturn,
        rank: i + 1,
      }));

    // Top patterns in current regime
    const records = patternMemoryService.query({
      regime: this.currentRegime,
      minTrades: 5,
    });
    const topPatterns = records
      .sort((a, b) => b.hitRate - a.hitRate)
      .slice(0, 5)
      .map(r => ({
        patternId: r.patternId,
        label: r.patternLabel,
        hitRate: r.hitRate,
      }));

    // Preferred and avoid sectors
    const preferredSectors = currentPerfs
      .filter(p => p.recommendation === 'PREFER')
      .map(p => p.sector);

    const avoidSectors = currentPerfs
      .filter(p => p.recommendation === 'AVOID')
      .map(p => p.sector);

    return {
      currentRegime: this.currentRegime,
      regimeConfidence: 0.7, // Would be calculated from market data
      regimeDuration: (Date.now() - this.regimeStartTime) / (60 * 60 * 1000),
      sectorRankings,
      topPatterns,
      preferredSectors,
      avoidSectors,
    };
  }

  private calculateActiveMultipliers(
    matrix: RegimeSectorPerformance[]
  ): SROResponse['activeMultipliers'] {
    const multipliers: SROResponse['activeMultipliers'] = [];

    // Current regime multipliers
    const currentPerfs = matrix.filter(m => m.regime === this.currentRegime);
    
    for (const perf of currentPerfs) {
      if (perf.multiplier !== 1.0) {
        multipliers.push({
          condition: `${perf.sector} in ${this.currentRegime}`,
          multiplier: perf.multiplier,
          reason: `${perf.recommendation}: ${(perf.hitRate * 100).toFixed(0)}% hit rate (${perf.samples} samples)`,
        });
      }
    }

    // Global regime adjustment
    if (this.currentRegime === 'RISK_OFF') {
      multipliers.push({
        condition: 'RISK_OFF regime',
        multiplier: 0.5,
        reason: 'High risk environment - reducing all positions',
      });
    }

    return multipliers.sort((a, b) => a.multiplier - b.multiplier);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private detectRegime(context: MarketContext): MarketRegime {
    return context.marketRegime as MarketRegime;
  }

  private calculateRegimeConfidence(context: MarketContext): number {
    // Would use more sophisticated calculation
    // For now, based on volatility and trend strength
    const vol = context.btcVolatility;
    
    if (vol > 0.8) return 0.5; // High volatility = uncertain regime
    if (vol < 0.3) return 0.85; // Low volatility = confident regime
    return 0.7;
  }

  private findPerformance(
    regime: MarketRegime,
    sector: Sector
  ): RegimeSectorPerformance | null {
    const matrix = this.buildPerformanceMatrix();
    return matrix.find(m => m.regime === regime && m.sector === sector) ?? null;
  }

  /**
   * Get current regime
   */
  getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }

  /**
   * Set regime manually (for testing)
   */
  setRegime(regime: MarketRegime): void {
    this.currentRegime = regime;
    this.regimeStartTime = Date.now();
  }
}

export const sectorRegimeOverlayService = new SectorRegimeOverlayService();

console.log('[Block25] Sector/Regime Overlay Service loaded');
