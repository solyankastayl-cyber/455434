/**
 * BLOCK 2.7 — Pattern Cluster Types
 * ===================================
 */

import type { ObjectId } from 'mongodb';
import type { Horizon } from './types.js';

export type Window = '24h' | '7d';

export interface AltPatternCluster {
  _id?: ObjectId;
  horizon: Horizon;
  window: Window;
  asOf: Date;
  clusterId: string;
  size: number;
  prototype: Record<string, number>;
  topFeatures: Array<{ k: string; w: number }>;
  avgRetPct: number;
  winRate: number;
  lossRate: number;
  weakRate: number;
  symbols: Array<{ symbol: string; score: number }>;
  createdAt: Date;
}

export interface AltSymbolClusterAssignment {
  _id?: ObjectId;
  asOf: Date;
  horizon: Horizon;
  window: Window;
  symbol: string;
  clusterId: string;
  similarity: number;
  meta?: {
    fundingZ?: number;
    snapshotId?: ObjectId;
    predictionId?: ObjectId;
  };
  createdAt: Date;
}

console.log('[Alts] Pattern Cluster Types loaded');
