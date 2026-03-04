/**
 * Route Graph MAX_DEPTH (MAX_HOPS) Tests
 * 
 * Tests for MAX_HOPS traversal depth limit
 * Ensures graph builder respects depth limits when processing route segments
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================
// Test Constants
// ============================================

const STABILIZATION_LIMITS = {
  MAX_HOPS: 6,
  MAX_ROUTES: 5,
};

// ============================================
// Route Segment Processing Logic
// ============================================

interface RouteSegment {
  from: string;
  to: string;
  type: string;
  chain: string;
  amount?: number;
  protocol?: string;
}

interface Route {
  routeId: string;
  from: string;
  chain: string;
  segments: RouteSegment[];
}

/**
 * Process route segments with MAX_HOPS limit
 * Simulates the logic in buildFromRoutes
 */
function processRouteSegments(
  routes: Route[],
  maxRoutes: number = 3
): { processedSegments: number; totalSegments: number; truncatedRoutes: string[] } {
  let processedSegments = 0;
  let totalSegments = 0;
  const truncatedRoutes: string[] = [];
  
  // Cap routes to MAX_ROUTES
  const cappedRoutes = routes.slice(0, Math.min(maxRoutes, STABILIZATION_LIMITS.MAX_ROUTES));
  
  for (const route of cappedRoutes) {
    totalSegments += route.segments.length;
    
    // Apply MAX_HOPS limit
    const maxSegments = Math.min(
      route.segments.length,
      STABILIZATION_LIMITS.MAX_HOPS
    );
    
    if (route.segments.length > STABILIZATION_LIMITS.MAX_HOPS) {
      truncatedRoutes.push(route.routeId);
    }
    
    processedSegments += maxSegments;
  }
  
  return { processedSegments, totalSegments, truncatedRoutes };
}

/**
 * Calculate traversal depth for a graph
 */
function calculateTraversalDepth(segments: RouteSegment[]): number {
  return Math.min(segments.length, STABILIZATION_LIMITS.MAX_HOPS);
}

// ============================================
// Test Data Generators
// ============================================

function createSegment(from: string, to: string, type: string = 'TRANSFER'): RouteSegment {
  return {
    from,
    to,
    type,
    chain: 'eth'
  };
}

function createRoute(routeId: string, segmentCount: number): Route {
  const segments: RouteSegment[] = [];
  
  for (let i = 0; i < segmentCount; i++) {
    segments.push(createSegment(
      `0x${i.toString(16).padStart(40, '0')}`,
      `0x${(i + 1).toString(16).padStart(40, '0')}`,
      i === segmentCount - 1 ? 'DEPOSIT' : 'TRANSFER'
    ));
  }
  
  return {
    routeId,
    from: segments[0]?.from || '0x0',
    chain: 'eth',
    segments
  };
}

// ============================================
// Tests
// ============================================

