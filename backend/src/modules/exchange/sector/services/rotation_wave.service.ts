/**
 * BLOCK 2.9 — Rotation Wave Service
 * ==================================
 * Finds "next wave" candidates based on sector winners.
 */

import type { Db, Collection } from 'mongodb';
import type { Sector, WaveCandidate, SectorState } from '../types/sector.types.js';
import { sectorStateService, FeatureSnapshot } from './sector_state.service.js';
import { assetTagsStore } from '../db/asset_tags.model.js';

// Cosine similarity
function dot(a: Record<string, number>, b: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(a)) {
    s += (a[k] ?? 0) * (b[k] ?? 0);
  }
  return s;
}

function norm(a: Record<string, number>): number {
  return Math.sqrt(dot(a, a)) || 1e-9;
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  return dot(a, b) / (norm(a) * norm(b));
}

const MOVE_THRESHOLD = 2.0; // 2% = "already moved"

export class RotationWaveService {
  private snapshotCol: Collection<FeatureSnapshot> | null = null;

  init(db: Db) {
    this.snapshotCol = db.collection<FeatureSnapshot>('exchange_symbol_snapshots');
  }

  /**
   * Find "next wave" candidates within a sector
   */
  async findNextWaveCandidates(
    sector: Sector,
    window: '4h' | '24h' = '4h',
    limit = 10
  ): Promise<WaveCandidate[]> {
    const symbols = await assetTagsStore.getSymbolsBySector(sector);
    if (symbols.length === 0) return [];

    // Get all snapshots
    const snapshots = await this.getSnapshotsForSymbols(symbols);
    if (snapshots.length === 0) return [];

    // Identify winners (already moved significantly)
    const winners: FeatureSnapshot[] = [];
    const notMoved: FeatureSnapshot[] = [];

    for (const snap of snapshots) {
      const change = Math.abs(snap.priceChg24h ?? 0);
      if (change >= MOVE_THRESHOLD) {
        winners.push(snap);
      } else {
        notMoved.push(snap);
      }
    }

    if (winners.length === 0 || notMoved.length === 0) {
      return [];
    }

    // Build winners centroid (average feature vector)
    const centroid: Record<string, number> = {};
    let count = 0;

    for (const w of winners) {
      const features = this.extractNumericFeatures(w);
      for (const [k, v] of Object.entries(features)) {
        centroid[k] = (centroid[k] ?? 0) + v;
      }
      count++;
    }

    // Normalize centroid
    for (const k of Object.keys(centroid)) {
      centroid[k] /= count;
    }

    // Compute expected move from winners
    const winnerMoves = winners.map(w => Math.abs(w.priceChg24h ?? 0));
    const expectedMoveStrength = winnerMoves.reduce((a, b) => a + b, 0) / winnerMoves.length;

    // Score not-moved candidates by similarity to centroid
    const candidates: WaveCandidate[] = [];
    const waveId = `W_${sector}_${Date.now()}`;

    for (const snap of notMoved) {
      const features = this.extractNumericFeatures(snap);
      const similarity = cosine(features, centroid);

      const symbol = snap.base ?? snap.symbolKey?.split(':')[0] ?? 'UNKNOWN';

      // Compute final score
      const finalPickScore = similarity * 0.7 + (1 - Math.abs(snap.priceChg24h ?? 0) / 10) * 0.3;

      // Build reasons
      const reasons: string[] = [];
      if (similarity > 0.9) reasons.push('high_similarity_to_winners');
      if (similarity > 0.8) reasons.push('similar_pattern');
      if ((snap.priceChg24h ?? 0) < 1) reasons.push('not_moved_yet');

      // Check funding
      const fundingZ = snap.features?.funding_z;
      if (fundingZ != null && Math.abs(Number(fundingZ)) < 1) {
        reasons.push('funding_ok');
      }

      candidates.push({
        symbol: symbol + 'USDT',
        sector,
        waveId,
        similarityToWinners: similarity,
        alreadyMoved: false,
        expectedMoveStrength,
        finalPickScore,
        reasons,
      });
    }

    // Sort by final score
    candidates.sort((a, b) => b.finalPickScore - a.finalPickScore);
    return candidates.slice(0, limit);
  }

  /**
   * Get picks for a sector with full context
   */
  async getSectorPicks(
    sector: Sector,
    window: '4h' | '24h' = '4h',
    limit = 10
  ): Promise<{
    sector: Sector;
    sectorState: SectorState | null;
    picks: WaveCandidate[];
    nextWave: WaveCandidate[];
  }> {
    const sectorState = await sectorStateService.computeSectorState(sector, window);
    const nextWave = await this.findNextWaveCandidates(sector, window, limit);

    // Top picks are simply the next wave with highest scores
    const picks = nextWave.filter(c => c.finalPickScore > 0.5);

    return {
      sector,
      sectorState,
      picks,
      nextWave,
    };
  }

  /**
   * Get snapshots for symbols
   */
  private async getSnapshotsForSymbols(symbols: string[]): Promise<FeatureSnapshot[]> {
    if (!this.snapshotCol) return [];

    const results: FeatureSnapshot[] = [];

    for (const symbol of symbols) {
      const base = symbol.replace('USDT', '');

      const snap = await this.snapshotCol
        .find({
          $or: [
            { base },
            { symbolKey: { $regex: `^${base}:` } },
          ]
        })
        .sort({ ts: -1 })
        .limit(1)
        .toArray();

      if (snap.length > 0) {
        results.push(snap[0]);
      }
    }

    return results;
  }

  /**
   * Extract numeric features from snapshot
   */
  private extractNumericFeatures(snap: FeatureSnapshot): Record<string, number> {
    const result: Record<string, number> = {};

    for (const [k, v] of Object.entries(snap.features ?? {})) {
      if (v != null && typeof v === 'number' && isFinite(v)) {
        result[k] = v;
      }
    }

    return result;
  }
}

export const rotationWaveService = new RotationWaveService();

console.log('[Sector] Rotation Wave Service loaded');
