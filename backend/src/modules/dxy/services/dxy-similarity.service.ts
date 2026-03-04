/**
 * DXY SIMILARITY SERVICE — Cosine Similarity
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

// ═══════════════════════════════════════════════════════════════
// COSINE SIMILARITY
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate cosine similarity between two vectors
 * Returns value in [0, 1] range (normalized from [-1, 1])
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  
  let dot = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] || 0;
    const valB = b[i] || 0;
    
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  
  // Clamp and normalize from [-1, 1] to [0, 1]
  const clamped = Math.max(-1, Math.min(1, raw));
  return (clamped + 1) / 2;
}

// ═══════════════════════════════════════════════════════════════
// EUCLIDEAN DISTANCE (alternative metric)
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate Euclidean distance (lower = more similar)
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    sum += diff * diff;
  }
  
  return Math.sqrt(sum);
}

// ═══════════════════════════════════════════════════════════════
// CORRELATION (Pearson)
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate Pearson correlation coefficient
 * Returns value in [-1, 1]
 */
export function pearsonCorrelation(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length < 2) return 0;
  
  const n = a.length;
  
  // Calculate means
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  
  for (let i = 0; i < n; i++) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    
    numerator += diffA * diffB;
    denomA += diffA * diffA;
    denomB += diffB * diffB;
  }
  
  if (denomA === 0 || denomB === 0) return 0;
  
  return numerator / Math.sqrt(denomA * denomB);
}
