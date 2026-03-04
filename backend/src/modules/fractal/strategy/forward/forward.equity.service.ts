/**
 * BLOCK 56.4 — Forward Equity Service
 * 
 * Builds equity curve from resolved signal snapshots.
 * This is FORWARD-TRUTH performance, not simulation.
 * 
 * Key principles:
 * - Uses only resolved outcomes (no lookahead)
 * - Ledger-based approach (like funds)
 * - Separate metrics per preset/horizon/role
 */

import { SignalSnapshotModel, type SignalSnapshotDocument } from '../../storage/signal-snapshot.schema.js';
import { 
  calcCAGR, 
  calcMaxDD, 
  calcProfitFactor, 
  calcSharpe, 
  mean, 
  stdev,
  daysBetween 
} from './forward.metrics.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Role = 'ACTIVE' | 'SHADOW';
export type Preset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type HorizonDays = 7 | 14 | 30;
export type Action = 'LONG' | 'SHORT' | 'HOLD';

export interface ForwardEquityQuery {
  symbol: string;
  role: Role;
  preset: Preset;
  horizon: HorizonDays;
  from?: string;
  to?: string;
}

export interface LedgerEvent {
  asofDate: string;
  action: string;
  exposure: number;
  realizedReturn: number;
  pnl: number;
  equityAfter: number;
}

export interface ForwardEquityMetrics {
  cagr: number;
  sharpe: number;
  maxDD: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  volatility: number;
  trades: number;
}

