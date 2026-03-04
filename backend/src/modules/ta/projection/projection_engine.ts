/**
 * Phase AC: Projection Engine
 * 
 * Main orchestrator for generating RenderPack:
 * 1. Converts patterns to PatternLayers
 * 2. Builds confirmation stack
 * 3. Generates projections using projectors
 * 4. Assembles final RenderPack
 */

import { 
  RenderPack, 
  RenderLayer, 
  PatternLayer, 
  LevelLayer,
  MALayer,
  FibLayer,
  Projection,
  ProjectorContext,
  Projector
} from './projection_types.js';
import { triangleProjector } from './projectors/triangle.projector.js';
import { flagProjector } from './projectors/flag.projector.js';
import { hsShouldersProjector } from './projectors/hs.projector.js';
import { harmonicProjector } from './projectors/harmonic.projector.js';
import { elliottProjector } from './projectors/elliott.projector.js';
import { channelProjector } from './projectors/channel.projector.js';
import { ScoredPattern } from '../scoring/score.js';
import { TAContext, LevelZone } from '../domain/types.js';
import { v4 as uuid } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// PROJECTOR REGISTRY
// ═══════════════════════════════════════════════════════════════

const PROJECTORS: Projector[] = [
  triangleProjector,
  flagProjector,
  hsShouldersProjector,
  harmonicProjector,
  elliottProjector,
  channelProjector
];

function findProjector(patternType: string): Projector | null {
  return PROJECTORS.find(p => p.supportedPatterns.includes(patternType)) || null;
}

// ═══════════════════════════════════════════════════════════════
// LAYER BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildPatternLayer(pattern: ScoredPattern, totalScore: number): PatternLayer {
  const contribution = totalScore > 0 ? (pattern.scoring?.score || 0) / totalScore : 0;
  const geometry = pattern.geometry || {};
  
  return {
    kind: 'PATTERN',
    id: pattern.id,
    patternType: pattern.type,
    direction: pattern.direction,
    points: geometry.pivots?.map((p: any) => ({
      x: p.i || p.x || 0,
      y: p.price || p.y || 0,
      label: p.type || p.label || ''
    })) || [],
    lines: geometry.lines?.map((l: any) => ({
      x1: l.x1 || 0,
      y1: l.y1 || 0,
      x2: l.x2 || 0,
      y2: l.y2 || 0,
      style: 'solid' as const
    })) || [],
    zones: geometry.zones?.map((z: any) => ({
      price: z.price || 0,
      band: z.band || 0,
      type: 'target' as const
    })) || [],
    score: pattern.scoring?.score || pattern.metrics?.totalScore || 0.5,
    contribution,
    reasons: pattern.scoring?.reasons?.map((r: any) => 
      `${r.factor}: ${((r.contribution || 0) * 100).toFixed(0)}%`
    ) || []
  };
}

function buildLevelLayer(levels: LevelZone[]): LevelLayer {
  return {
    kind: 'LEVELS',
    zones: levels.map(l => ({
      price: l.price,
      band: l.band,
      type: l.type.toLowerCase() as 'support' | 'resistance',
      strength: l.strength
    })),
    contribution: levels.length > 0 ? 0.15 : 0
  };
}

function buildMALayer(ctx: TAContext): MALayer {
  const lastIdx = ctx.series.candles.length - 1;
  
  const ma50 = ctx.ma50[lastIdx];
  const ma200 = ctx.ma200[lastIdx];
  const slope50 = ctx.maSlope50[lastIdx];
  const slope200 = ctx.maSlope200[lastIdx];
  
  // Determine alignment
  let alignment: 'BULL' | 'BEAR' | 'MIXED' = 'MIXED';
  const currentPrice = ctx.series.candles[lastIdx].close;
  
  if (currentPrice > ma50 && ma50 > ma200 && slope50 > 0) {
    alignment = 'BULL';
  } else if (currentPrice < ma50 && ma50 < ma200 && slope50 < 0) {
    alignment = 'BEAR';
  }
  
  return {
    kind: 'MA',
    lines: [
      { period: 50, values: ctx.ma50.slice(-20), slope: slope50, color: '#3b82f6' },
      { period: 200, values: ctx.ma200.slice(-20), slope: slope200, color: '#f59e0b' }
    ],
    alignment,
    contribution: alignment !== 'MIXED' ? 0.12 : 0.05
  };
}

