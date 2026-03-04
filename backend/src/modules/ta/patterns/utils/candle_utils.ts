/**
 * Phase R: Candle Utilities
 */

import { Candle } from './pattern_types.js';

export function body(c: Candle): number {
  return Math.abs(c.c - c.o);
}

export function range(c: Candle): number {
  return c.h - c.l;
}

export function upperWick(c: Candle): number {
  return c.h - Math.max(c.o, c.c);
}

export function lowerWick(c: Candle): number {
  return Math.min(c.o, c.c) - c.l;
}

export function isBullish(c: Candle): boolean {
  return c.c > c.o;
}

export function isBearish(c: Candle): boolean {
  return c.c < c.o;
}

export function bodyPct(c: Candle): number {
  return body(c) / Math.max(1e-9, range(c));
}

export function candleRange(c: Candle): number {
  return (c.h - c.l) / c.c;
}
