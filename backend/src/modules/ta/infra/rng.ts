/**
 * Phase S3.1: Seeded Random Number Generator
 * Deterministic random for RANSAC and other algorithms
 */

import { getConfig } from './config.js';

/**
 * Mulberry32 - fast seeded 32-bit PRNG
 */
export class SeededRNG {
  private state: number;
  
  constructor(seed?: number) {
    this.state = seed ?? getConfig().seed;
  }
  
  /**
   * Generate next random number in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  
  /**
   * Generate integer in [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  /**
   * Generate float in [min, max)
   */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  
  /**
   * Shuffle array in place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  /**
   * Select k random elements from array
   */
  sample<T>(array: T[], k: number): T[] {
    if (k >= array.length) return [...array];
    
    const copy = [...array];
    const result: T[] = [];
    
    for (let i = 0; i < k; i++) {
      const idx = this.nextInt(0, copy.length - 1);
      result.push(copy[idx]);
      copy.splice(idx, 1);
    }
    
    return result;
  }
  
  /**
   * Get current seed state
   */
  getState(): number {
    return this.state;
  }
  
  /**
   * Reset to specific seed
   */
  setSeed(seed: number): void {
    this.state = seed;
  }
}

// Global RNG instance
let globalRNG: SeededRNG | null = null;

/**
 * Get global seeded RNG
 */
export function getRNG(): SeededRNG {
  if (!globalRNG) {
    globalRNG = new SeededRNG();
  }
  return globalRNG;
}

/**
 * Create new RNG with specific seed
 */
export function createRNG(seed: number): SeededRNG {
  return new SeededRNG(seed);
}

/**
 * Reset global RNG to configured seed
 */
export function resetRNG(): void {
  const seed = getConfig().seed;
  if (globalRNG) {
    globalRNG.setSeed(seed);
  } else {
    globalRNG = new SeededRNG(seed);
  }
}