function buildFibLayer(ctx: TAContext): FibLayer | null {
  const { featuresPack } = ctx;
  if (!featuresPack?.fib?.swing) return null;
  
  const { swing, retrace, ext } = featuresPack.fib;
  if (!swing || !retrace) return null;
  
  const levels: Array<{ ratio: number; price: number; label: string; isGoldenPocket?: boolean }> = [];
  
  levels.push({ ratio: 0.236, price: retrace.r236, label: '23.6%' });
  levels.push({ ratio: 0.382, price: retrace.r382, label: '38.2%' });
  levels.push({ ratio: 0.5, price: retrace.r50, label: '50%' });
  levels.push({ ratio: 0.618, price: retrace.r618, label: '61.8%', isGoldenPocket: true });
  levels.push({ ratio: 0.786, price: retrace.r786, label: '78.6%' });
  
  if (ext) {
    levels.push({ ratio: 1.272, price: ext.e1272, label: '127.2%' });
    levels.push({ ratio: 1.618, price: ext.e1618, label: '161.8%' });
  }
  
  return {
    kind: 'FIBONACCI',
    swing: {
      from: { x: swing.fromIdx, y: swing.fromPrice },
      to: { x: swing.toIdx, y: swing.toPrice },
      direction: swing.dir
    },
    levels,
    contribution: retrace.priceInGoldenPocket ? 0.18 : 0.08
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFIRMATION STACK
// ═══════════════════════════════════════════════════════════════

interface ConfirmationFactor {
  factor: string;
  contribution: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

function buildConfirmationStack(
  layers: RenderLayer[],
  projections: Projection[]
): ConfirmationFactor[] {
  const stack: ConfirmationFactor[] = [];
  
  // Add pattern confirmations
  for (const layer of layers) {
    if (layer.kind === 'PATTERN' && layer.contribution > 0.05) {
      stack.push({
        factor: layer.patternType,
        contribution: layer.contribution,
        direction: layer.direction
      });
    }
  }
  
  // Add MA confirmation
  const maLayer = layers.find(l => l.kind === 'MA') as MALayer | undefined;
  if (maLayer && maLayer.alignment !== 'MIXED') {
    stack.push({
      factor: 'MA_ALIGNMENT',
      contribution: maLayer.contribution,
      direction: maLayer.alignment === 'BULL' ? 'BULLISH' : 'BEARISH'
    });
  }
  
  // Add level confirmation
  const levelLayer = layers.find(l => l.kind === 'LEVELS') as LevelLayer | undefined;
  if (levelLayer && levelLayer.zones.length > 0) {
    stack.push({
      factor: 'SR_LEVELS',
      contribution: levelLayer.contribution,
      direction: 'NEUTRAL'
    });
  }
  
  // Add Fib confirmation
  const fibLayer = layers.find(l => l.kind === 'FIBONACCI') as FibLayer | undefined;
  if (fibLayer && fibLayer.contribution > 0.1) {
    stack.push({
      factor: 'FIBONACCI_CONFLUENCE',
      contribution: fibLayer.contribution,
      direction: 'NEUTRAL'
    });
  }
  
  // Sort by contribution
  return stack.sort((a, b) => b.contribution - a.contribution);
}

// ═══════════════════════════════════════════════════════════════
// DOMINANT DIRECTION
// ═══════════════════════════════════════════════════════════════

function calculateDominantDirection(
  stack: ConfirmationFactor[]
): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  let bullScore = 0;
  let bearScore = 0;
  
  for (const factor of stack) {
    if (factor.direction === 'BULLISH') {
      bullScore += factor.contribution;
    } else if (factor.direction === 'BEARISH') {
      bearScore += factor.contribution;
    }
  }
  
  const diff = bullScore - bearScore;
  if (diff > 0.1) return 'BULLISH';
  if (diff < -0.1) return 'BEARISH';
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════

export interface ProjectionEngineInput {
  ctx: TAContext;
  patterns: ScoredPattern[];
  symbol: string;
  timeframe: string;
}

export class ProjectionEngine {
  /**
   * Generate complete RenderPack from TA context and patterns
   */
  generateRenderPack(input: ProjectionEngineInput): RenderPack {
    const { ctx, patterns, symbol, timeframe } = input;
    const lastIdx = ctx.series.candles.length - 1;
    const currentPrice = ctx.series.candles[lastIdx].close;
    const atr = ctx.atr[lastIdx];
    
    // 1. Build pattern layers
    const totalPatternScore = patterns.reduce((sum, p) => sum + p.scoring.score, 0);
    const patternLayers = patterns
      .slice(0, 15) // Top 15 patterns
      .map(p => buildPatternLayer(p, totalPatternScore));
    
    // 2. Build auxiliary layers
    const levelLayer = buildLevelLayer(ctx.levels);
    const maLayer = buildMALayer(ctx);
    const fibLayer = buildFibLayer(ctx);
    
    // 3. Combine all layers
    const layers: RenderLayer[] = [
      ...patternLayers,
      levelLayer,
      maLayer,
    ];
    
    if (fibLayer) {
      layers.push(fibLayer);
    }
    
    // 4. Generate projections
    const projectorContext: ProjectorContext = {
      currentPrice,
      atr,
      timeframe,
      regime: ctx.structure.regime,
      ma50: ctx.ma50[lastIdx],
      ma200: ctx.ma200[lastIdx]
    };
    
    const projections = this.generateProjections(patternLayers, projectorContext);
    
    // 5. Build confirmation stack
    const confirmationStack = buildConfirmationStack(layers, projections);
    
    // 6. Calculate dominant direction
    const dominantDirection = calculateDominantDirection(confirmationStack);
    
    // 7. Calculate confluence score
    const confluenceScore = this.calculateConfluenceScore(confirmationStack, dominantDirection);
    
    return {
      symbol,
      timeframe,
      timestamp: new Date().toISOString(),
      currentPrice,
      atr,
      regime: ctx.structure.regime,
      layers,
      projections,
      confluenceScore,
      dominantDirection,
      summary: {
        patternsDetected: patterns.length,
        layersRendered: layers.length,
        projectionsGenerated: projections.length,
        confirmationStack
      }
    };
  }

  private generateProjections(
    patternLayers: PatternLayer[],
    context: ProjectorContext
  ): Projection[] {
    const projections: Projection[] = [];
    
    for (const layer of patternLayers) {
      const projector = findProjector(layer.patternType);
      if (projector) {
        const projection = projector.project(layer, context);
        if (projection) {
          projections.push(projection);
        }
      }
    }
    
    // Sort by probability and take top 3
    projections.sort((a, b) => b.probability - a.probability);
    return projections.slice(0, 3);
  }

  private calculateConfluenceScore(
    stack: ConfirmationFactor[],
    dominantDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  ): number {
    if (dominantDirection === 'NEUTRAL') {
      return 0.5;
    }
    
    let alignedScore = 0;
    let totalContribution = 0;
    
    for (const factor of stack) {
      totalContribution += factor.contribution;
      if (factor.direction === dominantDirection || factor.direction === 'NEUTRAL') {
        alignedScore += factor.contribution;
      }
    }
    
    if (totalContribution === 0) return 0.5;
    
    const baseScore = alignedScore / totalContribution;
    // Scale to 0.4-0.9 range
    return 0.4 + baseScore * 0.5;
  }
}

export const projectionEngine = new ProjectionEngine();
