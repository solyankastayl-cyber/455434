/**
 * K-Core decomposition algorithm
 * 
 * A k-core is a maximal subgraph where every vertex has degree >= k
 * Higher k-core = more "central" in the network
 */

/**
 * Calculate k-core numbers for all nodes
 * 
 * @param nodes - Array of node identifiers
 * @param undirectedEdges - Array of undirected edges {a, b}
 * @returns Map of node -> k-core number
 */
export function kCoreDecomposition(
  nodes: string[],
  undirectedEdges: Array<{ a: string; b: string }>
): Map<string, number> {
  // Build adjacency lists
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) {
    adj.set(n, new Set());
  }

  for (const e of undirectedEdges) {
    adj.get(e.a)?.add(e.b);
    adj.get(e.b)?.add(e.a);
  }

  // Initialize degrees
  const degree = new Map<string, number>();
  for (const n of nodes) {
    degree.set(n, adj.get(n)?.size ?? 0);
  }

  // Track core numbers and remaining nodes
  const core = new Map<string, number>();
  const remaining = new Set(nodes);

  let k = 1;

  while (remaining.size > 0) {
    let changed = true;

    // Iteratively remove nodes with degree < k
    while (changed) {
      changed = false;

      for (const n of Array.from(remaining)) {
        if ((degree.get(n) ?? 0) < k) {
          remaining.delete(n);
          core.set(n, k - 1);

          // Update neighbors' degrees
          for (const nb of adj.get(n) ?? []) {
            if (remaining.has(nb)) {
              degree.set(nb, (degree.get(nb) ?? 0) - 1);
            }
          }

          changed = true;
        }
      }
    }

    k++;
  }

  // Nodes that survived get max core
  const maxCore = k - 1;
  for (const n of nodes) {
    if (!core.has(n)) {
      core.set(n, maxCore);
    }
  }

  return core;
}

export default kCoreDecomposition;
