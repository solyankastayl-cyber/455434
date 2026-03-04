/**
 * DXY SCAN SERVICE — Fractal Pattern Matching
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { normalizeWindow } from './dxy-normalize.service.js';
import { cosineSimilarity } from './dxy-similarity.service.js';
import { DXY_SCAN_CONFIG, type DxyMatch } from '../contracts/dxy.types.js';

// ═══════════════════════════════════════════════════════════════
// SCAN CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const { windowLength, similarityThreshold, topK } = DXY_SCAN_CONFIG;

// ═══════════════════════════════════════════════════════════════
// MAIN SCAN FUNCTION
// ═══════════════════════════════════════════════════════════════

export interface ScanResult {
  matches: DxyMatch[];
  diagnostics: {
    totalWindowsScanned: number;
    matchesFound: number;
    avgSimilarity: number;
    entropy: number;
  };
}

export function scanDxyFractals(
  candles: { close: number; date: string }[],
  config?: { windowLen?: number; threshold?: number; top?: number }
): ScanResult {
  const winLen = config?.windowLen || windowLength;
  const threshold = config?.threshold || similarityThreshold;
  const top = config?.top || topK;
  
  // Need at least 2x window for meaningful scan
  if (!candles || candles.length < winLen * 2) {
    return {
      matches: [],
      diagnostics: {
        totalWindowsScanned: 0,
        matchesFound: 0,
        avgSimilarity: 0,
        entropy: 1,
      },
    };
  }
  
  const closes = candles.map(c => c.close);
  
  // Current window (last N candles)
  const currentWindow = closes.slice(-winLen);
  const normalizedCurrent = normalizeWindow(currentWindow);
  
  if (normalizedCurrent.length === 0) {
    return {
      matches: [],
      diagnostics: {
        totalWindowsScanned: 0,
        matchesFound: 0,
        avgSimilarity: 0,
        entropy: 1,
      },
    };
  }
  
  const matches: DxyMatch[] = [];
  let totalScanned = 0;
  
  // Scan historical windows
  // Exclude overlap with current window (last winLen * 2 candles)
  const maxStart = closes.length - winLen * 2;
  
  for (let i = 0; i < maxStart; i++) {
    totalScanned++;
    
    const histWindow = closes.slice(i, i + winLen);
    const normalizedHist = normalizeWindow(histWindow);
    
    if (normalizedHist.length === 0) continue;
    
    const similarity = cosineSimilarity(normalizedCurrent, normalizedHist);
    
    if (similarity >= threshold) {
      matches.push({
        similarity,
        startIndex: i,
        endIndex: i + winLen - 1,
        startDate: candles[i].date,
        endDate: candles[i + winLen - 1].date,
      });
    }
  }
  
  // Sort by similarity (descending) and take top K
  matches.sort((a, b) => b.similarity - a.similarity);
  const topMatches = matches.slice(0, top);
  
  // Calculate diagnostics
  const avgSimilarity = topMatches.length > 0
    ? topMatches.reduce((s, m) => s + m.similarity, 0) / topMatches.length
    : 0;
  
  return {
    matches: topMatches,
    diagnostics: {
      totalWindowsScanned: totalScanned,
      matchesFound: matches.length,
      avgSimilarity,
      entropy: 1 - avgSimilarity, // Higher entropy = less certainty
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// FIND SINGLE BEST MATCH
// ═══════════════════════════════════════════════════════════════

export function findBestDxyMatch(
  candles: { close: number; date: string }[]
): DxyMatch | null {
  const result = scanDxyFractals(candles, { top: 1 });
  return result.matches[0] || null;
}
