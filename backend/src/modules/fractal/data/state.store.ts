/**
 * Fractal State Store
 * Tracks bootstrap status, last update, gaps, etc.
 */

import { FractalStateModel } from './schemas/fractal-state.schema.js';
import { FractalState } from '../contracts/fractal.contracts.js';
import { FRACTAL_SYMBOL, FRACTAL_TIMEFRAME, SOURCE_PRIORITY } from '../domain/constants.js';

export class StateStore {
  /**
   * Get state by key (symbol:timeframe)
   */
  async get(key: string): Promise<FractalState | null> {
    return FractalStateModel.findById(key).lean();
  }

  /**
   * Get default state for BTC:1d
   */
  async getDefault(): Promise<FractalState | null> {
    return this.get(`${FRACTAL_SYMBOL}:${FRACTAL_TIMEFRAME}`);
  }

  /**
   * Upsert state
   */
  async upsert(state: Partial<FractalState> & { _id: string }): Promise<void> {
    await FractalStateModel.updateOne(
      { _id: state._id },
      { $set: state },
      { upsert: true }
    );
  }

  /**
   * Initialize default state if not exists
   */
  async ensureInitialized(): Promise<FractalState> {
    const key = `${FRACTAL_SYMBOL}:${FRACTAL_TIMEFRAME}`;
    let state = await this.get(key);

    if (!state) {
      state = {
        _id: key,
        symbol: FRACTAL_SYMBOL,
        timeframe: FRACTAL_TIMEFRAME,
        bootstrap: {
          done: false
        },
        gaps: {
          count: 0
        },
        sources: {
          primary: SOURCE_PRIORITY[0],
          fallback: SOURCE_PRIORITY.slice(1)
        }
      };
      await this.upsert(state);
    }

    return state;
  }

  /**
   * Update bootstrap status
   */
  async setBootstrapStarted(key: string): Promise<void> {
    await FractalStateModel.updateOne(
      { _id: key },
      {
        $set: {
          'bootstrap.startedAt': new Date(),
          'bootstrap.done': false
        }
      }
    );
  }

  /**
   * Mark bootstrap as complete
   */
  async setBootstrapComplete(
    key: string,
    lastCanonicalTs: Date
  ): Promise<void> {
    await FractalStateModel.updateOne(
      { _id: key },
      {
        $set: {
          'bootstrap.done': true,
          'bootstrap.finishedAt': new Date(),
          lastCanonicalTs,
          lastUpdateAt: new Date()
        }
      }
    );
  }

  /**
   * Update last canonical timestamp
   */
  async updateLastTs(key: string, lastCanonicalTs: Date): Promise<void> {
    await FractalStateModel.updateOne(
      { _id: key },
      {
        $set: {
          lastCanonicalTs,
          lastUpdateAt: new Date()
        }
      }
    );
  }

  /**
   * Update gaps count
   */
  async updateGaps(key: string, count: number): Promise<void> {
    await FractalStateModel.updateOne(
      { _id: key },
      {
        $set: {
          'gaps.count': count,
          'gaps.lastScanAt': new Date()
        }
      }
    );
  }
}
