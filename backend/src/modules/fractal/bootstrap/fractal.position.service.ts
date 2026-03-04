/**
 * BLOCK 29.20: Position Lifecycle Service
 * State machine: FLAT -> LONG/SHORT -> FLAT (with flips, cooldown, hold rules)
 */

import { FractalPositionStateModel } from '../data/schemas/fractal-position-state.schema.js';

const DAY = 86400000;

type Side = 'FLAT' | 'LONG' | 'SHORT';

export interface PositionRules {
  enterThreshold?: number;
  exitThreshold?: number;
  minHoldDays?: number;
  maxHoldDays?: number;
  coolDownDays?: number;
  flipAllowed?: boolean;
  flipThreshold?: number;
}

export interface ApplySignalParams {
  symbol: string;
  ts: Date;
  price: number;
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  exposure: number;
  rules: PositionRules;
  roundTripCost: number;
  entrySnapshot?: {
    features: Record<string, number>;
    confidence: number;
    signal: string;
    modelVersion: string;
    regime: { trend: string; volatility: string };
    ddAbs: number;
    datasetHashAtTrain?: string;
  };
}

export interface PositionAction {
  action: 'ENTER' | 'EXIT' | 'FLIP' | 'RESIZE' | 'HOLD' | 'HOLD_FLAT' | 'FORCE_EXIT_MAXHOLD';
  side: Side;
  size: number;
}

export class FractalPositionService {
  async get(symbol: string) {
    const st = await FractalPositionStateModel.findOne({ symbol }).lean();
    return st ?? { symbol, side: 'FLAT', size: 0 };
  }

  async applySignal(params: ApplySignalParams): Promise<PositionAction> {
    const { symbol, ts, price, signal, confidence, exposure, rules, roundTripCost, entrySnapshot } = params;

    const st = await this.get(symbol);

    const now = ts.getTime();
    const cdUntil = (st as any).coolDownUntil ? new Date((st as any).coolDownUntil).getTime() : 0;
    const inCooldown = now < cdUntil;

    const side: Side = ((st as any).side ?? 'FLAT') as Side;
    const size = Number((st as any).size ?? 0);

    const entryTs = (st as any).entryTs ? new Date((st as any).entryTs).getTime() : 0;
    const holdDays = entryTs ? Math.floor((now - entryTs) / DAY) : 0;

    const enterThr = Number(rules?.enterThreshold ?? 0.20);
    const exitThr = Number(rules?.exitThreshold ?? 0.10);
    const minHold = Number(rules?.minHoldDays ?? 10);
    const maxHold = Number(rules?.maxHoldDays ?? 45);
    const flipAllowed = !!(rules?.flipAllowed ?? true);
    const flipThr = Number(rules?.flipThreshold ?? 0.35);
    const cdDays = Number(rules?.coolDownDays ?? 5);

    // Helper: desired side from signal
    const desired: Side =
      signal === 'LONG' ? 'LONG' :
      signal === 'SHORT' ? 'SHORT' : 'FLAT';

    // 1) If FLAT: can enter?
    if (side === 'FLAT') {
      if (!inCooldown && desired !== 'FLAT' && confidence >= enterThr && exposure > 0) {
        await FractalPositionStateModel.updateOne(
          { symbol },
          {
            $set: {
              symbol,
              side: desired,
              size: exposure,
              entryTs: ts,
              entryPrice: price,
              lastSignalTs: ts,
              updatedAt: new Date(),
              // BLOCK 29.21: pending settle
              pending: {
                horizonDays: 30,
                openTs: ts,
                openPrice: price,
                side: desired,
                size: exposure,
                ...(entrySnapshot ?? {})
              }
            }
          },
          { upsert: true }
        );
        return { action: 'ENTER', side: desired, size: exposure };
      }
      return { action: 'HOLD_FLAT', side: 'FLAT', size: 0 };
    }

    // 2) Force exit by maxHold
    if (maxHold > 0 && holdDays >= maxHold) {
      await this.exit(symbol, ts, cdDays);
      return { action: 'FORCE_EXIT_MAXHOLD', side: 'FLAT', size: 0 };
    }

    // 3) Normal exit gate (after minHold)
    if (holdDays >= minHold) {
      if (desired === 'FLAT' || confidence < exitThr) {
        await this.exit(symbol, ts, cdDays);
        return { action: 'EXIT', side: 'FLAT', size: 0 };
      }
    }

    // 4) Flip logic (LONG->SHORT / SHORT->LONG)
    if (flipAllowed && desired !== 'FLAT' && desired !== side) {
      const flipCostPenalty = 2 * roundTripCost; // exit + enter
      const effective = confidence - flipCostPenalty;

      if (!inCooldown && effective >= flipThr) {
        await this.flip(symbol, desired, exposure, ts, price, cdDays, entrySnapshot);
        return { action: 'FLIP', side: desired, size: exposure };
      }
    }

    // 5) Resize in same direction
    if (desired === side) {
      const newSize = exposure;
      if (Math.abs(newSize - size) >= 0.15) {
        await FractalPositionStateModel.updateOne(
          { symbol },
          { $set: { size: newSize, lastSignalTs: ts, updatedAt: new Date() } }
        );
        return { action: 'RESIZE', side, size: newSize };
      }
    }

    return { action: 'HOLD', side, size };
  }

