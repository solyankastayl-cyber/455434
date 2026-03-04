/**
 * Forecast Segments Module Index (BLOCK 4)
 */

export * from './forecast_segment.model.js';
export * from './forecast_segment.repo.js';
export * from './segment_rollover.service.js';
export { forecastSegmentPublicRoutes, forecastSegmentAdminRoutes } from './forecast_segment.routes.js';

console.log('[Forecast] Segments module loaded (BLOCK 4)');
