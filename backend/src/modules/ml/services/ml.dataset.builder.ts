/**
 * PHASE 3.1 — Dataset Builder
 * ============================
 * Time-based train/val/test split
 */

import { MlDatasetRow, SplitSet, TrainConfig, FeatureMatrix } from '../contracts/ml.types.js';
import { MlDatasetRowModel } from '../storage/ml.storage.js';

class MlDatasetBuilder {
  
  async loadRows(cfg: TrainConfig): Promise<MlDatasetRow[]> {
    const query: any = {};
    
    if (cfg.symbols?.length) {
      query.symbol = { $in: cfg.symbols };
    }
    if (cfg.horizonBars != null) {
      query.horizonBars = cfg.horizonBars;
    }
    if (cfg.from != null || cfg.to != null) {
      query.t0 = {};
      if (cfg.from != null) query.t0.$gte = cfg.from;
      if (cfg.to != null) query.t0.$lte = cfg.to;
    }
    
    const rows = await MlDatasetRowModel
      .find(query)
      .sort({ t0: 1 })
      .lean() as MlDatasetRow[];
    
    return rows;
  }
  
  splitTimeBased(
    rows: MlDatasetRow[],
    split = { train: 0.7, val: 0.15, test: 0.15 }
  ): SplitSet<MlDatasetRow> {
    // CRITICAL: Sort by time, no shuffle (prevents leakage)
    const sorted = [...rows].sort((a, b) => a.t0 - b.t0);
    const n = sorted.length;
    
    const nTrain = Math.floor(n * split.train);
    const nVal = Math.floor(n * split.val);
    
    return {
      train: sorted.slice(0, nTrain),
      val: sorted.slice(nTrain, nTrain + nVal),
      test: sorted.slice(nTrain + nVal),
    };
  }
  
  buildFeatureMatrix(rows: MlDatasetRow[]): FeatureMatrix {
    // Collect all feature names
    const featureSet = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.features || {})) {
        featureSet.add(k);
      }
    }
    
    // Stable feature order
    const featureNames = Array.from(featureSet).sort();
    
    const X: number[][] = [];
    const y: number[] = [];
    
    for (const r of rows) {
      const vec = featureNames.map((f) => {
        const v = r.features?.[f];
        if (v == null || !Number.isFinite(v)) return 0;
        return v;
      });
      X.push(vec);
      y.push(r.y);
    }
    
    return { X, y, featureNames };
  }
  
  // Standardization scaler
  fitStandardScaler(X: number[][]): { mean: number[]; std: number[] } {
    const m = X[0]?.length ?? 0;
    const mean = new Array(m).fill(0);
    const std = new Array(m).fill(0);
    const n = X.length;
    
    // Mean
    for (const row of X) {
      for (let j = 0; j < m; j++) {
        mean[j] += row[j];
      }
    }
    for (let j = 0; j < m; j++) {
      mean[j] /= Math.max(1, n);
    }
    
    // Std
    for (const row of X) {
      for (let j = 0; j < m; j++) {
        std[j] += (row[j] - mean[j]) ** 2;
      }
    }
    for (let j = 0; j < m; j++) {
      std[j] = Math.sqrt(std[j] / Math.max(1, n)) || 1;
    }
    
    return { mean, std };
  }
  
  applyStandardScaler(
    X: number[][],
    scaler: { mean: number[]; std: number[] }
  ): number[][] {
    return X.map((row) =>
      row.map((v, j) => (v - scaler.mean[j]) / (scaler.std[j] || 1))
    );
  }
  
  // Save row to dataset
  async saveRow(row: Omit<MlDatasetRow, '_id'>): Promise<void> {
    await MlDatasetRowModel.updateOne(
      { symbol: row.symbol, t0: row.t0, horizonBars: row.horizonBars },
      { $set: row },
      { upsert: true }
    );
  }
  
  // Bulk save
  async saveRows(rows: Omit<MlDatasetRow, '_id'>[]): Promise<number> {
    const ops = rows.map((row) => ({
      updateOne: {
        filter: { symbol: row.symbol, t0: row.t0, horizonBars: row.horizonBars },
        update: { $set: row },
        upsert: true,
      },
    }));
    
    if (ops.length === 0) return 0;
    
    const result = await MlDatasetRowModel.bulkWrite(ops);
    return result.upsertedCount + result.modifiedCount;
  }
  
  // Count
  async count(cfg?: TrainConfig): Promise<number> {
    const query: any = {};
    if (cfg?.symbols?.length) query.symbol = { $in: cfg.symbols };
    if (cfg?.horizonBars != null) query.horizonBars = cfg.horizonBars;
    return MlDatasetRowModel.countDocuments(query);
  }
}

export const mlDatasetBuilder = new MlDatasetBuilder();

console.log('[Phase 3.1] ML Dataset Builder loaded');
