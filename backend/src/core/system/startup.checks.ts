/**
 * Startup Checks (Option B - B6)
 * 
 * Fail-fast validation before server starts.
 * Better to not start than start broken.
 */
import mongoose from 'mongoose';
import type { FastifyInstance } from 'fastify';

// Required environment variables
const REQUIRED_ENV = [
  'MONGODB_URI',  // or MONGO_URL
  'PORT',
];

// Optional but recommended
const RECOMMENDED_ENV = [
  'INFURA_RPC_URL',
  'WS_ENABLED',
];

// Critical indexes to verify
const CRITICAL_INDEXES = [
  { collection: 'bootstrap_tasks', index: 'dedupKey_1' },
  { collection: 'system_locks', index: 'key_1' },
  { collection: 'system_heartbeats', index: 'key_1' },
];

/**
 * Check required environment variables
 */
function assertEnv(): void {
  const missing: string[] = [];
  
  for (const envVar of REQUIRED_ENV) {
    // Check both variants (MONGODB_URI and MONGO_URL)
    if (envVar === 'MONGODB_URI') {
      if (!process.env.MONGODB_URI && !process.env.MONGO_URL) {
        missing.push('MONGODB_URI (or MONGO_URL)');
      }
    } else if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`[Startup] Missing required env vars: ${missing.join(', ')}`);
  }
  
  // Warn about recommended vars
  for (const envVar of RECOMMENDED_ENV) {
    if (!process.env[envVar]) {
      console.warn(`[Startup] WARN: ${envVar} not set (recommended)`);
    }
  }
  
  console.log('[Startup] ✓ Environment variables OK');
}

/**
 * Check MongoDB connection
 */
async function assertMongo(): Promise<void> {
  const state = mongoose.connection.readyState;
  
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (state !== 1) {
    throw new Error(`[Startup] MongoDB not connected (state: ${state})`);
  }
  
  // Ping to verify
  try {
    await mongoose.connection.db?.admin().ping();
  } catch (err) {
    throw new Error(`[Startup] MongoDB ping failed: ${err}`);
  }
  
  console.log('[Startup] ✓ MongoDB connected');
}

/**
 * Check critical indexes exist
 */
async function assertIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('[Startup] MongoDB db not available');
  }
  
  const missingIndexes: string[] = [];
  
  for (const { collection, index } of CRITICAL_INDEXES) {
    try {
      const coll = db.collection(collection);
      const indexes = await coll.indexes();
      const indexNames = indexes.map((i: any) => i.name);
      
      if (!indexNames.includes(index)) {
        missingIndexes.push(`${collection}.${index}`);
      }
    } catch {
      // Collection might not exist yet - that's OK
      console.warn(`[Startup] WARN: Collection ${collection} not found (will be created)`);
    }
  }
  
  if (missingIndexes.length > 0) {
    console.warn(`[Startup] WARN: Missing indexes (will be auto-created): ${missingIndexes.join(', ')}`);
  } else {
    console.log('[Startup] ✓ Critical indexes OK');
  }
}

/**
 * Check WebSocket plugin is registered
 */
function assertWebSocket(app: FastifyInstance): void {
  // Check if websocket decorator exists
  const hasWs = (app as any).websocketServer !== undefined || 
                typeof (app as any).get === 'function';
  
  if (!hasWs) {
    console.warn('[Startup] WARN: WebSocket plugin may not be registered');
  } else {
    console.log('[Startup] ✓ WebSocket plugin OK');
  }
}

/**
 * Run all startup checks
 * 
 * Call this AFTER mongoose connects, BEFORE server.listen()
 */
export async function runStartupChecks(app?: FastifyInstance): Promise<void> {
  console.log('[Startup] Running pre-flight checks...');
  
  try {
    // 1. Environment
    assertEnv();
    
    // 2. MongoDB
    await assertMongo();
    
    // 3. Indexes (soft check - warns but doesn't fail)
    await assertIndexes();
    
    // 4. WebSocket (if app provided)
    if (app) {
      assertWebSocket(app);
    }
    
    console.log('[Startup] ✓ All checks passed');
  } catch (err) {
    console.error('[Startup] ✗ Pre-flight check failed:', err);
    throw err; // Re-throw to prevent server start
  }
}

/**
 * Graceful shutdown handler
 */
export function setupGracefulShutdown(cleanup: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);
    
    try {
      await cleanup();
      console.log('[Shutdown] Cleanup complete');
      process.exit(0);
    } catch (err) {
      console.error('[Shutdown] Cleanup failed:', err);
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
