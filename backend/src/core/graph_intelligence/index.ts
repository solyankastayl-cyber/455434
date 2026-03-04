/**
 * Graph Intelligence Module (P1.7)
 * 
 * Explainability graph layer for route and address analysis.
 * Generates visual explanations for why routes are risky.
 */

// Storage & Types
export * from './storage/graph_types.js';
export * from './storage/graph_snapshot.model.js';

// Resolvers
export { nodeResolver } from './resolvers/node_resolver.service.js';
export { edgeResolver } from './resolvers/edge_resolver.service.js';

// Builders
export { graphBuilder } from './builders/graph_builder.service.js';
export { pathHighlighter } from './builders/path_highlighter.service.js';

// Explain
export { riskExplainService } from './explain/risk_explain.service.js';

// Integrations
export { routeSourceAdapter } from './integrations/route_source.adapter.js';
export { marketContextAdapter } from './integrations/market_context.adapter.js';

// API Routes
export { graphIntelligenceRoutes } from './api/graph.routes.js';
