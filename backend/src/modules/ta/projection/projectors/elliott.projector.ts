/**
 * Phase AC1: Elliott Wave Projector
 * 
 * Implements wave target projections:
 * - Wave 3: 1.618 extension of Wave 1
 * - Wave 5: 0.618-1.0 of Wave 1-3
 * - ABC correction targets
 */

import { 
  Projector, 
  ProjectorContext, 
  Projection, 
  PatternLayer,
  ProjectionPath,
  getPatternPrior
} from '../projection_types.js';
import { v4 as uuid } from 'uuid';

const ELLIOTT_TYPES = ['ELLIOTT_5_WAVE', 'ELLIOTT_3_WAVE', 'CORRECTION_ABC'];

export class ElliottProjector implements Projector {
  id = 'elliott_projector';
  name = 'Elliott Wave Projector';
  supportedPatterns = ELLIOTT_TYPES;

  project(pattern: PatternLayer, context: ProjectorContext): Projection | null {
    if (!ELLIOTT_TYPES.includes(pattern.patternType)) {
      return null;
    }

    const prior = getPatternPrior(pattern.patternType);
    if (!prior) return null;

    const { points } = pattern;
    if (!points || points.length < 3) return null;

    // Determine wave structure
    const sortedPoints = [...points].sort((a, b) => a.x - b.x);
    
    if (pattern.patternType === 'ELLIOTT_5_WAVE') {
      return this.project5Wave(pattern, sortedPoints, context, prior);
    } else if (pattern.patternType === 'ELLIOTT_3_WAVE') {
      return this.project3Wave(pattern, sortedPoints, context, prior);
    } else {
      return this.projectABC(pattern, sortedPoints, context, prior);
    }
  }

  private project5Wave(
    pattern: PatternLayer,
    points: { x: number; y: number; label?: string }[],
    context: ProjectorContext,
    prior: { baseProbability: number; avgDurationBars: number }
  ): Projection | null {
    if (points.length < 5) return null;

    // Wave points: 0, 1, 2, 3, 4, 5
    const wave1Start = points[0].y;
    const wave1End = points[1].y;
    const wave1Length = Math.abs(wave1End - wave1Start);
    
    const isUptrend = wave1End > wave1Start;
    
    // Wave 5 target based on wave 1-3 projection
    const wave3End = points[3]?.y || wave1End;
    const wave4End = points[4]?.y || (wave3End + wave1Start) / 2;
    
    // Target: wave 5 = 0.618 to 1.0 of wave 1
    const wave5Target = isUptrend
      ? wave4End + wave1Length * 0.786
      : wave4End - wave1Length * 0.786;

    // Extended target
    const target2 = isUptrend
      ? wave4End + wave1Length * 1.0
      : wave4End - wave1Length * 1.0;

    const entry = context.currentPrice;
    const stop = isUptrend
      ? wave4End - context.atr * 0.5
      : wave4End + context.atr * 0.5;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(wave5Target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    const durationBars = prior.avgDurationBars;
    const path = this.buildPath(entry, wave5Target, durationBars, prior.baseProbability, isUptrend);
    const bands = this.buildBands(path, context.atr * 0.7);

    return {
      id: uuid(),
      kind: 'WAVE_TARGET',
      direction: isUptrend ? 'BULLISH' : 'BEARISH',
      path,
      bands,
      entry,
      target: wave5Target,
      target2,
      stop,
      riskReward,
      probability: this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context),
      rationale: [
        'Elliott 5-Wave impulse structure detected',
        `Wave 1 length: ${wave1Length.toFixed(2)}`,
        `Wave 5 target (0.786 ext): ${wave5Target.toFixed(2)}`,
        `Extended target (1.0 ext): ${target2.toFixed(2)}`,
        'Look for wave 5 completion divergence'
      ],
      sourcePatterns: [pattern.id]
    };
  }

