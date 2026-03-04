/**
 * BATCH 3: Binary Metrics Calculator
 * 
 * Вычисляет accuracy, precision, recall, f1 для бинарной классификации.
 */

export type BinaryLabel = 0 | 1;

export interface BinaryMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
}

/**
 * Convert probability to binary label
 */
export function toLabelFromProb(pUp: number, threshold = 0.5): BinaryLabel {
  return pUp >= threshold ? 1 : 0;
}

/**
 * Compute binary classification metrics
 */
export function computeBinaryMetrics(yTrue: BinaryLabel[], yPred: BinaryLabel[]): BinaryMetrics {
  if (yTrue.length !== yPred.length) {
    throw new Error('Metrics: yTrue/yPred length mismatch');
  }
  
  const n = yTrue.length;
  if (n === 0) {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      confusion: { tp: 0, fp: 0, tn: 0, fn: 0 },
    };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  
  for (let i = 0; i < n; i++) {
    const t = yTrue[i];
    const p = yPred[i];
    
    if (t === 1 && p === 1) tp++;
    else if (t === 0 && p === 1) fp++;
    else if (t === 0 && p === 0) tn++;
    else fn++;
  }

  const accuracy = (tp + tn) / n;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    accuracy: Math.round(accuracy * 10000) / 10000,
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    confusion: { tp, fp, tn, fn },
  };
}

/**
 * Compute metrics delta between two models
 */
export function computeDelta(active: BinaryMetrics, shadow: BinaryMetrics) {
  return {
    accuracyDelta: Math.round((shadow.accuracy - active.accuracy) * 10000) / 10000,
    f1Delta: Math.round((shadow.f1 - active.f1) * 10000) / 10000,
    precisionDelta: Math.round((shadow.precision - active.precision) * 10000) / 10000,
    recallDelta: Math.round((shadow.recall - active.recall) * 10000) / 10000,
  };
}
