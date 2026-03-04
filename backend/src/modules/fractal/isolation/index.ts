/**
 * BLOCK B — Module Isolation
 * Public exports for isolation components
 */

// Host Dependencies Contract
export {
  type FractalHostDeps,
  type Logger,
  type Clock,
  type Db,
  type DbCollection,
  type Settings,
  type HttpClient,
  type HttpResponse,
  type RequestOptions,
  type TelegramNotifier,
  type TelegramOptions,
  defaultLogger,
  defaultClock,
  createSettingsFromEnv,
  isValidHostDeps,
  assertHostDeps,
} from './fractal.host.deps.js';

// Fail Containment
export {
  FailContainment,
  withContainment,
  withContainmentSync,
  contained,
  type SafeSignalResult,
  type ContainmentConfig,
  type FractalSignalType,
} from './fail.containment.js';

// Forbidden Imports
export {
  FORBIDDEN_IMPORTS,
  ALLOWED_EXTERNAL_IMPORTS,
  FRACTAL_MODULE_PATHS,
  type ForbiddenImportRule,
  type ImportViolation,
  type IsolationReport,
} from './forbidden.imports.js';
