/**
 * C7 Cluster Orchestrator Service
 * Runs clustering, stores results, provides timeline
 */

import type { 
  ClusterConfig, 
  ClusterInfo, 
  ClusterRunResult,
  ClusterTimelinePoint,
} from '../contracts/cluster.contract.js';
import { runKMeans } from './kmeans.service.js';
import { labelCluster, dominantDims } from './label.service.js';
import { cosineDist, percentile } from '../utils/distance.js';
import { ClusterRunModel, ClusterAssignModel } from '../storage/cluster.model.js';
import { AeStateVectorModel } from '../../storage/ae_state_vector.model.js';
import { stateVectorToArray } from '../../services/ae_state.service.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Load snapshots from AE State collection
// ═══════════════════════════════════════════════════════════════

async function loadSnapshots(
  from: string,
  to: string
): Promise<Array<{ ts: string; vec: number[] }>> {
  const docs = await AeStateVectorModel.find({
    asOf: { $gte: from, $lte: to },
  }).sort({ asOf: 1 }).lean();
  
  return docs.map(doc => ({
    ts: doc.asOf,
    vec: stateVectorToArray(doc.vector),
  }));
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run Clustering
// ═══════════════════════════════════════════════════════════════

/**
 * Run k-means clustering on historical state vectors
 */
export async function runClusterAnalysis(
  config: ClusterConfig,
  from: string = '2000-01-01',
  to: string = '2025-12-31'
): Promise<ClusterRunResult> {
  console.log(`[Cluster] Running k=${config.k} on ${from} → ${to}`);
  
  // Load snapshots
  const snaps = await loadSnapshots(from, to);
  
  if (snaps.length === 0) {
    throw new Error('No snapshots found for clustering');
  }
  
  console.log(`[Cluster] Loaded ${snaps.length} snapshots`);
  
  const points = snaps.map(s => s.vec);
  const dims = points[0].length;
  
  // Run k-means
  const result = runKMeans(points, config);
  
  // Compute cluster statistics
  const k = config.k;
  const clusterDistances: number[][] = Array.from({ length: k }, () => []);
  const clusterSizes = new Array(k).fill(0);
  
  for (const a of result.assignments) {
    clusterDistances[a.clusterId].push(a.distance);
    clusterSizes[a.clusterId] += 1;
  }
  
  // Build cluster info
  const clusters: ClusterInfo[] = result.centroids.map((centroid, clusterId) => {
    const dists = clusterDistances[clusterId];
    const meanDist = dists.length ? dists.reduce((s, x) => s + x, 0) / dists.length : 0;
    const p90Dist = percentile(dists, 0.9);
    
    return {
      clusterId,
      label: labelCluster(centroid),
      size: clusterSizes[clusterId],
      centroid: centroid.map(v => Math.round(v * 1000) / 1000),
      stats: {
        meanDistance: Math.round(meanDist * 1000) / 1000,
        p90Distance: Math.round(p90Dist * 1000) / 1000,
      },
      dominantDims: dominantDims(centroid, 2),
    };
  });
  
  // Generate run ID
  const runId = `${new Date().toISOString()}_k${config.k}_${config.metric}`;
  
  const runResult: ClusterRunResult = {
    runId,
    createdAt: new Date().toISOString(),
    config,
    nSnapshots: snaps.length,
    dims,
    quality: {
      inertia: Math.round(result.inertia * 1000) / 1000,
      avgDistance: Math.round(result.avgDistance * 1000) / 1000,
      iters: result.iters,
    },
    clusters,
  };
  
  // Save to database
  await ClusterRunModel.findOneAndUpdate(
    { runId },
    runResult,
    { upsert: true }
  );
  
  // Save assignments
  const assignDocs = result.assignments.map((a, i) => ({
    runId,
    ts: new Date(snaps[a.idx].ts),
    clusterId: a.clusterId,
    distance: Math.round(a.distance * 1000) / 1000,
  }));
  
  // Bulk upsert assignments
  const bulkOps = assignDocs.map(doc => ({
    updateOne: {
      filter: { runId, ts: doc.ts },
      update: { $set: doc },
      upsert: true,
    },
  }));
  
  if (bulkOps.length > 0) {
    await ClusterAssignModel.bulkWrite(bulkOps, { ordered: false });
  }
  
  console.log(`[Cluster] Saved run ${runId} with ${assignDocs.length} assignments`);
  
  return runResult;
}

// ═══════════════════════════════════════════════════════════════
// GET LATEST RUN
// ═══════════════════════════════════════════════════════════════

export async function getLatestRun(): Promise<ClusterRunResult | null> {
  const doc = await ClusterRunModel.findOne().sort({ createdAt: -1 }).lean();
  if (!doc) return null;
  
  return {
    runId: doc.runId,
    createdAt: doc.createdAt.toISOString(),
    config: doc.config as ClusterConfig,
    nSnapshots: doc.nSnapshots,
    dims: doc.dims,
    quality: doc.quality,
    clusters: doc.clusters,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET CURRENT CLUSTER
// ═══════════════════════════════════════════════════════════════

export async function getCurrentCluster(asOf?: string): Promise<{
  ts: string;
  vec: number[];
  clusterId: number;
  label: string;
  distance: number;
  nearestCentroid: number[];
} | null> {
  const latest = await getLatestRun();
  if (!latest || latest.clusters.length === 0) {
    return null;
  }
  
  // Get current state vector
  const targetDate = asOf || new Date().toISOString().split('T')[0];
  const stateDoc = await AeStateVectorModel.findOne({ asOf: targetDate }).lean();
  
  if (!stateDoc) {
    return null;
  }
  
  const vec = stateVectorToArray(stateDoc.vector);
  
  // Find nearest centroid
  let bestClusterId = 0;
  let bestDistance = Infinity;
  let nearestCentroid = latest.clusters[0].centroid;
  
  for (const cluster of latest.clusters) {
    const dist = cosineDist(vec, cluster.centroid);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestClusterId = cluster.clusterId;
      nearestCentroid = cluster.centroid;
    }
  }
  
  const label = latest.clusters.find(c => c.clusterId === bestClusterId)?.label || 'UNKNOWN';
  
  return {
    ts: targetDate,
    vec: vec.map(v => Math.round(v * 1000) / 1000),
    clusterId: bestClusterId,
    label,
    distance: Math.round(bestDistance * 1000) / 1000,
    nearestCentroid,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET TIMELINE
// ═══════════════════════════════════════════════════════════════

export async function getClusterTimeline(
  from: string = '2000-01-01',
  to: string = '2025-12-31'
): Promise<{
  runId: string;
  points: ClusterTimelinePoint[];
} | null> {
  const latest = await getLatestRun();
  if (!latest) return null;
  
  // Build label map
  const labelMap = new Map<number, string>();
  for (const c of latest.clusters) {
    labelMap.set(c.clusterId, c.label);
  }
  
  // Get assignments
  const docs = await ClusterAssignModel.find({
    runId: latest.runId,
    ts: { $gte: new Date(from), $lte: new Date(to) },
  }).sort({ ts: 1 }).lean();
  
  const points: ClusterTimelinePoint[] = docs.map(d => ({
    ts: d.ts.toISOString().split('T')[0],
    clusterId: d.clusterId,
    label: labelMap.get(d.clusterId) || 'UNKNOWN',
    distance: d.distance,
  }));
  
  return {
    runId: latest.runId,
    points,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET CLUSTER STATS
// ═══════════════════════════════════════════════════════════════

export async function getClusterStats(): Promise<{
  totalRuns: number;
  latestRunId: string | null;
  totalAssignments: number;
}> {
  const totalRuns = await ClusterRunModel.countDocuments();
  const latest = await ClusterRunModel.findOne().sort({ createdAt: -1 }).lean();
  const totalAssignments = latest 
    ? await ClusterAssignModel.countDocuments({ runId: latest.runId })
    : 0;
  
  return {
    totalRuns,
    latestRunId: latest?.runId || null,
    totalAssignments,
  };
}
