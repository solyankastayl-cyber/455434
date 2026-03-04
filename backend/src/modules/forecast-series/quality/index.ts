/**
 * QUALITY MODULE INDEX
 * ====================
 * 
 * V3.5: Model Quality Badge
 * V3.6: Rolling Quality
 * V3.7: Drift Detector
 * V3.8: Auto Confidence Modifier
 * V3.9-V3.10: Position Sizing Engine
 */

// V3.5-V3.6: Quality Service
export {
  ForecastQualityService,
  getForecastQualityService,
  type QualityState,
  type QualityParams,
  type QualityResult,
} from './forecast-quality.service.js';

// V3.5-V3.6: Quality Routes
export {
  forecastQualityRoutes,
  registerForecastQualityRoutes,
} from './forecast-quality.routes.js';

// V3.7: Drift Service
export {
  ForecastDriftService,
  getForecastDriftService,
  type DriftState,
  type DriftParams,
  type DriftResult,
} from './forecast-drift.service.js';

// V3.7: Drift Routes
export {
  forecastDriftRoutes,
  registerForecastDriftRoutes,
} from './forecast-drift.routes.js';

// V3.8: Confidence Modifier
export {
  ForecastConfidenceModifierService,
  getForecastConfidenceModifierService,
  type HealthState,
  type ConfidenceModifierInput,
  type ConfidenceModifierResult,
} from './forecast-confidence-modifier.service.js';

// V3.9-V3.10: Position Sizing
export {
  PositionSizingService,
  getPositionSizingService,
  type RiskLevel,
  type NotionalHint,
  type Action,
  type PositionSizingInput,
  type PositionSizingResult,
} from './position-sizing.service.js';

console.log('[Quality] Module index loaded (V3.5-V3.10)');
