/**
 * Relations Service
 * Business logic for aggregated relations
 * 
 * Key concept: Relations are aggregated FROM transfers
 * They represent "corridor density" for the Warhammer-style graph
 */
import {
  relationsRepository,
  RelationFilter,
  RelationSort,
  PaginationOptions,
} from './relations.repository.js';
import { 
  IRelation, 
  RelationWindow, 
  RelationChain 
} from './relations.model.js';

/**
 * Format relation for API response
 */
export function formatRelation(relation: IRelation) {
  return {
    id: relation._id.toString(),
    from: relation.from,
    to: relation.to,
    chain: relation.chain,
    window: relation.window,
    direction: relation.direction,
    interactionCount: relation.interactionCount,
    volumeRaw: relation.volumeRaw,
    firstSeenAt: relation.firstSeenAt,
    lastSeenAt: relation.lastSeenAt,
    densityScore: relation.densityScore,
    source: relation.source,
  };
}

/**
 * Relations Service Class
 */
export class RelationsService {
  /**
   * Get relation by ID
   */
  async getById(id: string): Promise<IRelation | null> {
    return relationsRepository.findById(id);
  }

  /**
   * Get graph data (top relations by density)
   * This feeds the Warhammer-style visualization
   */
  async getGraph(options: {
    window?: RelationWindow;
    minDensity?: number;
    chain?: RelationChain;
    limit?: number;
  } = {}): Promise<{
    nodes: Array<{ id: string; type: 'address' }>;
    edges: Array<{
      from: string;
      to: string;
      density: number;
      interactionCount: number;
      direction: string;
    }>;
    meta: {
      window: RelationWindow;
      minDensity: number;
      totalEdges: number;
    };
  }> {
    const { window = '7d', minDensity = 0, limit = 100 } = options;

    const relations = await relationsRepository.findTopByDensity(
      window,
      minDensity,
      limit
    );

    // Build nodes and edges
    const nodesSet = new Set<string>();
    const edges: Array<{
      from: string;
      to: string;
      density: number;
      interactionCount: number;
      direction: string;
    }> = [];

    relations.forEach((r) => {
      nodesSet.add(r.from);
      nodesSet.add(r.to);

      edges.push({
        from: r.from,
        to: r.to,
        density: r.densityScore,
        interactionCount: r.interactionCount,
        direction: r.direction,
      });
    });

    const nodes = Array.from(nodesSet).map((id) => ({
      id,
      type: 'address' as const,
    }));

    return {
      nodes,
      edges,
      meta: {
        window,
        minDensity,
        totalEdges: edges.length,
      },
    };
  }

  /**
   * Get relations for an address
   */
  async getForAddress(
    address: string,
    options: {
      window?: RelationWindow;
      direction?: 'in' | 'out' | 'both';
      minDensity?: number;
      limit?: number;
    } = {}
  ): Promise<{
    relations: IRelation[];
    summary: {
      totalRelations: number;
      inbound: number;
      outbound: number;
      avgDensity: number;
    };
  }> {
    const relations = await relationsRepository.findForAddress(address, options);

    // Calculate summary
    const addr = address.toLowerCase();
    let inbound = 0;
    let outbound = 0;
    let totalDensity = 0;

    relations.forEach((r) => {
      if (r.from === addr) outbound++;
      if (r.to === addr) inbound++;
      totalDensity += r.densityScore;
    });

    return {
      relations,
      summary: {
        totalRelations: relations.length,
        inbound,
        outbound,
        avgDensity: relations.length > 0 ? totalDensity / relations.length : 0,
      },
    };
  }

  /**
   * Get corridor between two addresses
   * Returns aggregated relation data for the corridor visualization
   */
  async getCorridor(
    addressA: string,
    addressB: string,
    window: RelationWindow = '7d'
  ): Promise<{
    relations: IRelation[];
    summary: {
      aToB: {
        interactionCount: number;
        volumeRaw: string;
        density: number;
      } | null;
      bToA: {
        interactionCount: number;
        volumeRaw: string;
        density: number;
      } | null;
      totalInteractions: number;
      maxDensity: number;
      bidirectional: boolean;
    };
  }> {
    const relations = await relationsRepository.findCorridor(addressA, addressB, window);

    const a = addressA.toLowerCase();
    const b = addressB.toLowerCase();

    let aToB: { interactionCount: number; volumeRaw: string; density: number } | null = null;
    let bToA: { interactionCount: number; volumeRaw: string; density: number } | null = null;
    let maxDensity = 0;
    let totalInteractions = 0;

    relations.forEach((r) => {
      totalInteractions += r.interactionCount;
      if (r.densityScore > maxDensity) maxDensity = r.densityScore;

      if (r.from === a && r.to === b) {
        aToB = {
          interactionCount: r.interactionCount,
          volumeRaw: r.volumeRaw,
          density: r.densityScore,
        };
      } else if (r.from === b && r.to === a) {
        bToA = {
          interactionCount: r.interactionCount,
          volumeRaw: r.volumeRaw,
          density: r.densityScore,
        };
      }
    });

    return {
      relations,
      summary: {
        aToB,
        bToA,
        totalInteractions,
        maxDensity,
        bidirectional: aToB !== null && bToA !== null,
      },
    };
  }

  /**
   * Query relations with filters
   */
  async query(
    filter: RelationFilter,
    sort?: RelationSort,
    pagination?: PaginationOptions
  ): Promise<{
    relations: IRelation[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { relations, total } = await relationsRepository.findMany(
      filter,
      sort,
      pagination
    );

    const limit = pagination?.limit || 100;
    const offset = pagination?.offset || 0;

    return {
      relations,
      total,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalRelations: number;
    byWindow: Record<string, number>;
    avgDensity: number;
    maxDensity: number;
  }> {
    return relationsRepository.getStats();
  }
}

// Export singleton instance
export const relationsService = new RelationsService();
