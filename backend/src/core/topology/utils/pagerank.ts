/**
 * Weighted PageRank algorithm for topology
 */

interface PageRankOptions {
  damping?: number;
  iterations?: number;
}

/**
 * Calculate PageRank scores for nodes in a weighted directed graph
 * 
 * @param nodes - Array of node identifiers
 * @param edges - Array of edges with from, to, and weight
 * @param opts - Algorithm parameters
 * @returns Map of node -> pagerank score
 */
export function pagerank(
  nodes: string[],
  edges: Array<{ from: string; to: string; weight: number }>,
  opts?: PageRankOptions
): Record<string, number> {
  const d = opts?.damping ?? 0.85;
  const iterations = opts?.iterations ?? 25;

  const n = nodes.length;
  if (n === 0) return {};

  // Build index
  const idx = new Map(nodes.map((node, i) => [node, i]));

  // Calculate outgoing weight sums
  const outSum = new Array(n).fill(0);
  
  // Build incoming edge lists
  const incoming: Array<Array<{ j: number; w: number }>> = Array.from(
    { length: n }, 
    () => []
  );

  for (const e of edges) {
    const i = idx.get(e.from);
    const j = idx.get(e.to);
    if (i === undefined || j === undefined) continue;

    const weight = Math.max(0, e.weight);
    outSum[i] += weight;
    incoming[j].push({ j: i, w: weight });
  }

  // Initialize PageRank uniformly
  let pr = new Array(n).fill(1 / n);

  // Power iteration
  for (let k = 0; k < iterations; k++) {
    const next = new Array(n).fill((1 - d) / n);

    for (let v = 0; v < n; v++) {
      for (const inc of incoming[v]) {
        const denom = outSum[inc.j] || 1;
        next[v] += d * pr[inc.j] * (inc.w / denom);
      }
    }

    pr = next;
  }

  // Build result
  const result: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    result[nodes[i]] = pr[i];
  }

  return result;
}

export default pagerank;
