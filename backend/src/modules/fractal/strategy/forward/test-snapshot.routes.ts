/**
 * BLOCK 56.6 — Test Snapshot Generator
 * 
 * Generates test snapshots with resolved outcomes for Forward Performance testing.
 * DEV-only endpoint for populating test data.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { SignalSnapshotModel } from '../../storage/signal-snapshot.schema.js';

// Presets configuration for different modes
const PRESET_CONFIGS = {
  CONSERVATIVE: {
    positionSize: 0.3,
    modes: ['NO_TRADE', 'MICRO', 'MICRO', 'MICRO', 'PARTIAL'],
    winRate: 0.65, // Higher win rate, lower returns
    avgReturn: 0.02,
    maxDD: 0.08
  },
  BALANCED: {
    positionSize: 0.5,
    modes: ['NO_TRADE', 'MICRO', 'PARTIAL', 'PARTIAL', 'FULL'],
    winRate: 0.55,
    avgReturn: 0.04,
    maxDD: 0.15
  },
  AGGRESSIVE: {
    positionSize: 0.8,
    modes: ['MICRO', 'PARTIAL', 'PARTIAL', 'FULL', 'FULL'],
    winRate: 0.45, // Lower win rate, higher returns
    avgReturn: 0.08,
    maxDD: 0.25
  }
};

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateOutcome(
  action: string,
  presetConfig: typeof PRESET_CONFIGS.BALANCED,
  closePrice: number
): { realizedReturn: number; hit: boolean; closeAsof: number; closeForward: number } {
  const isWin = Math.random() < presetConfig.winRate;
  
  let returnPct: number;
  if (isWin) {
    returnPct = randomInRange(0.01, presetConfig.avgReturn * 2);
  } else {
    returnPct = -randomInRange(0.005, presetConfig.maxDD);
  }
  
  // Adjust return based on action
  if (action === 'SHORT') {
    returnPct = -returnPct;
  } else if (action === 'HOLD') {
    returnPct = randomInRange(-0.01, 0.01);
  }
  
  const closeForward = closePrice * (1 + returnPct);
  
  return {
    realizedReturn: returnPct,
    hit: (action === 'LONG' && returnPct > 0) || (action === 'SHORT' && returnPct < 0),
    closeAsof: closePrice,
    closeForward
  };
}

export async function testSnapshotRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/test/generate-snapshots
   * 
   * Generate test snapshots with resolved outcomes
   * 
   * Body:
   *   symbol: string (default: BTC)
   *   count: number (default: 30) - number of snapshots to generate
   *   startDate: string (default: 60 days ago)
   *   presets: array (default: all) - which presets to generate
   *   roles: array (default: ['ACTIVE']) - which roles to generate
   *   clearExisting: boolean (default: false)
   */
  fastify.post('/api/fractal/v2.1/admin/test/generate-snapshots', async (
    request: FastifyRequest<{
      Body: {
        symbol?: string;
        count?: number;
        startDate?: string;
        presets?: string[];
        roles?: string[];
        clearExisting?: boolean;
      }
    }>
  ) => {
    const body = request.body || {};
    const symbol = body.symbol ?? 'BTC';
    const count = Math.min(body.count ?? 30, 100); // Max 100 snapshots
    const presets = (body.presets ?? ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']).map(p => p.toUpperCase());
    const roles = (body.roles ?? ['ACTIVE']).map(r => r.toUpperCase());
    const clearExisting = body.clearExisting ?? false;
    
    // Calculate start date (default: 60 days ago)
    const startDate = body.startDate 
      ? new Date(body.startDate)
      : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    
    // Clear existing if requested
    if (clearExisting) {
      await SignalSnapshotModel.deleteMany({
        symbol,
        source: 'ENGINE_ASOF',
        modelType: { $in: roles }
      });
    }
    
    const generated: any[] = [];
    const basePrice = 45000; // Base BTC price for test data
    
    for (let i = 0; i < count; i++) {
      // Date for this snapshot (spread evenly)
      const snapshotDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      
      // Simulate price drift
      const priceNoise = 1 + (Math.random() - 0.5) * 0.3; // ±15%
      const currentPrice = basePrice * priceNoise;
      
      for (const role of roles) {
        for (const presetKey of presets) {
          const presetConfig = PRESET_CONFIGS[presetKey as keyof typeof PRESET_CONFIGS];
          if (!presetConfig) continue;
          
          // Generate action based on confidence and randomness
          const actions: Array<'LONG' | 'SHORT' | 'HOLD'> = ['LONG', 'LONG', 'HOLD', 'SHORT'];
          const action = randomChoice(actions);
          
          // Market phases
          const phases = ['MARKUP', 'MARKDOWN', 'RECOVERY', 'ACCUMULATION', 'CAPITULATION', 'DISTRIBUTION'];
          const phase = randomChoice(phases);
          
          // Generate snapshot
          const snapshot: any = {
            symbol,
            asOf: snapshotDate,
            timeframe: '1D',
            version: 'V2.1_TEST',
            modelId: `${symbol}_TEST`,
            modelType: role,
            
            action,
            phase, // Add phase field
            dominantHorizon: randomChoice([7, 14, 30]),
            expectedReturn: randomInRange(0.05, 0.2),
            confidence: randomInRange(0.3, 0.8),
            reliability: randomInRange(0.6, 0.9),
            entropy: randomInRange(0.3, 0.7),
            stability: randomInRange(0.7, 0.95),
            
            risk: {
              maxDD_WF: randomInRange(0.05, 0.15),
              mcP95_DD: randomInRange(0.2, 0.5),
              softStop: -randomInRange(0.05, 0.1)
            },
            
            strategy: {
              preset: presetKey,
              minConf: 0.05,
              maxEntropy: 0.6,
              maxTail: 0.55,
              positionSize: presetConfig.positionSize * randomInRange(0.7, 1.0),
              mode: randomChoice(presetConfig.modes),
              edgeScore: randomInRange(30, 70)
            },
            
            metrics: {
              similarityMean: randomInRange(0.4, 0.8),
              effectiveN: Math.floor(randomInRange(10, 30)),
              matchCount: Math.floor(randomInRange(15, 50))
            },
            
            governance: {
              guardMode: 'NORMAL',
              healthStatus: 'HEALTHY'
            },
            
            source: 'ENGINE_ASOF',
            resolved: true,
            
            // Generate outcomes for all horizons
            outcomes: {}
          };
          
          // Generate resolved outcomes for 7d, 14d, 30d
          for (const horizon of [7, 14, 30]) {
            const outcome = generateOutcome(action, presetConfig, currentPrice);
            const horizonKey = `${horizon}d`;
            snapshot.outcomes[horizonKey] = {
              ...outcome,
              resolvedAt: new Date(snapshotDate.getTime() + horizon * 24 * 60 * 60 * 1000)
            };
          }
          
          try {
            await SignalSnapshotModel.updateOne(
              {
                symbol: snapshot.symbol,
                asOf: snapshot.asOf,
                modelType: snapshot.modelType,
                'strategy.preset': snapshot.strategy.preset
              },
              { $set: snapshot },
              { upsert: true }
            );
            
            generated.push({
              date: snapshotDate.toISOString().slice(0, 10),
              role,
              preset: presetKey,
              action
            });
          } catch (err: any) {
            console.error(`[TestSnapshot] Error generating snapshot:`, err.message);
          }
        }
      }
    }
    
    return {
      ok: true,
      generated: generated.length,
      sample: generated.slice(0, 5),
      config: {
        symbol,
        count,
        startDate: startDate.toISOString().slice(0, 10),
        presets,
        roles
      }
    };
  });
  
  /**
   * DELETE /api/fractal/v2.1/admin/test/clear-snapshots
   * 
   * Clear test snapshots
   */
  fastify.delete('/api/fractal/v2.1/admin/test/clear-snapshots', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        source?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const source = request.query.source ?? 'ENGINE_ASOF';
    
    const result = await SignalSnapshotModel.deleteMany({
      symbol,
      source
    });
    
    return {
      ok: true,
      deleted: result.deletedCount
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/test/snapshot-stats
   * 
   * Get snapshot statistics
   */
  fastify.get('/api/fractal/v2.1/admin/test/snapshot-stats', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    const stats = await SignalSnapshotModel.aggregate([
      { $match: { symbol } },
      {
        $group: {
          _id: {
            modelType: '$modelType',
            preset: '$strategy.preset',
            source: '$source'
          },
          count: { $sum: 1 },
          resolved: { $sum: { $cond: ['$resolved', 1, 0] } },
          minDate: { $min: '$asOf' },
          maxDate: { $max: '$asOf' }
        }
      },
      { $sort: { '_id.modelType': 1, '_id.preset': 1 } }
    ]);
    
    const total = await SignalSnapshotModel.countDocuments({ symbol });
    
    return {
      symbol,
      total,
      breakdown: stats.map(s => ({
        role: s._id.modelType,
        preset: s._id.preset,
        source: s._id.source,
        count: s.count,
        resolved: s.resolved,
        dateRange: {
          from: s.minDate?.toISOString().slice(0, 10) ?? null,
          to: s.maxDate?.toISOString().slice(0, 10) ?? null
        }
      }))
    };
  });
}
