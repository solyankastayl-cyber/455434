/**
 * BLOCK 2.8 — Funding Observation Model
 * ======================================
 * Multi-venue funding rate observations for feature building.
 */

import type { ObjectId } from 'mongodb';

export type FundingVenueType = 'binance' | 'bybit' | 'hyperliquid';

export interface FundingObservation {
  _id?: ObjectId;
  ts: Date;
  symbol: string;
  venue: FundingVenueType;

  fundingRate: number;         // raw funding (e.g. 0.01%)
  intervalHours: number;       // 8, 1, etc
  annualized: number;          // normalized annual rate

  // Optional metadata
  markPrice?: number;
  openInterestUsd?: number;

  createdAt: Date;
}

export interface FundingState {
  mean: number;           // average funding across venues
  max: number;
  min: number;
  dispersion: number;     // stddev across venues
  dominantVenue: string;
  zScore: number;         // relative to 30d history
}

console.log('[Funding] Observation Model loaded');
