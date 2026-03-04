/**
 * SPX Macro Overlay Module
 * Combines SPX Hybrid with DXY Macro for adjusted projections
 */

export { default as spxMacroOverlayRoutes } from './macro-overlay.routes.js';
export { 
  buildMacroOverlaySPX, 
  type ProjectionPack, 
  type MacroOverlayMeta, 
  type MacroOverlayResult 
} from './macro-overlay.engine.js';
