/**
 * BLOCK 29.4 + 29.13-29.14: Retrain Service with Industrial-Grade Training
 * - Train window control
 * - Purged CV
 * - Walk-forward evaluation
 * - Full metadata in registry
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { FractalMLModel } from '../data/schemas/fractal-ml-model.schema.js';
import { FractalModelRegistryModel } from '../data/schemas/fractal-model-registry.schema.js';

interface TrainConfig {
  symbol?: string;
  fromDate?: string;   // YYYY-MM-DD train start
  toDate?: string;     // YYYY-MM-DD train end
  purgeDays?: number;  // Purge gap for CV
  splits?: number;     // CV splits
  evalStart?: string;  // YYYY-MM-DD WF eval start
  evalEnd?: string;    // YYYY-MM-DD WF eval end
}

interface TrainResult {
  ok: boolean;
  symbol: string;
  version: string;
  trainWindow?: {
    requestedFrom: string | null;
    requestedTo: string | null;
    actualFrom: string | null;
    actualTo: string | null;
    purgeDays: number;
    splits: number;
    bestC: number;
    samples: number;
    datasetHash: string;
  };
  metrics: { cv_acc: number; cv_logloss: number; samples: number };
  walkForward?: {
    windows: number;
    median_proxy_sharpe: number;
    stability_score: number;
  };
  error?: string;
}

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: 300000 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export class FractalRetrainService {
  async retrain(config: TrainConfig = {}): Promise<TrainResult> {
    const symbol = config.symbol ?? 'BTC';
    const version = `v_${Date.now()}`;
    const tmpDir = path.join(process.cwd(), 'tmp');
    const outPath = path.join(tmpDir, `fractal_${symbol}_${version}.json`);
    const wfPath = path.join(tmpDir, `fractal_${symbol}_${version}_wf.json`);

    // Training params from config or env
    const trainStart = config.fromDate ?? process.env.FRACTAL_TRAIN_START ?? '2014-01-01';
    const trainEnd = config.toDate ?? process.env.FRACTAL_TRAIN_END ?? '2022-12-31';
    const purgeDays = config.purgeDays ?? Number(process.env.FRACTAL_PURGE_DAYS ?? '30');
    const splits = config.splits ?? Number(process.env.FRACTAL_PURGED_SPLITS ?? '5');
    
    // WF eval params
    const evalStart = config.evalStart ?? process.env.FRACTAL_WF_EVAL_START ?? '2023-01-01';
    const evalEnd = config.evalEnd ?? process.env.FRACTAL_WF_EVAL_END ?? '2025-12-31';
    const wfWindowDays = Number(process.env.FRACTAL_WF_WINDOW_DAYS ?? '180');
    const wfStepDays = Number(process.env.FRACTAL_WF_STEP_DAYS ?? '90');

    const apiUrl = process.env.FRACTAL_DATASET_API ?? 
      `http://localhost:8001/api/fractal/admin/dataset?symbol=${symbol}&limit=50000`;

    try {
      // Ensure tmp directory exists
      await fs.mkdir(tmpDir, { recursive: true });

      // 1) Run Python trainer with purged CV
      console.log(`[Retrain] Starting training for ${symbol}, version ${version}`);
      console.log(`[Retrain] Train window: ${trainStart} to ${trainEnd}, purge=${purgeDays}, splits=${splits}`);

      const trainArgs = [
        '/app/ml/fractal_train_logreg.py',
        outPath,
        apiUrl,
        trainStart,
        trainEnd,
        String(purgeDays),
        String(splits)
      ];

      const { stdout: trainStdout, stderr: trainStderr } = await execFileAsync(
        '/root/.venv/bin/python3',
        trainArgs
      );

      if (trainStderr) {
        console.log(`[Retrain] Train stderr: ${trainStderr}`);
      }

      // Parse training result
      let trainResult: any = {};
      try {
        trainResult = JSON.parse(trainStdout.trim());
        if (!trainResult.ok) {
          throw new Error(trainResult.error || 'Training failed');
        }
        console.log(`[Retrain] Training done: cv_acc=${trainResult.cv_acc?.toFixed(3)}, bestC=${trainResult.bestC}`);
      } catch (e) {
        if (trainStdout.includes('"ok": false')) {
          const match = trainStdout.match(/"error":\s*"([^"]+)"/);
          throw new Error(match ? match[1] : 'Training failed');
        }
        throw new Error('Failed to parse training output');
      }

      // 2) Read artifact
      const raw = await fs.readFile(outPath, 'utf8');
      const artifact = JSON.parse(raw);

      // 3) Run Walk-Forward evaluation
      console.log(`[Retrain] Running walk-forward evaluation: ${evalStart} to ${evalEnd}`);

      let wfResult: any = null;
      try {
        const wfArgs = [
          '/app/ml/fractal_eval_walkforward.py',
          outPath,
          wfPath,
          apiUrl,
          evalStart,
          evalEnd,
          String(wfWindowDays),
          String(wfStepDays)
        ];

        const { stdout: wfStdout } = await execFileAsync('/root/.venv/bin/python3', wfArgs);
        wfResult = JSON.parse(wfStdout.trim());
        
        if (wfResult.ok) {
          console.log(`[Retrain] WF eval done: windows=${wfResult.windows}, stability=${wfResult.stability_score?.toFixed(3)}`);
        }
      } catch (wfErr: any) {
        console.warn(`[Retrain] WF evaluation failed: ${wfErr.message}`);
      }

      // 4) Store model in ML store
      const modelDoc: any = {
        symbol,
        version,
        type: artifact.type ?? 'logreg_scaled',
        weights: artifact.weights,
        bias: artifact.bias,
        featureOrder: artifact.featureOrder,
        trainStats: {
          samples: artifact.metrics.samples,
          accuracy: artifact.metrics.cv_acc,
          trainDate: new Date()
        },
        updatedAt: new Date()
      };

      if (artifact.scaler) {
        modelDoc.scaler = artifact.scaler;
      }

      await FractalMLModel.updateOne(
        { symbol, version },
        { $set: modelDoc },
        { upsert: true }
      );

      // 5) Create registry entry with full metadata
      const registryDoc: any = {
        symbol,
        version,
        status: 'SHADOW',
        type: artifact.type ?? 'logreg_scaled',
        metrics: artifact.metrics,
        trainWindow: artifact.trainWindow,
        artifactPath: outPath
      };

      // Add WF results if available
      if (wfResult?.ok) {
        registryDoc.walkForward = {
          evalStart,
          evalEnd,
          windowDays: wfWindowDays,
          stepDays: wfStepDays,
          windows: wfResult.windows,
          median_proxy_sharpe: wfResult.median_proxy_sharpe,
          std_proxy_sharpe: wfResult.std_proxy_sharpe,
          positive_window_frac: wfResult.positive_window_frac,
          stability_score: wfResult.stability_score,
          reportPath: wfPath
        };
      }

      await FractalModelRegistryModel.create(registryDoc);

      console.log(`[Retrain] Model ${version} created. CV accuracy: ${artifact.metrics.cv_acc.toFixed(3)}`);

      return {
        ok: true,
        symbol,
        version,
        trainWindow: artifact.trainWindow,
        metrics: artifact.metrics,
        walkForward: wfResult?.ok ? {
          windows: wfResult.windows,
          median_proxy_sharpe: wfResult.median_proxy_sharpe,
          stability_score: wfResult.stability_score
        } : undefined
      };
    } catch (err: any) {
      console.error(`[Retrain] Error:`, err.message || err);

      // Mark as FAILED in registry
      try {
        await FractalModelRegistryModel.create({
          symbol,
          version,
          status: 'FAILED',
          type: 'logreg_scaled',
          metrics: {}
        });
      } catch (e) {
        // Ignore duplicate key errors
      }

      return {
        ok: false,
        symbol,
        version,
        metrics: { cv_acc: 0, cv_logloss: 0, samples: 0 },
        error: err.message || String(err)
      };
    }
  }
}
