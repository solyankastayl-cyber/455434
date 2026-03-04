/**
 * BLOCK 29.26: Autopilot Service
 * Closed-loop automation: drift -> window search -> retrain -> promote
 */

import { FractalAutopilotRunModel } from '../data/schemas/fractal-autopilot-run.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';
import { FractalDriftService } from './fractal.drift.service.js';
import { FractalSettleService } from './fractal.settle.service.js';
import { FractalPositionService } from './fractal.position.service.js';
import { FractalAutoWindowService } from './fractal.auto-window.service.js';
import { FractalWindowEvalService } from './fractal.window-eval.service.js';
import { FractalEnsembleService } from './fractal.ensemble.service.js';
import { FractalModelRegistryModel } from '../data/schemas/fractal-model-registry.schema.js';
import { addDays } from '../domain/time.js';

export interface AutopilotResult {
  ok: boolean;
  run?: any;
  error?: string;
}

export class FractalAutopilotService {
  private settle = new FractalSettleService();
  private pos = new FractalPositionService();
  private drift = new FractalDriftService();
  private autoWindow = new FractalAutoWindowService();
  private windowEval = new FractalWindowEvalService();
  private ensemble = new FractalEnsembleService();

  async run(symbol = 'BTC'): Promise<AutopilotResult> {
    const started = new Date();
    const steps: any = {};

    try {
      // 1) Settle if due (safe)
      steps.settled = await this.settle.settleIfDue(symbol, new Date());

      // 2) Position snapshot
      steps.position = await this.pos.get(symbol);

      // 3) Drift check
      steps.drift = await this.drift.compute(symbol, { recentN: 120, baselineN: 720, highConfLo: 0.65 });

      const level = steps.drift?.drift?.level ?? 'OK';

      // 4) Policy actions based on drift level
      if (level === 'OK') {
        const doc = await FractalAutopilotRunModel.create({
          symbol,
          ts: started,
          steps,
          result: { status: 'OK', reason: 'NO_DRIFT' }
        });
        return { ok: true, run: doc };
      }

      if (level === 'WARN') {
        // Freeze promotion for 7 days
        const until = addDays(7);
        await FractalSettingsModel.updateOne(
          { symbol },
          { $set: { promotionFrozenUntil: until } },
          { upsert: true }
        );

        const doc = await FractalAutopilotRunModel.create({
          symbol,
          ts: started,
          steps,
          result: { status: 'FROZEN', reason: 'WARN_DRIFT' }
        });
        return { ok: true, run: doc };
      }

      if (level === 'CRITICAL') {
        // Rollback + freeze
        steps.decision = await this.rollbackActive(symbol, 'CRITICAL_DRIFT');

        const until = addDays(14);
        await FractalSettingsModel.updateOne(
          { symbol },
          { $set: { promotionFrozenUntil: until } },
          { upsert: true }
        );

        // Disable ensemble
        await this.ensemble.disableEnsemble(symbol);

        const doc = await FractalAutopilotRunModel.create({
          symbol,
          ts: started,
          steps,
          result: { status: 'ROLLED_BACK', reason: 'CRITICAL_DRIFT' }
        });
        return { ok: true, run: doc };
      }

      // DEGRADED -> Auto-window search + evaluate
      if (level === 'DEGRADED') {
        steps.windowSearch = await this.autoSelectTrainWindow(symbol);

        const best = steps.windowSearch?.best;
        if (!best) {
          const doc = await FractalAutopilotRunModel.create({
            symbol,
            ts: started,
            steps,
            result: { status: 'ERROR', reason: 'NO_BEST_WINDOW' }
          });
          return { ok: false, run: doc };
        }

        // Compare with active and maybe promote
        steps.decision = await this.compareAndMaybePromote(symbol, best.version);

        // If promoted, freeze promotions for 14 days
        if (steps.decision?.promoted) {
          const until = addDays(14);
          await FractalSettingsModel.updateOne(
            { symbol },
            { $set: { promotionFrozenUntil: until } },
            { upsert: true }
          );
        }

        const status = steps.decision?.promoted ? 'PROMOTED' : 'RETRAINED';

        const doc = await FractalAutopilotRunModel.create({
          symbol,
          ts: started,
          steps,
          result: { status, reason: 'DEGRADED_DRIFT' }
        });

        return { ok: true, run: doc };
      }

      // Fallback
      const doc = await FractalAutopilotRunModel.create({
        symbol,
        ts: started,
        steps,
        result: { status: 'NOOP', reason: 'UNKNOWN_LEVEL' }
      });

      return { ok: true, run: doc };

    } catch (e: any) {
      const doc = await FractalAutopilotRunModel.create({
        symbol,
        ts: started,
        steps,
        result: { status: 'ERROR', reason: String(e?.message ?? e) }
      });
      return { ok: false, error: String(e?.message ?? e), run: doc };
    }
  }

