/**
 * BATCH 3: Shadow Evaluation Config
 * 
 * Пороги для определения verdict (PASS/FAIL/INCONCLUSIVE).
 */

export const SHADOW_EVAL_RULES_VERSION = 'v1';

export const SHADOW_EVAL_THRESHOLDS = {
  // Минимум строк для валидного сравнения
  minRows: 500,

  // PASS если f1 улучшилось на >= +0.02 И accuracy не хуже -0.01
  pass: {
    minF1Delta: 0.02,
    minAccuracyDelta: -0.01,
  },

  // FAIL если f1 хуже на -0.01 ИЛИ accuracy хуже на -0.02
  fail: {
    maxF1Delta: -0.01,
    maxAccuracyDelta: -0.02,
  },
};

/**
 * Primary networks для multi-network promotion
 */
export const PRIMARY_NETWORKS = ['ethereum', 'base', 'arbitrum'];

/**
 * Минимум PASS вердиктов из 8 сетей для promotion
 */
export const MIN_PASS_NETWORKS = 6;