  private async exit(symbol: string, ts: Date, cdDays: number) {
    const coolDownUntil = new Date(ts.getTime() + cdDays * DAY);
    await FractalPositionStateModel.updateOne(
      { symbol },
      {
        $set: {
          side: 'FLAT',
          size: 0,
          coolDownUntil,
          lastSignalTs: ts,
          updatedAt: new Date()
        },
        $unset: {
          entryTs: '',
          entryPrice: '',
          pending: ''
        }
      },
      { upsert: true }
    );
  }

  private async flip(
    symbol: string,
    newSide: Side,
    newSize: number,
    ts: Date,
    price: number,
    cdDays: number,
    entrySnapshot?: ApplySignalParams['entrySnapshot']
  ) {
    const coolDownUntil = new Date(ts.getTime() + cdDays * DAY);
    await FractalPositionStateModel.updateOne(
      { symbol },
      {
        $set: {
          side: newSide,
          size: newSize,
          entryTs: ts,
          entryPrice: price,
          lastSignalTs: ts,
          coolDownUntil,
          updatedAt: new Date(),
          pending: {
            horizonDays: 30,
            openTs: ts,
            openPrice: price,
            side: newSide,
            size: newSize,
            ...(entrySnapshot ?? {})
          }
        }
      },
      { upsert: true }
    );
  }

  // BLOCK 29.22: Mark-to-Market
  async markToMarket(params: { symbol: string; currentPrice: number }): Promise<{ ok: boolean; unrealized: number }> {
    const { symbol, currentPrice } = params;

    const st = await FractalPositionStateModel.findOne({ symbol }).lean();
    if (!st || (st as any).side === 'FLAT' || !(st as any).entryPrice || !(st as any).size) {
      return { ok: true, unrealized: 0 };
    }

    const entryPrice = Number((st as any).entryPrice);
    const size = Number((st as any).size);
    const side = String((st as any).side);

    const gross = (currentPrice / entryPrice) - 1;
    const signed = side === 'SHORT' ? (-gross) : gross;
    const unrealized = signed * size;

    await FractalPositionStateModel.updateOne(
      { symbol },
      { $set: { unrealized, updatedAt: new Date() } }
    );

    return { ok: true, unrealized };
  }

  async reset(symbol: string): Promise<{ ok: boolean }> {
    await FractalPositionStateModel.updateOne(
      { symbol },
      {
        $set: {
          side: 'FLAT',
          size: 0,
          unrealized: 0,
          updatedAt: new Date()
        },
        $unset: {
          entryTs: '',
          entryPrice: '',
          coolDownUntil: '',
          pending: ''
        }
      },
      { upsert: true }
    );
    return { ok: true };
  }
}