export interface ForwardEquityResponse {
  meta: {
    symbol: string;
    role: Role;
    preset: Preset;
    horizon: HorizonDays;
    from: string | null;
    to: string | null;
  };
  summary: {
    snapshots: number;
    resolved: number;
    unresolved: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  equity: Array<{ t: string; value: number }>;
  drawdown: Array<{ t: string; value: number }>;
  returns: number[];
  ledger: LedgerEvent[];
  metrics: ForwardEquityMetrics;
}

export interface GridPresetMetrics {
  cagr: number;
  sharpe: number;
  maxDD: number;
  resolved: number;
}

export interface ForwardEquityGridResponse {
  symbol: string;
  roles: {
    ACTIVE: Record<string, Record<string, GridPresetMetrics>>;
    SHADOW: Record<string, Record<string, GridPresetMetrics>>;
  };
  bestBySharpe: {
    role: Role;
    preset: Preset;
    horizon: HorizonDays;
    sharpe: number;
  } | null;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class ForwardEquityService {
  
  /**
   * Get realized return from snapshot for given horizon
   */
  private getRealizedReturn(snapshot: SignalSnapshotDocument, horizon: HorizonDays): number | null {
    const outcomes = (snapshot as any).outcomes;
    if (!outcomes) return null;
    
    const horizonKey = `${horizon}d`;
    const outcome = outcomes[horizonKey];
    
    if (!outcome || outcome.realizedReturn === undefined) return null;
    
    return outcome.realizedReturn;
  }
  
  /**
   * Calculate PnL based on action and realized return
   */
  private calcPnl(action: string, exposure: number, realizedReturn: number): number {
    const exp = Math.max(0, Math.min(1, exposure || 0));
    
    if (action === 'LONG') return exp * realizedReturn;
    if (action === 'SHORT') return exp * (-realizedReturn);
    return 0; // HOLD / NO_TRADE
  }
  
  /**
   * Build forward equity curve from resolved snapshots
   */
  async build(q: ForwardEquityQuery): Promise<ForwardEquityResponse> {
    // Build filter
    const filter: any = {
      symbol: q.symbol,
      modelType: q.role,
      'strategy.preset': q.preset
    };
    
    if (q.from || q.to) {
      filter.asOf = {};
      if (q.from) filter.asOf.$gte = new Date(q.from);
      if (q.to) filter.asOf.$lte = new Date(q.to);
    }
    
    // Fetch snapshots
    const snapshots = await SignalSnapshotModel
      .find(filter)
      .sort({ asOf: 1 })
      .lean() as SignalSnapshotDocument[];
    
    // Build ledger
    const ledger: LedgerEvent[] = [];
    const equity: Array<{ t: string; value: number }> = [];
    const drawdown: Array<{ t: string; value: number }> = [];
    const returnsSeries: number[] = [];
    
    let eq = 1.0;
    let peak = 1.0;
    let resolvedCount = 0;
    
    for (const s of snapshots) {
      const rr = this.getRealizedReturn(s, q.horizon);
      if (rr === null) continue; // Only count resolved
      
      resolvedCount++;
      
      const exposure = s.strategy?.positionSize ?? 0;
      const pnl = this.calcPnl(s.action, exposure, rr);
      eq = eq * (1 + pnl);
      
      // Track peak for drawdown
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      
      const asofDate = s.asOf.toISOString().slice(0, 10);
      
      ledger.push({
        asofDate,
        action: s.action,
        exposure,
        realizedReturn: rr,
        pnl,
        equityAfter: eq
      });
      
      equity.push({ t: asofDate, value: eq });
      drawdown.push({ t: asofDate, value: 1 - dd }); // For chart (inverted)
      returnsSeries.push(pnl);
    }
    
    const unresolved = Math.max(0, snapshots.length - resolvedCount);
    
    // Calculate metrics
    const firstDate = ledger[0]?.asofDate ?? null;
    const lastDate = ledger[ledger.length - 1]?.asofDate ?? null;
    const daysElapsed = firstDate && lastDate ? daysBetween(firstDate, lastDate) : 0;
    
    // Annual factor based on actual decision frequency
    let avgStep = q.horizon;
    if (ledger.length >= 2) {
      const steps: number[] = [];
      for (let i = 1; i < ledger.length; i++) {
        steps.push(daysBetween(ledger[i - 1].asofDate, ledger[i].asofDate));
      }
      avgStep = Math.max(1, mean(steps));
    }
    const annualFactor = 365 / avgStep;
    
    const maxDD = calcMaxDD(equity);
    const cagr = calcCAGR(1.0, eq, daysElapsed);
    const sharpe = calcSharpe(returnsSeries, annualFactor);
    const winRate = returnsSeries.length > 0 
      ? returnsSeries.filter(x => x > 0).length / returnsSeries.length 
      : 0;
    const expectancy = mean(returnsSeries);
    const profitFactor = calcProfitFactor(returnsSeries);
    const volatility = stdev(returnsSeries) * Math.sqrt(annualFactor);
    
    return {
      meta: {
        symbol: q.symbol,
        role: q.role,
        preset: q.preset,
        horizon: q.horizon,
        from: q.from ?? null,
        to: q.to ?? null
      },
      summary: {
        snapshots: snapshots.length,
        resolved: resolvedCount,
        unresolved,
        firstDate,
        lastDate
      },
      equity,
      drawdown,
      returns: returnsSeries,
      ledger,
      metrics: {
        cagr,
        sharpe,
        maxDD,
        winRate,
        expectancy,
        profitFactor,
        volatility,
        trades: resolvedCount
      }
    };
  }
  
  /**
   * Build grid of all presets/horizons/roles
   */
  async grid(symbol: string): Promise<ForwardEquityGridResponse> {
    const roles: Role[] = ['ACTIVE', 'SHADOW'];
    const presets: Preset[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
    const horizons: HorizonDays[] = [7, 14, 30];
    
    const out: ForwardEquityGridResponse = {
      symbol,
      roles: {
        ACTIVE: {},
        SHADOW: {}
      },
      bestBySharpe: null
    };
    
    let best: ForwardEquityGridResponse['bestBySharpe'] = null;
    
    for (const role of roles) {
      for (const horizon of horizons) {
        const horizonKey = String(horizon);
        if (!out.roles[role][horizonKey]) {
          out.roles[role][horizonKey] = {};
        }
        
        for (const preset of presets) {
          try {
            const res = await this.build({ symbol, role, preset, horizon });
            
            out.roles[role][horizonKey][preset] = {
              cagr: Number(res.metrics.cagr.toFixed(4)),
              sharpe: Number(res.metrics.sharpe.toFixed(3)),
              maxDD: Number(res.metrics.maxDD.toFixed(4)),
              resolved: res.summary.resolved
            };
            
            // Track best Sharpe
            if (!best || res.metrics.sharpe > best.sharpe) {
              best = {
                role,
                preset,
                horizon,
                sharpe: Number(res.metrics.sharpe.toFixed(3))
              };
            }
          } catch (err) {
            console.error(`[ForwardEquity] Grid error for ${role}/${preset}/${horizon}:`, err);
            out.roles[role][horizonKey][preset] = {
              cagr: 0,
              sharpe: 0,
              maxDD: 0,
              resolved: 0
            };
          }
        }
      }
    }
    
    out.bestBySharpe = best;
    return out;
  }
}

// Export singleton
export const forwardEquityService = new ForwardEquityService();
