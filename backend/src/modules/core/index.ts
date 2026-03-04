/**
 * CORE MODULE — Shared Utilities
 * 
 * This module contains shared types, utilities, and math functions
 * that can be imported by btc/*, spx/*, and combined/*.
 * 
 * NO business logic here - only pure utilities.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Asset = 'BTC' | 'SPX' | 'ETH';
export type Product = 'BTC_TERMINAL' | 'SPX_TERMINAL' | 'COMBINED_TERMINAL';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Trend = 'UP' | 'DOWN' | 'FLAT';
export type Severity = 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
export type ConflictLevel = 'LOW' | 'MODERATE' | 'HIGH';
export type DominanceTier = 'STRUCTURE' | 'TACTICAL' | 'TIMING';
export type VolRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'CRISIS';

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TimeRange {
  from: string;  // YYYY-MM-DD
  to: string;    // YYYY-MM-DD
}

// ═══════════════════════════════════════════════════════════════
// MATH UTILITIES
// ═══════════════════════════════════════════════════════════════

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return round((part / total) * 100, 1);
}

export function gradeToIndex(grade: Grade): number {
  const map: Record<Grade, number> = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  return map[grade];
}

export function indexToGrade(index: number): Grade {
  if (index <= 1) return 'A';
  if (index <= 2) return 'B';
  if (index <= 3) return 'C';
  if (index <= 4) return 'D';
  return 'F';
}

export function scoreToGrade(score: number): Grade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

// ═══════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// ═══════════════════════════════════════════════════════════════
// GUARDS
// ═══════════════════════════════════════════════════════════════

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`);
}

export function isValidGrade(value: string): value is Grade {
  return ['A', 'B', 'C', 'D', 'F'].includes(value);
}

export function isValidAsset(value: string): value is Asset {
  return ['BTC', 'SPX', 'ETH'].includes(value);
}
