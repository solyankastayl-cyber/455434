/**
 * PHASE 3.2 — Logistic Regression Model
 * ======================================
 * Pure TypeScript implementation (no external deps)
 */

function sigmoid(z: number): number {
  // Numeric stability
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  } else {
    const ez = Math.exp(z);
    return ez / (1 + ez);
  }
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] || 0) * (b[i] || 0);
  }
  return sum;
}

export interface LogRegParams {
  weights: number[];
  bias: number;
}

export interface LogRegConfig {
  lr?: number;
  epochs?: number;
  l2?: number;
}

export class LogisticRegression {
  params: LogRegParams;
  
  constructor(params?: Partial<LogRegParams>) {
    this.params = {
      weights: params?.weights ?? [],
      bias: params?.bias ?? 0,
    };
  }
  
  fit(X: number[][], y: number[], cfg: LogRegConfig = {}): LogRegParams {
    const lr = cfg.lr ?? 0.05;
    const epochs = cfg.epochs ?? 300;
    const l2 = cfg.l2 ?? 1e-4;
    
    const n = X.length;
    const m = X[0]?.length ?? 0;
    
    if (!this.params.weights.length) {
      this.params.weights = new Array(m).fill(0);
    }
    
    for (let ep = 0; ep < epochs; ep++) {
      let dB = 0;
      const dW = new Array(m).fill(0);
      
      for (let i = 0; i < n; i++) {
        const xi = X[i];
        let z = this.params.bias;
        for (let j = 0; j < m; j++) {
          z += this.params.weights[j] * (xi[j] || 0);
        }
        const p = sigmoid(z);
        const err = p - y[i];
        
        dB += err;
        for (let j = 0; j < m; j++) {
          dW[j] += err * (xi[j] || 0);
        }
      }
      
      // Average gradients + L2 regularization
      dB /= Math.max(1, n);
      for (let j = 0; j < m; j++) {
        dW[j] = dW[j] / Math.max(1, n) + l2 * this.params.weights[j];
      }
      
      // Update
      this.params.bias -= lr * dB;
      for (let j = 0; j < m; j++) {
        this.params.weights[j] -= lr * dW[j];
      }
    }
    
    return this.params;
  }
  
  predictProbaOne(x: number[]): number {
    let z = this.params.bias;
    for (let j = 0; j < this.params.weights.length; j++) {
      z += this.params.weights[j] * (x[j] ?? 0);
    }
    return sigmoid(z);
  }
  
  predictProba(X: number[][]): number[] {
    return X.map((row) => this.predictProbaOne(row));
  }
  
  predict(X: number[][], threshold = 0.5): number[] {
    return this.predictProba(X).map((p) => (p >= threshold ? 1 : 0));
  }
  
  getWeights(): number[] {
    return [...this.params.weights];
  }
  
  getBias(): number {
    return this.params.bias;
  }
  
  // Feature importance (absolute weights)
  getFeatureImportance(featureNames: string[]): Array<{ name: string; importance: number }> {
    return featureNames
      .map((name, i) => ({
        name,
        importance: Math.abs(this.params.weights[i] || 0),
      }))
      .sort((a, b) => b.importance - a.importance);
  }
}

console.log('[Phase 3.2] LogReg Model loaded');
