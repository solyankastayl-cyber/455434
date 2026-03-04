/**
 * Graph Metrics Service
 * 
 * Calculates analytics metrics for the graph:
 * - Top counterparties by volume
 * - Exposure in/out
 * - Risk flags count
 * - Corridor statistics
 * - Activity metrics
 */

import { ActorModel } from '../actors/actor.model.js';
import { ActorScoreModel } from '../actor_scores/actor_score.model.js';
import { RelationModel } from '../relations/relations.model.js';

export interface GraphMetrics {
  overview: {
    totalNodes: number;
    totalEdges: number;
    totalRelations: number;
    dataWindow: string;
    lastUpdated: Date;
  };
  exposure: {
    totalInflowUsd: number;
    totalOutflowUsd: number;
    netFlowUsd: number;
    largestInflow: { actorId: string; amount: number } | null;
    largestOutflow: { actorId: string; amount: number } | null;
  };
  topCounterparties: Array<{
    actorId: string;
    name: string;
    volumeUsd: number;
    txCount: number;
    type: string;
  }>;
  activity: {
    lastSeenTimestamp: Date | null;
    activeDays: number;
    avgDailyVolume: number;
  };
  riskFlags: {
    total: number;
    mixer: number;
    peelChain: number;
    rapidDispersal: number;
    bridge: number;
  };
  corridors: {
    totalCorridors: number;
    topCorridors: Array<{
      from: string;
      to: string;
      volumeUsd: number;
      txCount: number;
    }>;
    avgCorridorVolume: number;
  };
}

/**
 * Calculate graph metrics
 */
export async function calculateGraphMetrics(
  window: '24h' | '7d' | '30d' = '7d'
): Promise<GraphMetrics> {
  // Get all actors
  const actors = await ActorModel.countDocuments();
  
  // Get relations
  const relations = await RelationModel.find().lean();
  const relationCount = relations.length;
  
  // Get actor scores
  const scores = await ActorScoreModel.find({ window }).lean();
  
  // Calculate exposure
  let totalInflowUsd = 0;
  let totalOutflowUsd = 0;
  let largestInflow: { actorId: string; amount: number } | null = null;
  let largestOutflow: { actorId: string; amount: number } | null = null;
  
  for (const score of scores) {
    const inflow = score.metrics?.inflowUsd || 0;
    const outflow = score.metrics?.outflowUsd || 0;
    
    totalInflowUsd += inflow;
    totalOutflowUsd += outflow;
    
    if (!largestInflow || inflow > largestInflow.amount) {
      largestInflow = { actorId: score.actorId, amount: inflow };
    }
    
    if (!largestOutflow || outflow > largestOutflow.amount) {
      largestOutflow = { actorId: score.actorId, amount: outflow };
    }
  }
  
  const netFlowUsd = totalInflowUsd - totalOutflowUsd;
  
  // Top counterparties by volume
  const topCounterparties = scores
    .map(s => ({
      actorId: s.actorId,
      name: s.actorId, // TODO: get from actor
      volumeUsd: (s.metrics?.totalVolumeUsd || 0),
      txCount: s.metrics?.txCount || 0,
      type: 'unknown', // TODO: get from actor
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, 10);
  
  // Activity metrics
  const lastSeenTimestamps = relations
    .map(r => r.lastSeen)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  
  const lastSeenTimestamp = lastSeenTimestamps[0] || null;
  
  const windowDays = window === '24h' ? 1 : window === '30d' ? 30 : 7;
  const avgDailyVolume = (totalInflowUsd + totalOutflowUsd) / 2 / windowDays;
  
  // Risk flags (TODO: implement real risk detection)
  const riskFlags = {
    total: 0,
    mixer: 0,
    peelChain: 0,
    rapidDispersal: 0,
    bridge: 0,
  };
  
  // Corridors (top relations by volume)
  const corridorsWithVolume = relations
    .map(r => ({
      from: r.from,
      to: r.to,
      volumeUsd: r.volumeUsd || 0,
      txCount: r.txCount || 0,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
  
  const topCorridors = corridorsWithVolume.slice(0, 10);
  const avgCorridorVolume = corridorsWithVolume.length > 0
    ? corridorsWithVolume.reduce((sum, c) => sum + c.volumeUsd, 0) / corridorsWithVolume.length
    : 0;
  
  return {
    overview: {
      totalNodes: actors,
      totalEdges: relationCount,
      totalRelations: relationCount,
      dataWindow: window,
      lastUpdated: new Date(),
    },
    exposure: {
      totalInflowUsd,
      totalOutflowUsd,
      netFlowUsd,
      largestInflow,
      largestOutflow,
    },
    topCounterparties,
    activity: {
      lastSeenTimestamp,
      activeDays: windowDays,
      avgDailyVolume,
    },
    riskFlags,
    corridors: {
      totalCorridors: relationCount,
      topCorridors,
      avgCorridorVolume,
    },
  };
}
