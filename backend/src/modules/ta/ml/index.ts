/**
 * Phase W: ML Module Index
 */

// Feature schema
export {
  type MLFeatures,
  type MLDatasetRow,
  getFeatureNames,
  createEmptyFeatures,
} from './feature_schema.js';

// Feature extractor
export {
  extractFeatures,
  featuresToArray,
  type ExtractorInput,
} from './feature_extractor.js';

// Dataset writer
export {
  initDatasetIndexes,
  writeDatasetRow,
  writeDatasetRows,
  getDatasetStats,
  queryDatasetRows,
  exportDatasetCSV,
  clearDataset,
  getDatasetPreview,
  type DatasetStats,
} from './dataset_writer.js';

// Model registry
export {
  initModelIndexes,
  registerModel,
  checkGates,
  activateModel,
  getActiveModel,
  getAllModels,
  getModel,
  deleteModel,
  type ModelStatus,
  type ModelMetrics,
  type ModelGates,
  type MLModel,
} from './model_registry.js';
