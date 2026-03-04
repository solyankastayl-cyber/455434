import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8001),

  MONGODB_URI: z.string().min(1),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // WebSocket
  WS_ENABLED: z.coerce.boolean().default(true),

  // CORS
  CORS_ORIGINS: z.string().default('*'),

  // Ethereum RPC (Infura)
  INFURA_RPC_URL: z.string().url().optional(),
  
  // Ankr RPC (secondary)
  ANKR_RPC_URL: z.string().url().optional(),
  
  // Arbitrum RPC
  ARBITRUM_RPC_URL: z.string().url().optional(),
  
  // Indexer settings
  INDEXER_ENABLED: z.coerce.boolean().default(true),
  INDEXER_INTERVAL_MS: z.coerce.number().default(15000), // 15 seconds

  // Phase 12A - Adaptive Intelligence
  ADAPTIVE_LEARNING_RATE: z.coerce.number().default(0.02),
  ADAPTIVE_LEARNING_RATE_MIN: z.coerce.number().default(0.005),
  ADAPTIVE_LEARNING_RATE_MAX: z.coerce.number().default(0.05),
  ADAPTIVE_WEIGHT_CORRIDOR: z.coerce.number().default(0.25), // ±25%
  ADAPTIVE_CUMULATIVE_DRIFT_CAP: z.coerce.number().default(1.25), // Hard cap on total drift
  CONFIDENCE_FLOOR: z.coerce.number().default(0.15), // Minimum confidence stability
  CONFIDENCE_SMOOTHING_FACTOR: z.coerce.number().default(0.3), // New * 0.3 + Prev * 0.7
  
  // Legacy Python compatibility
  LEGACY_PYTHON_ENABLED: z.coerce.boolean().default(false),
  
  // ML Service URL (Phase 4)
  ML_SERVICE_URL: z.string().url().default('http://localhost:8002'),
  
  // BATCH 2: Python ML Service
  PY_ML_URL: z.string().url().default('http://localhost:8002'),
  PY_ML_TIMEOUT_MS: z.coerce.number().default(60000), // 60 seconds for training
  
  // Twitter Parser V2 URL
  PARSER_URL: z.string().url().default('http://localhost:5001'),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGODB_URI: process.env.MONGODB_URI,
  LOG_LEVEL: process.env.LOG_LEVEL,
  WS_ENABLED: process.env.WS_ENABLED,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  INFURA_RPC_URL: process.env.INFURA_RPC_URL,
  ANKR_RPC_URL: process.env.ANKR_RPC_URL,
  ARBITRUM_RPC_URL: process.env.ARBITRUM_RPC_URL,
  INDEXER_ENABLED: process.env.INDEXER_ENABLED,
  INDEXER_INTERVAL_MS: process.env.INDEXER_INTERVAL_MS,
  ADAPTIVE_LEARNING_RATE: process.env.ADAPTIVE_LEARNING_RATE,
  ADAPTIVE_LEARNING_RATE_MIN: process.env.ADAPTIVE_LEARNING_RATE_MIN,
  ADAPTIVE_LEARNING_RATE_MAX: process.env.ADAPTIVE_LEARNING_RATE_MAX,
  ADAPTIVE_WEIGHT_CORRIDOR: process.env.ADAPTIVE_WEIGHT_CORRIDOR,
  ADAPTIVE_CUMULATIVE_DRIFT_CAP: process.env.ADAPTIVE_CUMULATIVE_DRIFT_CAP,
  CONFIDENCE_FLOOR: process.env.CONFIDENCE_FLOOR,
  CONFIDENCE_SMOOTHING_FACTOR: process.env.CONFIDENCE_SMOOTHING_FACTOR,
  LEGACY_PYTHON_ENABLED: process.env.LEGACY_PYTHON_ENABLED,
  ML_SERVICE_URL: process.env.ML_SERVICE_URL,
  PY_ML_URL: process.env.PY_ML_URL,
  PY_ML_TIMEOUT_MS: process.env.PY_ML_TIMEOUT_MS,
  PARSER_URL: process.env.PARSER_URL,
});

/**
 * Adaptive System Version
 */
export const ADAPTIVE_VERSION = '12A.1';
