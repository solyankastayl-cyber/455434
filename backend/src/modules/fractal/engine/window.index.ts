/**
 * Window Index Service
 * Pre-computes window vectors for fast pattern matching
 */

import { SimilarityEngine } from './similarity.engine.js';

export type WindowLen = 30 | 60 | 90;

export interface WindowVec {
  endIdx: number;      // index in closes (end of window)
  startIdx: number;    // index in closes (start of window)
  startTs: Date;
  endTs: Date;
  vec: number[];       // z-scored returns vector
  norm: number;        // L2 norm of vec
}

export class WindowIndex {
  private sim = new SimilarityEngine();
  private indexByLen: Map<WindowLen, WindowVec[]> = new Map();
  private builtAt: number | null = null;

  getBuiltAt(): number | null {
    return this.builtAt;
  }

  buildAll(ts: Date[], closes: number[], lens: WindowLen[], horizonDays: number): void {
    // Returns length = closes.length - 1
    const returns = this.sim.buildLogReturns(closes);

    for (const len of lens) {
      const windows: WindowVec[] = [];

      // For each window ending at returns index `end`,
      // closes end index = end, closes start index = end - len
      for (let end = len; end < returns.length - horizonDays; end++) {
        const slice = returns.slice(end - len, end);
        const z = this.sim.zScoreNormalize(slice);

        // Calculate L2 norm
        let norm = 0;
        for (let i = 0; i < z.length; i++) norm += z[i] * z[i];
        norm = Math.sqrt(norm) || 1;

        const endIdx = end;            // closes index
        const startIdx = end - len;    // closes index

        windows.push({
          endIdx,
          startIdx,
          startTs: ts[startIdx],
          endTs: ts[endIdx],
          vec: z,
          norm
        });
      }

      this.indexByLen.set(len, windows);
    }

    this.builtAt = Date.now();
    console.log(`[WindowIndex] Built indices for lens: ${lens.join(', ')}`);
  }

  get(len: WindowLen): WindowVec[] {
    return this.indexByLen.get(len) || [];
  }

  clear(): void {
    this.indexByLen.clear();
    this.builtAt = null;
  }
}
