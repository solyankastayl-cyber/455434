/**
 * BLOCK 29.18: Risk State Service
 * Manages equity/drawdown state for live risk management
 */

import { FractalRiskStateModel } from '../data/schemas/fractal-risk-state.schema.js';

export class FractalRiskStateService {
  /**
   * Apply realized trade return to equity state
   */
  async applyRealized(symbol: string, ts: Date, tradeReturn: number): Promise<{
    equity: number;
    peakEquity: number;
    ddAbs: number;
  }> {
    const state = await FractalRiskStateModel.findOne({ symbol }).lean();
    
    const prevEquity = state?.equity ?? 1;
    const equity = prevEquity * (1 + tradeReturn);
    const peakEquity = Math.max(state?.peakEquity ?? 1, equity);
    const ddAbs = peakEquity > 0 ? (1 - equity / peakEquity) : 0;

    await FractalRiskStateModel.updateOne(
      { symbol },
      {
        $set: {
          equity,
          peakEquity,
          lastTs: ts,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return { equity, peakEquity, ddAbs };
  }

  /**
   * Get current drawdown state
   */
  async getDD(symbol: string): Promise<{
    equity: number;
    peakEquity: number;
    ddAbs: number;
    inCoolDown: boolean;
  }> {
    const state = await FractalRiskStateModel.findOne({ symbol }).lean();
    
    const equity = state?.equity ?? 1;
    const peakEquity = state?.peakEquity ?? 1;
    const ddAbs = peakEquity > 0 ? (1 - equity / peakEquity) : 0;
    
    const inCoolDown = state?.inCoolDown ?? false;

    return { equity, peakEquity, ddAbs, inCoolDown };
  }

  /**
   * Reset equity state (e.g., after manual intervention)
   */
  async reset(symbol: string): Promise<{ ok: boolean }> {
    await FractalRiskStateModel.updateOne(
      { symbol },
      {
        $set: {
          equity: 1,
          peakEquity: 1,
          inCoolDown: false,
          coolDownUntil: null,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    return { ok: true };
  }

  /**
   * Enter cool down period
   */
  async enterCoolDown(symbol: string, daysUntil: number): Promise<void> {
    const until = new Date();
    until.setDate(until.getDate() + daysUntil);

    await FractalRiskStateModel.updateOne(
      { symbol },
      {
        $set: {
          inCoolDown: true,
          coolDownUntil: until,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  /**
   * Check and exit cool down if expired
   */
  async checkCoolDown(symbol: string): Promise<boolean> {
    const state = await FractalRiskStateModel.findOne({ symbol }).lean();
    
    if (!state?.inCoolDown) return false;
    
    if (state.coolDownUntil && new Date() >= state.coolDownUntil) {
      await FractalRiskStateModel.updateOne(
        { symbol },
        {
          $set: {
            inCoolDown: false,
            coolDownUntil: null,
            updatedAt: new Date()
          }
        }
      );
      return false;
    }
    
    return true;
  }
}
