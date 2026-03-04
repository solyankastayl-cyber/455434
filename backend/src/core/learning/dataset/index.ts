/**
 * Dataset Module Index
 * 
 * ETAP 3.4: Learning Dataset Builder
 * 
 * Exports all dataset components.
 */

// Models
export { LearningSampleModel, type ILearningSample } from './learning_sample.model.js';
export { DatasetBuildRunModel, type IDatasetBuildRun } from './dataset_build_run.model.js';

// Pure Functions
export {
  extractSnapshotFeatures,
  extractLiveFeatures,
  extractDriftFeatures,
  extractMarketFeatures,
  buildFeatureVector,
} from './dataset_feature_extractor.js';

export {
  buildTrendLabels,
  buildDelayLabels,
  buildOutcomeLabels,
  buildVerdictLabels,
  buildLabels,
  calculateLabelCoverage,
} from './dataset_label_builder.js';

// Services
export {
  buildSampleForSnapshot,
  buildSamples,
  runDatasetBuild,
  getSamples,
  getRecentBuildRuns,
  type SampleBuildResult,
  type BuildBatchResult,
} from './dataset_builder.service.js';

export {
  getDatasetStats,
  checkDatasetQuality,
  getSkipReasonStats,
  type DatasetStats,
  type QualityAlert,
} from './dataset_quality.service.js';

export {
  exportJSONL,
  exportCSV,
  exportJSONLStream,
  exportCSVStream,
  getSchemaInfo,
  type ExportOptions,
  type ExportMeta,
} from './dataset_export.service.js';

// Worker
export {
  startDatasetWorker,
  stopDatasetWorker,
  getDatasetWorkerStatus,
  runDatasetWorkerOnce,
} from './dataset_builder.worker.js';

// Routes
export { datasetRoutes } from './dataset.routes.js';
