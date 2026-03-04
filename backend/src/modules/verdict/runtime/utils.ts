/**
 * VERDICT UTILS
 */

import crypto from "node:crypto";
import type { RiskLevel } from "../contracts/verdict.types.js";

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function clamp(x: number, a: number, b: number): number {
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

export function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

export function bumpRisk(r: RiskLevel, bump: number): RiskLevel {
  const order: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];
  const idx = Math.max(0, Math.min(order.length - 1, order.indexOf(r) + bump));
  return order[idx];
}

console.log('[Verdict] Utils loaded');
