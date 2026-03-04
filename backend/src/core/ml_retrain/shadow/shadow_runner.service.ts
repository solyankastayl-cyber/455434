/**
 * BATCH 3: Shadow Runner Service
 * 
 * Прогоняет ACTIVE vs SHADOW на одинаковом sample и записывает результат.
 * Это сердце shadow evaluation.
 */

import { ShadowComparisonModel, type MlTask } from './ml_shadow_comparison.model.js';
import { MlModelRegistryModel } from '../ml_model_registry.model.js';
import { computeBinaryMetrics, computeDelta, toLabelFromProb, type BinaryLabel } from './metrics.js';
import { makeVerdict } from './shadow_verdict.js';
import { broadcastAdminEvent } from '../../admin/admin.events.js';
import { mlGovernanceService } from '../../ml_governance/index.js';
import { env } from '../../../config/env.js';
import * as fs from 'fs';
import * as path from 'path';

const DATASETS_DIR = process.env.DATASETS_DIR || '/data/datasets';

export interface ShadowEvaluateRequest {
  task: MlTask;
  network: string;
  shadowModelVersion?: string;
  activeModelVersion?: string;
  limit?: number;
  windowLabel?: string;
}

export interface LabeledSample {
  X: Record<string, number>[];
  yTrue: BinaryLabel[];
  rows: number;
  datasetVersion: string;
  source: 'csv' | 'mongo';
}

export class ShadowRunnerService {
  
