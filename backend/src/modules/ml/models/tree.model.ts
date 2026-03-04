/**
 * PHASE 3.2 — Decision Tree Model
 * ================================
 * Tiny CART implementation (depth <= 4)
 */

export type TreeNode =
  | { type: 'leaf'; p: number; n: number }
  | { type: 'split'; feature: number; threshold: number; left: TreeNode; right: TreeNode };

function gini(p1: number): number {
  return 1 - (p1 * p1 + (1 - p1) * (1 - p1));
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export interface TreeConfig {
  maxDepth?: number;
  minLeaf?: number;
}

export class TinyDecisionTree {
  root: TreeNode | null = null;
  
  fit(X: number[][], y: number[], cfg: TreeConfig = {}): TreeNode {
    const maxDepth = cfg.maxDepth ?? 4;
    const minLeaf = cfg.minLeaf ?? 20;
    
    const idx = Array.from({ length: X.length }, (_, i) => i);
    this.root = this.buildNode(X, y, idx, 0, maxDepth, minLeaf);
    return this.root;
  }
  
  private buildNode(
    X: number[][],
    y: number[],
    idx: number[],
    depth: number,
    maxDepth: number,
    minLeaf: number
  ): TreeNode {
    const yVals = idx.map((i) => y[i]);
    const p = mean(yVals);
    
    // Stopping conditions
    if (depth >= maxDepth || idx.length <= minLeaf) {
      return { type: 'leaf', p, n: idx.length };
    }
    
    const m = X[0]?.length ?? 0;
    let bestGain = 0;
    let best: { feature: number; threshold: number; left: number[]; right: number[] } | null = null;
    
    const parentImp = gini(p);
    
    for (let f = 0; f < m; f++) {
      // Sample candidate thresholds
      const values = idx
        .map((i) => X[i][f])
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
      
      if (values.length < minLeaf) continue;
      
      // Quantile-based thresholds
      const candidates = [
        values[Math.floor(values.length * 0.2)],
        values[Math.floor(values.length * 0.4)],
        values[Math.floor(values.length * 0.6)],
        values[Math.floor(values.length * 0.8)],
      ].filter((v, i, a) => i === 0 || v !== a[i - 1]);
      
      for (const thr of candidates) {
        const left: number[] = [];
        const right: number[] = [];
        
        for (const i of idx) {
          if ((X[i][f] ?? 0) <= thr) {
            left.push(i);
          } else {
            right.push(i);
          }
        }
        
        if (left.length < minLeaf || right.length < minLeaf) continue;
        
        const pL = mean(left.map((i) => y[i]));
        const pR = mean(right.map((i) => y[i]));
        const imp =
          (left.length / idx.length) * gini(pL) +
          (right.length / idx.length) * gini(pR);
        const gain = parentImp - imp;
        
        if (gain > bestGain) {
          bestGain = gain;
          best = { feature: f, threshold: thr, left, right };
        }
      }
    }
    
    if (!best || bestGain <= 1e-6) {
      return { type: 'leaf', p, n: idx.length };
    }
    
    return {
      type: 'split',
      feature: best.feature,
      threshold: best.threshold,
      left: this.buildNode(X, y, best.left, depth + 1, maxDepth, minLeaf),
      right: this.buildNode(X, y, best.right, depth + 1, maxDepth, minLeaf),
    };
  }
  
  predictProbaOne(x: number[]): number {
    if (!this.root) return 0.5;
    
    let node: TreeNode = this.root;
    while (node.type === 'split') {
      const v = x[node.feature] ?? 0;
      node = v <= node.threshold ? node.left : node.right;
    }
    return node.p;
  }
  
  predictProba(X: number[][]): number[] {
    return X.map((row) => this.predictProbaOne(row));
  }
  
  predict(X: number[][], threshold = 0.5): number[] {
    return this.predictProba(X).map((p) => (p >= threshold ? 1 : 0));
  }
  
  // Serialize tree for storage
  serialize(): any {
    return this.root;
  }
  
  // Load from serialized
  load(tree: any): void {
    this.root = tree;
  }
  
  // Get feature importance (split frequency)
  getFeatureImportance(featureNames: string[]): Array<{ name: string; importance: number }> {
    const counts: Record<number, number> = {};
    
    const traverse = (node: TreeNode | null) => {
      if (!node || node.type === 'leaf') return;
      counts[node.feature] = (counts[node.feature] || 0) + 1;
      traverse(node.left);
      traverse(node.right);
    };
    
    traverse(this.root);
    
    return featureNames
      .map((name, i) => ({
        name,
        importance: counts[i] || 0,
      }))
      .sort((a, b) => b.importance - a.importance);
  }
}

console.log('[Phase 3.2] Tree Model loaded');
