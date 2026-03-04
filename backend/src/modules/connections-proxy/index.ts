/**
 * Connections Proxy Module
 * 
 * Proxies requests to the standalone Connections Service (port 8003).
 * Provides Layer 2 analytics without polluting Layer 1 forecast pipeline.
 */

export { registerConnectionsProxyRoutes } from './connections-proxy.routes.js';
export { registerConnectionsAdminRoutes } from './connections-admin.routes.js';