  async autoSelectTrainWindow(symbol: string): Promise<any> {
    const settings = await FractalSettingsModel.findOne({ symbol }).lean() as any;
    const policy = settings?.autoTrainWindow ?? {};
    
    const { candidates } = await this.autoWindow.buildCandidates(symbol);
    const activeScore = await this.windowEval.scoreActive(symbol);

    const startedAt = Date.now();
    const maxMinutes = Number(policy?.budget?.maxTrainMinutes ?? 25);

    const results: any[] = [];
    let best: any = null;

    for (const c of candidates) {
      // Time budget soft stop
      if ((Date.now() - startedAt) > maxMinutes * 60000) break;

      // Create shadow version (simulated - in real impl calls retrain service)
      const version = `v_shadow_${c.years}y_${Date.now()}`;

      // Score would normally come from actual training + eval
      // Here we simulate by checking if registry has recent similar version
      const existing = await FractalModelRegistryModel.findOne({
        symbol,
        status: 'SHADOW',
        'trainWindow.years': c.years
      }).sort({ createdAt: -1 }).lean() as any;

      const scored = existing
        ? await this.windowEval.scoreWindow(symbol, existing.version)
        : { score: 0, components: {} };

      const row = {
        years: c.years,
        trainStart: c.trainStart,
        trainEnd: c.trainEnd,
        version: existing?.version ?? version,
        score: scored.score,
        metrics: scored.components,
        rejected: false,
        rejectReason: null as string | null
      };

      // CV floor check
      const accFloor = Number(policy?.filters?.dropIfAccBelow ?? 0.515);
      if (Number(scored.components?.cvAcc ?? 0.5) < accFloor) {
        row.rejected = true;
        row.rejectReason = 'CV_ACC_BELOW_FLOOR';
      }

      results.push(row);

      if (!row.rejected && (!best || row.score > best.score)) {
        best = row;
      }

      // Early stop check
      const es = policy?.earlyStop ?? {};
      const enabled = es.enabled ?? true;

      if (enabled && best && !best.rejected) {
        const minGain = Number(es.minScoreGain ?? 0.08);
        const minStab = Number(es.minStability ?? 0.22);
        const minMedS = Number(es.minMedianSharpe ?? 0.55);

        const beatsActive = (best.score - (activeScore.score ?? 0)) >= minGain;
        const stab = Number(best.metrics?.wfStab ?? -999);
        const medS = Number(best.metrics?.wfMedS ?? 0);

        const ok = beatsActive && stab >= minStab && medS >= minMedS;
        if (ok) break; // Found clear winner
      }
    }

    return {
      ok: true,
      activeScore,
      best,
      all: results,
      meta: {
        startedAt: new Date(startedAt),
        durationMs: Date.now() - startedAt,
        candidatesPlanned: candidates.length,
        candidatesTried: results.length,
        earlyStopTriggered: results.length < candidates.length
      }
    };
  }

  async compareAndMaybePromote(symbol: string, shadowVersion: string): Promise<any> {
    const shadow = await FractalModelRegistryModel.findOne({ symbol, version: shadowVersion }).lean() as any;
    const active = await FractalModelRegistryModel.findOne({ symbol, status: 'ACTIVE' }).lean() as any;

    if (!shadow) {
      return { promoted: false, reason: 'SHADOW_NOT_FOUND' };
    }

    const shadowScore = await this.windowEval.scoreWindow(symbol, shadowVersion);
    const activeScore = active ? await this.windowEval.scoreWindow(symbol, active.version) : { score: 0 };

    // Check if shadow beats active
    if (shadowScore.score > activeScore.score + 0.05) {
      // Promote shadow to active
      if (active) {
        await FractalModelRegistryModel.updateOne(
          { symbol, version: active.version },
          { $set: { status: 'ARCHIVED' } }
        );
      }

      await FractalModelRegistryModel.updateOne(
        { symbol, version: shadowVersion },
        { $set: { status: 'ACTIVE' } }
      );

      return {
        promoted: true,
        shadowVersion,
        shadowScore: shadowScore.score,
        activeScore: activeScore.score,
        margin: shadowScore.score - activeScore.score
      };
    }

    return {
      promoted: false,
      reason: 'SHADOW_NOT_BETTER',
      shadowScore: shadowScore.score,
      activeScore: activeScore.score,
      margin: shadowScore.score - activeScore.score
    };
  }

  async rollbackActive(symbol: string, reason: string): Promise<any> {
    const active = await FractalModelRegistryModel.findOne({ symbol, status: 'ACTIVE' }).lean() as any;
    
    if (!active) {
      return { rolled: false, reason: 'NO_ACTIVE' };
    }

    // Find last archived version
    const lastArchived = await FractalModelRegistryModel.findOne({
      symbol,
      status: 'ARCHIVED'
    }).sort({ createdAt: -1 }).lean() as any;

    // Demote current active
    await FractalModelRegistryModel.updateOne(
      { symbol, version: active.version },
      { $set: { status: 'ARCHIVED' } }
    );

    if (lastArchived) {
      // Promote last archived to active
      await FractalModelRegistryModel.updateOne(
        { symbol, version: lastArchived.version },
        { $set: { status: 'ACTIVE' } }
      );
    }

    return {
      rolled: true,
      reason,
      demotedVersion: active.version,
      promotedVersion: lastArchived?.version ?? null
    };
  }

  async getHistory(symbol: string, limit = 20): Promise<any[]> {
    return FractalAutopilotRunModel.find({ symbol })
      .sort({ ts: -1 })
      .limit(Math.min(100, limit))
      .lean();
  }
}