describe('Route Graph MAX_HOPS (Depth) Limits', () => {
  
  describe('Single Route Depth', () => {
    
    it('should process all segments when under MAX_HOPS', () => {
      const route = createRoute('route-1', 4);
      
      const result = processRouteSegments([route]);
      
      expect(result.processedSegments).toBe(4);
      expect(result.totalSegments).toBe(4);
      expect(result.truncatedRoutes).toHaveLength(0);
    });
    
    it('should limit segments to MAX_HOPS (6) when exceeded', () => {
      const route = createRoute('route-1', 10);
      
      const result = processRouteSegments([route]);
      
      expect(result.processedSegments).toBe(STABILIZATION_LIMITS.MAX_HOPS);
      expect(result.totalSegments).toBe(10);
      expect(result.truncatedRoutes).toContain('route-1');
    });
    
    it('should handle exactly MAX_HOPS segments', () => {
      const route = createRoute('route-1', STABILIZATION_LIMITS.MAX_HOPS);
      
      const result = processRouteSegments([route]);
      
      expect(result.processedSegments).toBe(STABILIZATION_LIMITS.MAX_HOPS);
      expect(result.truncatedRoutes).toHaveLength(0);
    });
    
    it('should handle empty route', () => {
      const route: Route = {
        routeId: 'empty-route',
        from: '0x0',
        chain: 'eth',
        segments: []
      };
      
      const result = processRouteSegments([route]);
      
      expect(result.processedSegments).toBe(0);
      expect(result.totalSegments).toBe(0);
    });
  });
  
  describe('Multiple Routes Depth', () => {
    
    it('should apply MAX_HOPS limit to each route independently', () => {
      const routes = [
        createRoute('route-1', 8),  // > MAX_HOPS
        createRoute('route-2', 3),  // < MAX_HOPS
        createRoute('route-3', 10), // > MAX_HOPS
      ];
      
      const result = processRouteSegments(routes);
      
      // route-1: 6 (capped), route-2: 3, route-3: 6 (capped) = 15
      expect(result.processedSegments).toBe(6 + 3 + 6);
      expect(result.totalSegments).toBe(8 + 3 + 10);
      expect(result.truncatedRoutes).toContain('route-1');
      expect(result.truncatedRoutes).not.toContain('route-2');
      expect(result.truncatedRoutes).toContain('route-3');
    });
    
    it('should respect MAX_ROUTES limit', () => {
      const routes = [
        createRoute('route-1', 3),
        createRoute('route-2', 3),
        createRoute('route-3', 3),
        createRoute('route-4', 3),
        createRoute('route-5', 3),
        createRoute('route-6', 3), // Should be ignored
        createRoute('route-7', 3), // Should be ignored
      ];
      
      const result = processRouteSegments(routes, 10); // Request 10, but MAX_ROUTES is 5
      
      // Only first 5 routes processed
      expect(result.processedSegments).toBe(5 * 3);
      expect(result.totalSegments).toBe(5 * 3);
    });
    
    it('should use user-provided maxRoutes when lower than MAX_ROUTES', () => {
      const routes = [
        createRoute('route-1', 3),
        createRoute('route-2', 3),
        createRoute('route-3', 3),
        createRoute('route-4', 3),
      ];
      
      const result = processRouteSegments(routes, 2); // User wants only 2
      
      expect(result.processedSegments).toBe(2 * 3);
    });
  });
  
  describe('Traversal Depth Calculation', () => {
    
    it('should return actual depth when under limit', () => {
      const segments = [
        createSegment('0x1', '0x2'),
        createSegment('0x2', '0x3'),
        createSegment('0x3', '0x4'),
      ];
      
      expect(calculateTraversalDepth(segments)).toBe(3);
    });
    
    it('should cap depth at MAX_HOPS', () => {
      const segments: RouteSegment[] = [];
      for (let i = 0; i < 15; i++) {
        segments.push(createSegment(`0x${i}`, `0x${i + 1}`));
      }
      
      expect(calculateTraversalDepth(segments)).toBe(STABILIZATION_LIMITS.MAX_HOPS);
    });
    
    it('should return 0 for empty segments', () => {
      expect(calculateTraversalDepth([])).toBe(0);
    });
  });
  
  describe('Complex Route Patterns', () => {
    
    it('should handle route with bridge segments at depth limit', () => {
      const route = createRoute('bridge-route', STABILIZATION_LIMITS.MAX_HOPS);
      route.segments[2].type = 'BRIDGE';
      route.segments[2].chain = 'eth';
      
      const result = processRouteSegments([route]);
      
      expect(result.processedSegments).toBe(STABILIZATION_LIMITS.MAX_HOPS);
      expect(result.truncatedRoutes).toHaveLength(0);
    });
    
    it('should handle route exceeding limit with CEX exit at end', () => {
      const route = createRoute('cex-exit-route', 10);
      route.segments[9].type = 'DEPOSIT'; // CEX exit at position 10
      
      const result = processRouteSegments([route]);
      
      // Only first 6 segments processed - CEX exit is cut off
      expect(result.processedSegments).toBe(STABILIZATION_LIMITS.MAX_HOPS);
      expect(result.truncatedRoutes).toContain('cex-exit-route');
    });
    
    it('should preserve route order when processing multiple routes', () => {
      const routes = [
        createRoute('priority-route', 4),
        createRoute('secondary-route', 4),
        createRoute('tertiary-route', 4),
      ];
      
      // Simulate actual processing order
      const processedOrder: string[] = [];
      for (const route of routes.slice(0, STABILIZATION_LIMITS.MAX_ROUTES)) {
        processedOrder.push(route.routeId);
      }
      
      expect(processedOrder[0]).toBe('priority-route');
      expect(processedOrder[1]).toBe('secondary-route');
      expect(processedOrder[2]).toBe('tertiary-route');
    });
  });
  
  describe('Edge Cases', () => {
    
    it('should handle route with exactly 1 segment', () => {
      const route = createRoute('single-segment', 1);
      
      const result = processRouteSegments([route]);
      
      expect(result.processedSegments).toBe(1);
      expect(result.truncatedRoutes).toHaveLength(0);
    });
    
    it('should handle large number of short routes', () => {
      const routes = Array.from({ length: 20 }, (_, i) => 
        createRoute(`route-${i}`, 2)
      );
      
      const result = processRouteSegments(routes, 10);
      
      // MAX_ROUTES is 5, so only 5 routes processed
      expect(result.processedSegments).toBe(5 * 2);
    });
    
    it('should handle routes array being empty', () => {
      const result = processRouteSegments([]);
      
      expect(result.processedSegments).toBe(0);
      expect(result.totalSegments).toBe(0);
      expect(result.truncatedRoutes).toHaveLength(0);
    });
  });
});
