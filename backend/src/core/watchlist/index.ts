/**
 * Watchlist V2 Module Index
 * 
 * Exports all watchlist-related models, services, and routes
 */

// Models
export * from './watchlist.model.js';
export * from './watchlist_event.model.js';

// Services
export * from './watchlist.service.js';
export * from './watchlist_alerts.service.js';

// Routes
export { watchlistRoutes } from './watchlist.routes.js';
