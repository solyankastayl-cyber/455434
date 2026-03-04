/**
 * Broker Score calculation
 * 
 * Approximates betweenness centrality without expensive all-pairs shortest paths.
 * Measures routing potential: how many 2-hop paths go through a node.
 */

/**
 * Calculate broker scores for all nodes
 * 
 * @param nodes - Array of node identifiers
 * @param edges - Array of directed edges {from, to, weight}
 * @returns Record of node -> broker score (0..1)
 */
export function brokerScore(
  nodes: string[],
  edges: Array<{ from: string; to: string; weight: number }>
): Record<string, number> {
  // Build adjacency sets
  const outNeighbors = new Map<string, Set<string>>();
  const inNeighbors = new Map<string, Set<string>>();

  for (const n of nodes) {
    outNeighbors.set(n, new Set());
    inNeighbors.set(n, new Set());
  }

  for (const e of edges) {
    outNeighbors.get(e.from)?.add(e.to);
    inNeighbors.get(e.to)?.add(e.from);
  }

  // Calculate raw broker score:
  // A node X is a broker if it has many inputs AND many outputs
  // Score = |incoming| * |outgoing| (proxy for 2-hop bridge potential)
  const rawScore = new Map<string, number>();

  for (const x of nodes) {
    const ins = inNeighbors.get(x)?.size ?? 0;
    const outs = outNeighbors.get(x)?.size ?? 0;
    rawScore.set(x, ins * outs);
  }

  // Normalize to 0..1
  const maxScore = Math.max(...Array.from(rawScore.values()), 1);

  const result: Record<string, number> = {};
  for (const [node, score] of rawScore) {
    result[node] = Math.min(1, score / maxScore);
  }

  return result;
}

export default brokerScore;
