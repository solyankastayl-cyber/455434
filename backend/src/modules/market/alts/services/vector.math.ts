/**
 * BLOCK 2.7 — Vector Math Utils
 * ===============================
 * Simple math operations for clustering.
 */

export function dot(a: Record<string, number>, b: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(a)) {
    s += (a[k] ?? 0) * (b[k] ?? 0);
  }
  return s;
}

export function norm(a: Record<string, number>): number {
  return Math.sqrt(dot(a, a)) || 1e-9;
}

export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  return dot(a, b) / (norm(a) * norm(b));
}

export function addVec(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  }
  return out;
}

export function scaleVec(a: Record<string, number>, s: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(a)) {
    out[k] = (a[k] ?? 0) * s;
  }
  return out;
}

export function subtractVec(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = (out[k] ?? 0) - (b[k] ?? 0);
  }
  return out;
}

console.log('[Alts] Vector Math loaded');
