/**
 * FORWARD PERFORMANCE MODULE
 * 
 * Signal snapshots, outcome resolution, and metrics aggregation.
 */

// Models
export { ForwardSignalModel } from "./models/forward_signal.model";
export { ForwardOutcomeModel } from "./models/forward_outcome.model";
export { ForwardMetricsModel } from "./models/forward_metrics.model";

// Services
export { writeForwardSnapshots, writeSingleForwardSignal } from "./services/forward_snapshot.service";
export { resolveForwardOutcomes, getResolutionStats } from "./services/forward_outcome_resolver.service";
export { getCandleAtOrBefore, computeTargetDate, getLatestCandleDate } from "./services/candle_source.service";
export { rebuildForwardMetrics, getMetricsSummary, getLatestForwardMetrics, getEquityCurve } from "./services/forward_metrics.service";

// Routes
export { registerForwardAdminRoutes } from "./api/forward.admin.routes";
