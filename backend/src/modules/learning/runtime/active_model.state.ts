/**
 * PHASE 5.2 — Active Model State
 * ================================
 * In-memory state for active/candidate models
 * Single source of truth for runtime model selection
 */

import { MlModelRegistry } from '../storage/ml_model.model.js';

// Runtime state
let ACTIVE_MODEL_ID: string | null = null;
let PREV_ACTIVE_MODEL_ID: string | null = null;
let CANDIDATE_MODEL_ID: string | null = null;
let INITIALIZED = false;

/**
 * Active Model State Manager
 */
export const ActiveModelState = {
  getActive: () => ACTIVE_MODEL_ID,
  getPrevActive: () => PREV_ACTIVE_MODEL_ID,
  getCandidate: () => CANDIDATE_MODEL_ID,
  isInitialized: () => INITIALIZED,

  setActive: (id: string | null) => {
    if (id && ACTIVE_MODEL_ID && ACTIVE_MODEL_ID !== id) {
      PREV_ACTIVE_MODEL_ID = ACTIVE_MODEL_ID;
    }
    ACTIVE_MODEL_ID = id;
    console.log(`[ActiveModelState] Active model set to: ${id}`);
  },

  setCandidate: (id: string | null) => {
    CANDIDATE_MODEL_ID = id;
    console.log(`[ActiveModelState] Candidate model set to: ${id}`);
  },

  setPrevActive: (id: string | null) => {
    PREV_ACTIVE_MODEL_ID = id;
  },

  /**
   * Initialize state from database on startup
   */
  async initialize(): Promise<void> {
    if (INITIALIZED) return;

    try {
      // Load active model
      const activeModel = await MlModelRegistry.findOne({ stage: 'ACTIVE' }).sort({ promotedAt: -1 });
      if (activeModel) {
        ACTIVE_MODEL_ID = activeModel.modelId;
        console.log(`[ActiveModelState] Loaded active model: ${ACTIVE_MODEL_ID}`);
      }

      // Load candidate model
      const candidateModel = await MlModelRegistry.findOne({ stage: 'CANDIDATE' }).sort({ createdAt: -1 });
      if (candidateModel) {
        CANDIDATE_MODEL_ID = candidateModel.modelId;
        console.log(`[ActiveModelState] Loaded candidate model: ${CANDIDATE_MODEL_ID}`);
      }

      // Load previous active (most recently retired)
      const retiredModel = await MlModelRegistry.findOne({ stage: 'RETIRED' }).sort({ updatedAt: -1 });
      if (retiredModel) {
        PREV_ACTIVE_MODEL_ID = retiredModel.modelId;
        console.log(`[ActiveModelState] Loaded prev active model: ${PREV_ACTIVE_MODEL_ID}`);
      }

      INITIALIZED = true;
      console.log('[ActiveModelState] Initialization complete');
    } catch (error) {
      console.error('[ActiveModelState] Initialization failed:', error);
    }
  },

  /**
   * Get full state snapshot
   */
  getState(): {
    active: string | null;
    candidate: string | null;
    prevActive: string | null;
    initialized: boolean;
  } {
    return {
      active: ACTIVE_MODEL_ID,
      candidate: CANDIDATE_MODEL_ID,
      prevActive: PREV_ACTIVE_MODEL_ID,
      initialized: INITIALIZED,
    };
  },

  /**
   * Reset state (for testing)
   */
  reset(): void {
    ACTIVE_MODEL_ID = null;
    PREV_ACTIVE_MODEL_ID = null;
    CANDIDATE_MODEL_ID = null;
    INITIALIZED = false;
  },
};

console.log('[Phase 5.2] Active Model State loaded');
