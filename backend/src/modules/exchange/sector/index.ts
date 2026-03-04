/**
 * BLOCK 2.9 — Sector Module Index
 * ================================
 */

// Types
export * from './types/sector.types.js';

// DB Models
export { AssetTagsStore, assetTagsStore } from './db/asset_tags.model.js';

// Services
export { SectorStateService, sectorStateService } from './services/sector_state.service.js';
export { RotationWaveService, rotationWaveService } from './services/rotation_wave.service.js';

// Routes
export { registerSectorRotationRoutes } from './routes/rotation.routes.js';

console.log('[Sector] Module loaded (Block 2.9)');