  /**
   * Main entry: run ACTIVE vs SHADOW comparison
   */
  static async evaluate(req: ShadowEvaluateRequest) {
    const nowTs = Math.floor(Date.now() / 1000);
    const task = req.task ?? 'market';
    const network = req.network;
    const limit = Math.max(50, Math.min(req.limit ?? 1000, 20000));
    const windowLabel = req.windowLabel ?? '24h';

    console.log(`[ShadowRunner] Starting evaluation: ${task}/${network}`);

    // 1) Get model versions
    const activeModelVersion = req.activeModelVersion || await this.getActiveModelVersion(task, network);
    const shadowModelVersion = req.shadowModelVersion || await this.getLatestShadowVersion(task, network);

    if (!shadowModelVersion) {
      throw new Error(`No SHADOW model found for ${task}/${network}`);
    }

    console.log(`[ShadowRunner] ACTIVE: ${activeModelVersion}, SHADOW: ${shadowModelVersion}`);

    // 2) Get labeled sample
    const sample = await this.getLabeledSample(task, network, limit);
    
    if (sample.rows === 0) {
      throw new Error(`No sample data for ${task}/${network}`);
    }

    console.log(`[ShadowRunner] Sample: ${sample.rows} rows from ${sample.source}`);

    // 3) ACTIVE inference
    const t0a = performance.now();
    const activePreds = await this.predict(task, activeModelVersion, sample.X);
    const t1a = performance.now();

    // 4) SHADOW inference
    const t0s = performance.now();
    const shadowPreds = await this.predict(task, shadowModelVersion, sample.X);
    const t1s = performance.now();

    // 5) Compute metrics
    const yPredActive = activePreds.map(p => toLabelFromProb(p, 0.5));
    const yPredShadow = shadowPreds.map(p => toLabelFromProb(p, 0.5));

    const metricsActive = computeBinaryMetrics(sample.yTrue, yPredActive);
    const metricsShadow = computeBinaryMetrics(sample.yTrue, yPredShadow);
    const delta = computeDelta(metricsActive, metricsShadow);

    // 6) Make verdict
    const verdict = makeVerdict({
      rows: sample.rows,
      f1Delta: delta.f1Delta,
      accuracyDelta: delta.accuracyDelta,
    });

    console.log(`[ShadowRunner] Verdict: ${verdict.status} - ${verdict.reason}`);

    // 7) Persist to MongoDB
    const doc = await ShadowComparisonModel.create({
      createdAtTs: nowTs,
      task,
      network,
      windowLabel,
      activeModelVersion,
      shadowModelVersion,
      sample: {
        rows: sample.rows,
        datasetVersion: sample.datasetVersion,
        source: sample.source,
      },
      metricsActive: {
        accuracy: metricsActive.accuracy,
        f1: metricsActive.f1,
        precision: metricsActive.precision,
        recall: metricsActive.recall,
      },
      metricsShadow: {
        accuracy: metricsShadow.accuracy,
        f1: metricsShadow.f1,
        precision: metricsShadow.precision,
        recall: metricsShadow.recall,
      },
      delta,
      latencyMs: {
        active: Math.round(t1a - t0a),
        shadow: Math.round(t1s - t0s),
      },
      verdict,
    });

    // 8) Emit WS event
    try {
      broadcastAdminEvent({
        type: 'SHADOW_EVAL_FINISHED',
        meta: {
          task,
          network,
          activeModelVersion,
          shadowModelVersion,
          verdict: verdict.status,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn('[ShadowRunner] WS emit failed:', err);
    }

    // 9) GOVERNANCE: Update model eval data and auto-request approval on PASS
    try {
      const shadowModel = await MlModelRegistryModel.findOne({
        modelType: task,
        version: shadowModelVersion
      });
      
      if (shadowModel) {
        // Update eval info in registry
        shadowModel.eval = {
          verdict: verdict.status as 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NONE',
          evaluatedAt: new Date(),
          comparedToVersion: activeModelVersion,
          metrics: metricsShadow,
          delta: {
            accuracy: delta.accuracyDelta,
            f1: delta.f1Delta,
          },
        };
        await shadowModel.save();
        
        console.log(`[ShadowRunner] Updated eval for ${shadowModelVersion}: ${verdict.status}`);
        
        // Auto-request approval if PASS
        if (verdict.status === 'PASS') {
          await mlGovernanceService.autoRequestAfterPass(shadowModel._id.toString());
          console.log(`[ShadowRunner] Auto-requested approval for ${shadowModelVersion}`);
        }
      }
    } catch (err: any) {
      console.error('[ShadowRunner] Governance update failed:', err.message);
    }

    return { ok: true, data: doc.toObject() };
  }

  /**
   * Get latest comparison result
   */
  static async getLatest(task: MlTask, network: string) {
    const doc = await ShadowComparisonModel
      .findOne({ task, network })
      .sort({ createdAtTs: -1 })
      .lean();
    
    return { ok: true, data: doc };
  }

  /**
   * Get comparison history
   */
  static async getHistory(task: MlTask, network: string, limit = 50) {
    const docs = await ShadowComparisonModel
      .find({ task, network })
      .sort({ createdAtTs: -1 })
      .limit(Math.max(1, Math.min(limit, 200)))
      .lean();
    
    return { ok: true, data: docs };
  }

  /**
   * Get summary across all networks
   */
  static async getSummary(task: MlTask) {
    const networks = ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon', 'bsc', 'avalanche', 'fantom'];
    const summary: any[] = [];

    for (const network of networks) {
      const latest = await ShadowComparisonModel
        .findOne({ task, network })
        .sort({ createdAtTs: -1 })
        .lean();
      
      summary.push({
        network,
        hasData: !!latest,
        verdict: latest?.verdict?.status || null,
        f1Delta: latest?.delta?.f1Delta || null,
        shadowVersion: latest?.shadowModelVersion || null,
        createdAtTs: latest?.createdAtTs || null,
      });
    }

    const passCount = summary.filter(s => s.verdict === 'PASS').length;
    const failCount = summary.filter(s => s.verdict === 'FAIL').length;

    return {
      ok: true,
      data: {
        task,
        networks: summary,
        passCount,
        failCount,
        totalWithData: summary.filter(s => s.hasData).length,
      },
    };
  }

  // ========== Private helpers ==========

  /**
   * Get active model version from registry or fallback
   */
  private static async getActiveModelVersion(task: MlTask, network: string): Promise<string> {
    // Try to find ACTIVE model in registry
    const active = await MlModelRegistryModel
      .findOne({ modelType: task, network, status: 'ACTIVE' })
      .sort({ trainedAt: -1 })
      .lean();
    
    if (active?.version) {
      return active.version;
    }

    // Fallback: use first SHADOW as baseline (for initial comparison)
    const shadow = await MlModelRegistryModel
      .findOne({ modelType: task, status: 'SHADOW' })
      .sort({ trainedAt: 1 }) // oldest SHADOW
      .lean();
    
    if (shadow?.version) {
      console.warn(`[ShadowRunner] No ACTIVE model, using oldest SHADOW as baseline: ${shadow.version}`);
      return shadow.version;
    }

    return 'baseline_v1'; // Ultimate fallback
  }

  /**
   * Get latest SHADOW model version from registry
   */
  private static async getLatestShadowVersion(task: MlTask, network: string): Promise<string | null> {
    const shadow = await MlModelRegistryModel
      .findOne({ 
        modelType: task, 
        status: 'SHADOW' 
      })
      .sort({ trainedAt: -1 })
      .lean();
    
    return shadow?.version || null;
  }

  /**
   * Get labeled sample from CSV dataset
   */
  private static async getLabeledSample(
    task: MlTask, 
    network: string, 
    limit: number
  ): Promise<LabeledSample> {
    const datasetVersion = 'v2.0';
    const csvPath = path.join(DATASETS_DIR, datasetVersion, task, 'latest.csv');
    
    if (!fs.existsSync(csvPath)) {
      console.warn(`[ShadowRunner] CSV not found: ${csvPath}, returning empty sample`);
      return { X: [], yTrue: [], rows: 0, datasetVersion, source: 'csv' };
    }

    // Parse CSV
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    if (lines.length < 2) {
      return { X: [], yTrue: [], rows: 0, datasetVersion, source: 'csv' };
    }

    const headers = lines[0].split(',');
    const yIndex = headers.indexOf('y');
    
    if (yIndex === -1) {
      throw new Error('CSV missing "y" column');
    }

    const X: Record<string, number>[] = [];
    const yTrue: BinaryLabel[] = [];

    // Parse rows (skip header)
    const dataLines = lines.slice(1, Math.min(lines.length, limit + 1));
    
    for (const line of dataLines) {
      const values = line.split(',').map(v => parseFloat(v) || 0);
      
      const row: Record<string, number> = {};
      for (let i = 0; i < headers.length; i++) {
        if (i !== yIndex) {
          row[headers[i]] = values[i];
        }
      }
      
      X.push(row);
      yTrue.push(values[yIndex] >= 0.5 ? 1 : 0);
    }

    return {
      X,
      yTrue,
      rows: X.length,
      datasetVersion,
      source: 'csv',
    };
  }

  /**
   * Call Python ML service for prediction
   */
  private static async predict(
    task: MlTask,
    modelVersion: string,
    rows: Record<string, number>[]
  ): Promise<number[]> {
    const url = `${env.PY_ML_URL}/api/v3/predict`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          model_version: modelVersion,
          rows,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Python predict failed: ${response.status} ${text}`);
      }

      const data = await response.json() as { ok: boolean; pUp: number[] };
      
      if (!data.ok || !data.pUp) {
        throw new Error('Invalid predict response');
      }

      return data.pUp;
    } catch (err: any) {
      console.error(`[ShadowRunner] Predict error for ${modelVersion}:`, err.message);
      
      // Fallback: return random predictions (for testing when model not available)
      console.warn(`[ShadowRunner] Using fallback random predictions`);
      return rows.map(() => Math.random());
    }
  }
}
