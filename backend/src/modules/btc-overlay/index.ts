/**
 * BTC OVERLAY MODULE — Entry Point
 */

// Contracts
export type {
  HorizonKey,
  OverlayCoeffs,
  OverlayExplain,
  OverlayCoeffsResponse,
  OverlayAdjustedPathResponse,
  OverlayExplainResponse,
  BtcVerdictStrip,
  BtcForecastHorizon,
  BtcTerminalPack,
} from './btc_overlay.contract.js';

// Config
export {
  btcOverlayConfig,
  loadBtcOverlayConfig,
  type BtcOverlayConfig,
} from './btc_overlay.config.js';

// Service
export {
  BtcOverlayService,
  getBtcOverlayService,
} from './btc_overlay.service.js';

// Routes
export { btcOverlayRoutes } from './btc_overlay.routes.js';
