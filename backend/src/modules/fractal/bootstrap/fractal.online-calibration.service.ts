/**
 * BLOCK 29.23 + 29.30 + 29.32: Online Calibration Service
 * Tracks empirical accuracy per confidence bucket with Bayesian credible intervals
 * Supports per-horizon calibration via modelKey
 */

import { FractalOnlineCalibrationModel } from '../data/schemas/fractal-online-calibration.schema.js';
import { betaMean, betaQuantile } from '../domain/beta.js';

function defaultBuckets() {
  const edges = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1.0];
  const buckets = [];
  for (let i = 0; i < edges.length - 1; i++) {
    buckets.push({ lo: edges[i], hi: edges[i + 1], n: 0, correct: 0, sumNet: 0 });
  }
  return buckets;
}

// Default Bayesian prior
const DEFAULT_PRIOR_ALPHA = 2;
const DEFAULT_PRIOR_BETA = 2;

export class FractalOnlineCalibrationService {
  // BLOCK 29.32: Support modelKey for per-horizon calibration
  async ensure(modelKeyOrSymbol: string) {
    let doc = await FractalOnlineCalibrationModel.findOne({ symbol: modelKeyOrSymbol }).lean();
    if (!doc) {
      await FractalOnlineCalibrationModel.create({ symbol: modelKeyOrSymbol, buckets: defaultBuckets() });
      doc = await FractalOnlineCalibrationModel.findOne({ symbol: modelKeyOrSymbol }).lean();
    }
    return doc!;
  }

  bucketIndex(conf: number, buckets: any[]) {
    const c = Math.max(0, Math.min(1, conf));
    for (let i = 0; i < buckets.length; i++) {
      if (c >= buckets[i].lo && c < buckets[i].hi) return i;
    }
    return buckets.length - 1;
  }

  async update(modelKeyOrSymbol: string, confidence: number, correct: boolean, netReturn: number) {
    const doc = await this.ensure(modelKeyOrSymbol);
    const idx = this.bucketIndex(confidence, doc.buckets);

    const b = doc.buckets[idx];
    b.n = (b.n ?? 0) + 1;
    b.correct = (b.correct ?? 0) + (correct ? 1 : 0);
    b.sumNet = (b.sumNet ?? 0) + (netReturn ?? 0);

    await FractalOnlineCalibrationModel.updateOne(
      { symbol: modelKeyOrSymbol },
      { $set: { buckets: doc.buckets, updatedAt: new Date() } }
    );

    return { ok: true, idx, bucket: b };
  }

  // BLOCK 29.30: Bayesian calibration with credible intervals
  async score(modelKeyOrSymbol: string, confidence: number) {
    const doc = await this.ensure(modelKeyOrSymbol);
    const idx = this.bucketIndex(confidence, doc.buckets);
    const b = doc.buckets[idx];

    const priorA = DEFAULT_PRIOR_ALPHA;
    const priorB = DEFAULT_PRIOR_BETA;

    const n = Number(b.n ?? 0);
    const k = Number(b.correct ?? 0);

    const a = priorA + k;
    const bb = priorB + (n - k);

    const meanAcc = betaMean(a, bb);

    // 90% credible interval
    const lo = betaQuantile(0.05, a, bb);
    const hi = betaQuantile(0.95, a, bb);
    const width = hi - lo;

    // Uncertainty penalty: wide interval => reduce confidence
    const uncPenalty = Math.max(0.5, 1 - width);

    // Penalize tiny n
    const nPenalty = Math.max(0.6, Math.min(1, n / 50));

    // Calibrated probability multiplier relative to baseline ~0.55
    const mult = Math.max(0.5, Math.min(1.2, meanAcc / 0.55));

    const calibratedConfidence = confidence * mult * uncPenalty * nPenalty;

    return {
      calibratedConfidence,
      bucket: { idx, n, k, meanAcc, lo, hi, width },
      multipliers: { mult, uncPenalty, nPenalty },
      bucketAcc: meanAcc,
      mult,
      n,
      idx
    };
  }

  async getCalibration(modelKeyOrSymbol: string) {
    const doc = await this.ensure(modelKeyOrSymbol);
    
    const enriched = doc.buckets.map((b: any) => {
      const n = b.n ?? 0, k = b.correct ?? 0;
      const a = DEFAULT_PRIOR_ALPHA + k;
      const bb = DEFAULT_PRIOR_BETA + (n - k);
      return {
        range: `${b.lo}-${b.hi}`,
        n: b.n,
        accuracy: b.n > 0 ? b.correct / b.n : null,
        avgNet: b.n > 0 ? b.sumNet / b.n : null,
        bayes: {
          mean: betaMean(a, bb),
          lo: betaQuantile(0.05, a, bb),
          hi: betaQuantile(0.95, a, bb)
        }
      };
    });

    return {
      ok: true,
      modelKey: modelKeyOrSymbol,
      buckets: enriched,
      updatedAt: doc.updatedAt
    };
  }
}
