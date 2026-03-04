/**
 * External Service Clients
 * 
 * HTTP clients for communication with standalone services.
 * These services are isolated by design and accessed via HTTP only.
 */

// Connections Module Client (Port 8003)
export {
  ConnectionsClient,
  getConnectionsClient,
  resetConnectionsClient,
  isConnectionsAvailable,
  getRealityScore,
  getInfluenceScore,
} from './connections.client.js';

export type {
  RealityScoreResponse,
  InfluenceScoreResponse,
  ClusterAttentionResponse,
  BackersResponse,
  ConnectionsHealthResponse,
} from './connections.client.js';