  private project3Wave(
    pattern: PatternLayer,
    points: { x: number; y: number; label?: string }[],
    context: ProjectorContext,
    prior: { baseProbability: number; avgDurationBars: number }
  ): Projection | null {
    if (points.length < 3) return null;

    const wave1Length = Math.abs(points[1].y - points[0].y);
    const isUptrend = points[1].y > points[0].y;
    
    // Wave 3 extended: 1.618 to 2.618 of wave 1
    const wave2End = points[2]?.y || points[0].y;
    const wave3Target = isUptrend
      ? wave2End + wave1Length * 1.618
      : wave2End - wave1Length * 1.618;

    const target2 = isUptrend
      ? wave2End + wave1Length * 2.618
      : wave2End - wave1Length * 2.618;

    const entry = context.currentPrice;
    const stop = isUptrend
      ? wave2End - context.atr * 0.3
      : wave2End + context.atr * 0.3;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(wave3Target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    const path = this.buildPath(entry, wave3Target, prior.avgDurationBars, prior.baseProbability, isUptrend);
    const bands = this.buildBands(path, context.atr * 0.6);

    return {
      id: uuid(),
      kind: 'WAVE_TARGET',
      direction: isUptrend ? 'BULLISH' : 'BEARISH',
      path,
      bands,
      entry,
      target: wave3Target,
      target2,
      stop,
      riskReward,
      probability: this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context),
      rationale: [
        'Elliott Wave 3 extension detected',
        `Wave 1 length: ${wave1Length.toFixed(2)}`,
        `Wave 3 target (1.618 ext): ${wave3Target.toFixed(2)}`,
        `Extended target (2.618 ext): ${target2.toFixed(2)}`,
        'Wave 3 is typically the strongest wave'
      ],
      sourcePatterns: [pattern.id]
    };
  }

  private projectABC(
    pattern: PatternLayer,
    points: { x: number; y: number; label?: string }[],
    context: ProjectorContext,
    prior: { baseProbability: number; avgDurationBars: number }
  ): Projection | null {
    if (points.length < 3) return null;

    // ABC correction: A, B, C waves
    const aWaveLength = Math.abs(points[1].y - points[0].y);
    const isDownCorrection = points[1].y < points[0].y;
    
    const bWaveEnd = points[2]?.y || points[0].y;
    
    // C wave target: typically 0.618 to 1.0 of A wave
    const cTarget = isDownCorrection
      ? bWaveEnd - aWaveLength * 1.0
      : bWaveEnd + aWaveLength * 1.0;

    const target2 = isDownCorrection
      ? bWaveEnd - aWaveLength * 1.618
      : bWaveEnd + aWaveLength * 1.618;

    const entry = context.currentPrice;
    const stop = isDownCorrection
      ? bWaveEnd + context.atr * 0.3
      : bWaveEnd - context.atr * 0.3;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(cTarget - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    const path = this.buildPath(entry, cTarget, prior.avgDurationBars, prior.baseProbability, !isDownCorrection);
    const bands = this.buildBands(path, context.atr * 0.55);

    return {
      id: uuid(),
      kind: 'WAVE_TARGET',
      direction: isDownCorrection ? 'BEARISH' : 'BULLISH',
      path,
      bands,
      entry,
      target: cTarget,
      target2,
      stop,
      riskReward,
      probability: this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context),
      rationale: [
        'ABC correction pattern detected',
        `A wave length: ${aWaveLength.toFixed(2)}`,
        `C wave target (1.0 of A): ${cTarget.toFixed(2)}`,
        `Extended C target (1.618): ${target2.toFixed(2)}`,
        'Correction may complete near C target'
      ],
      sourcePatterns: [pattern.id]
    };
  }

  private buildPath(
    currentPrice: number,
    target: number,
    durationBars: number,
    baseProbability: number,
    isUptrend: boolean
  ): ProjectionPath {
    const path: ProjectionPath = [];
    const priceMove = target - currentPrice;
    
    for (let t = 0; t <= durationBars; t++) {
      const progress = t / durationBars;
      // Elliott waves have impulsive character
      const eased = 1 - Math.pow(1 - progress, 1.8);
      
      const price = currentPrice + priceMove * eased;
      const prob = baseProbability * (1 - progress * 0.25);
      
      path.push({ t, price, probability: Math.max(0.32, prob) });
    }
    
    return path;
  }

  private buildBands(path: ProjectionPath, bandwidth: number): { low: number[]; high: number[] } {
    return {
      low: path.map((p, i) => p.price - bandwidth * (1 + i / path.length * 0.5)),
      high: path.map((p, i) => p.price + bandwidth * (1 + i / path.length * 0.5))
    };
  }

  private calculateProbability(
    baseProbability: number,
    patternScore: number,
    riskReward: number,
    context: ProjectorContext
  ): number {
    let prob = baseProbability;
    
    prob *= 0.65 + patternScore * 0.35;
    
    if (riskReward >= 2.5) prob *= 1.1;
    else if (riskReward >= 1.5) prob *= 1.05;
    else if (riskReward < 1) prob *= 0.8;
    
    return Math.min(0.75, Math.max(0.3, prob));
  }
}

export const elliottProjector = new ElliottProjector();
