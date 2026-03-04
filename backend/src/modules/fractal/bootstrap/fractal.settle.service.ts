/**
 * BLOCK 29.21: Settlement Service
 * Settles positions after horizon expires, creates feedback events, updates calibration
 */

import { FractalPositionStateModel } from '../data/schemas/fractal-position-state.schema.js';
import { FractalFeedbackModel } from '../data/schemas/fractal-feedback.schema.js';
import { FractalPerfModel } from '../data/schemas/fractal-performance.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';
import { FractalRiskStateService } from './fractal.risk-state.service.js';
import { FractalOnlineCalibrationService } from './fractal.online-calibration.service.js';
import { CanonicalStore } from '../data/canonical.store.js';

const DAY = 86400000;

export class FractalSettleService {
  private risk = new FractalRiskStateService();
  private calib = new FractalOnlineCalibrationService();
  private canonical = new CanonicalStore();

  async settleIfDue(symbol = 'BTC', now = new Date()) {
    const st = await FractalPositionStateModel.findOne({ symbol }).lean();
    if (!st?.pending?.openTs) {
      return { ok: true, settled: false, reason: 'NO_PENDING' };
    }

    const pending = st.pending as any;
    const openTs = new Date(pending.openTs);
    const horizonDays = Number(pending.horizonDays ?? 30);
    const dueTs = new Date(openTs.getTime() + horizonDays * DAY);

    if (now.getTime() < dueTs.getTime()) {
      return { ok: true, settled: false, reason: 'NOT_DUE', dueTs };
    }

    // Load settings for costs
    const settings = await FractalSettingsModel.findOne({ symbol }).lean() as any;
    const feeBps = Number(settings?.costModel?.feeBps ?? 4);
    const slippageBps = Number(settings?.costModel?.slippageBps ?? 6);
    const spreadBps = Number(settings?.costModel?.spreadBps ?? 2);
    const roundTripCost = 2 * (feeBps + slippageBps + spreadBps) / 10000;

    // Get close at dueTs (canonical)
    const openPrice = Number(pending.openPrice ?? 0);
    const dueClose = await this.getCloseAtOrBefore(symbol, dueTs);
    const closePrice = Number(dueClose ?? 0);

    if (!openPrice || !closePrice) {
      return { ok: false, settled: false, reason: 'PRICE_MISSING', openPrice, closePrice };
    }

    const side = String(pending.side ?? 'LONG');
    const size = Number(pending.size ?? 0);

    const gross = (closePrice / openPrice) - 1;
    const signed = side === 'SHORT' ? (-gross) : gross;

    // Exit costs
    const exitCost = (roundTripCost / 2) * size;
    const net = (signed * size) - exitCost;

    // Update position + clear pending
    const newRealized = Number(st.realized ?? 0) + net;

    await FractalPositionStateModel.updateOne(
      { symbol },
      {
        $set: {
          realized: newRealized,
          side: 'FLAT',
          size: 0,
          updatedAt: new Date()
        },
        $unset: { pending: '', entryTs: '', entryPrice: '' }
      }
    );

    // Update risk state
    const risk = await this.risk.applyRealized(symbol, dueTs, net);

    // BLOCK 29.23: Create feedback event
    const entryConf = Number(pending.confidence ?? 0);
    const entrySignal = String(pending.signal ?? side);
    const modelVersion = String(pending.modelVersion ?? 'ACTIVE');
    const features = pending.features ?? {};
    const regime = pending.regime ?? { trend: 'UNKNOWN', volatility: 'UNKNOWN' };
    const ddAbs = Number(pending.ddAbs ?? 0);

    const y_up = net > 0 ? 1 : 0;
    const correct = y_up === 1;

    await FractalFeedbackModel.updateOne(
      { symbol, openTs: openTs },
      {
        $set: {
          symbol,
          openTs,
          settleTs: dueTs,
          side,
          size,
          signal: entrySignal,
          confidence: entryConf,
          exposure: size,
          ddAbs,
          regime,
          features,
          realized: {
            openPrice,
            closePrice,
            gross,
            net
          },
          label: {
            y_up,
            y_return: net
          },
          correct,
          modelVersion,
          datasetHashAtTrain: pending.datasetHashAtTrain,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    // Update online calibration
    await this.calib.update(symbol, entryConf, correct, net);

    // Perf log
    await FractalPerfModel.updateOne(
      {
        symbol,
        windowEndTs: openTs,
        windowLen: 60,
        horizonDays,
        timeframe: '1d'
      },
      {
        $set: {
          symbol,
          timeframe: '1d',
          windowLen: 60,
          horizonDays,
          windowEndTs: openTs,
          implied: {
            direction: side === 'LONG' ? 'UP' : 'DOWN',
            p50Return: gross,
            p10Return: gross,
            p90Return: gross
          },
          realized: {
            forwardReturn: gross,
            forwardMaxDD: 0
          },
          confidence: { rawScore: entryConf },
          hit: correct,
          errorAbs: Math.abs(gross - net),
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    return {
      ok: true,
      settled: true,
      dueTs,
      net,
      gross,
      side,
      size,
      openPrice,
      closePrice,
      risk
    };
  }

  private async getCloseAtOrBefore(symbol: string, ts: Date): Promise<number | null> {
    const series = await this.canonical.getClosePrices(symbol, '1d');
    // Find closest candle before or at ts
    let closest: { ts: Date; close: number } | null = null;
    for (const c of series) {
      if (c.ts.getTime() <= ts.getTime()) {
        closest = c;
      } else {
        break;
      }
    }
    return closest?.close ?? null;
  }

  async getLatestClose(symbol: string): Promise<number | null> {
    const series = await this.canonical.getClosePrices(symbol, '1d');
    if (!series.length) return null;
    return series[series.length - 1].close;
  }
}
