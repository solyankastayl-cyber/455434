/**
 * BLOCK 29.29: Ensemble Service
 * Multi-model blend using softmax weights
 */

import { FractalModelRegistryModel } from '../data/schemas/fractal-model-registry.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';

function softmax(xs: number[], temp: number): number[] {
  const t = Math.max(0.1, Number(temp ?? 2.0));
  const m = Math.max(...xs);
  const exps = xs.map(x => Math.exp((x - m) / t));
  const s = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(e => e / s);
}

export interface EnsembleMember {
  version: string;
  years?: number;
  weight: number;
}

export interface EnsembleResult {
  ok: boolean;
  groupId?: string;
  members?: EnsembleMember[];
  reason?: string;
}

export class FractalEnsembleService {
  async buildEnsemble(symbol = 'BTC', groupId: string): Promise<EnsembleResult> {
    const settings = await FractalSettingsModel.findOne({ symbol }).lean() as any;
    const cfg = settings?.ensembleMode ?? {};
    const years = ((cfg.windows ?? [4, 6, 8]) as number[]).map((x: any) => Number(x));
    const minW = Number(cfg.minWeight ?? 0.10);
    const temp = Number(cfg.temperature ?? 2.0);

    // Get latest SHADOW models for these windows
    const candidates = await FractalModelRegistryModel.find({
      symbol,
      status: 'SHADOW',
      'trainWindow.years': { $in: years }
    }).sort({ createdAt: -1 }).limit(20).lean();

    // Select best per year
    const bestByYears = new Map<number, any>();
    for (const y of years) {
      const found = candidates.find((c: any) => Number(c?.trainWindow?.years) === y);
      if (found) bestByYears.set(y, found);
    }
    const members = [...bestByYears.values()];
    if (!members.length) return { ok: false, reason: 'NO_MEMBERS' };

    // Scores
    const scores = members.map((m: any) => Number(m?.windowScore?.score ?? 0));
    let weights = softmax(scores, temp);

    // Clamp minWeight and renormalize
    weights = weights.map(x => Math.max(minW, x));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    weights = weights.map(x => x / sum);

    // Write weights + groupId
    for (let i = 0; i < members.length; i++) {
      await FractalModelRegistryModel.updateOne(
        { symbol, version: members[i].version },
        {
          $set: {
            'ensemble.groupId': groupId,
            'ensemble.member': true,
            'ensemble.weight': weights[i]
          }
        }
      );
    }

    return {
      ok: true,
      groupId,
      members: members.map((m: any, i) => ({
        version: m.version,
        years: m.trainWindow?.years,
        weight: weights[i]
      }))
    };
  }

  async getActiveEnsemble(symbol = 'BTC'): Promise<EnsembleResult> {
    const last = await FractalModelRegistryModel.findOne({
      symbol,
      'ensemble.member': true
    }).sort({ 'ensemble.groupId': -1 }).lean() as any;

    if (!last?.ensemble?.groupId) {
      return { ok: false, reason: 'NO_ACTIVE_ENSEMBLE' };
    }

    const groupId = last.ensemble.groupId;

    const members = await FractalModelRegistryModel.find({
      symbol,
      'ensemble.groupId': groupId,
      'ensemble.member': true
    }).lean() as any[];

    return {
      ok: true,
      groupId,
      members: members.map((m: any) => ({
        version: m.version,
        years: m.trainWindow?.years,
        weight: Number(m.ensemble?.weight ?? 0)
      }))
    };
  }

  async disableEnsemble(symbol = 'BTC'): Promise<{ ok: boolean }> {
    await FractalModelRegistryModel.updateMany(
      { symbol, 'ensemble.member': true },
      { $set: { 'ensemble.member': false } }
    );
    return { ok: true };
  }
}
