/**
 * BLOCK 29.3 + 29.13-29.15 + 29.25-29.32: Model Registry Schema
 * Tracks all model versions with their status, metrics, and walk-forward evaluations
 */

import { Schema, model } from 'mongoose';

const FractalModelRegistrySchema = new Schema(
  {
    symbol: { type: String, required: true },
    version: { type: String, required: true }, // e.g. v_1700000000

    // BLOCK 29.32: Model key for horizon-specific models
    modelKey: { type: String }, // e.g. "BTC:30" for 30-day horizon

    status: { type: String, required: true }, // ACTIVE | SHADOW | ARCHIVED | FAILED

    type: { type: String, required: true }, // logreg, logreg_scaled, xgboost, etc.

    // Basic metrics
    metrics: {
      cv_acc: { type: Number },
      cv_logloss: { type: Number },
      samples: { type: Number },
      shadow_sharpe: { type: Number },
      shadow_hitRate: { type: Number },
      shadow_maxDD: { type: Number },
      shadow_cagr: { type: Number }
    },

    // BLOCK 29.13: Train window metadata
    trainWindow: {
      requestedFrom: { type: String },  // YYYY-MM-DD or null
      requestedTo: { type: String },
      actualFrom: { type: String },
      actualTo: { type: String },
      purgeDays: { type: Number },
      splits: { type: Number },
      bestC: { type: Number },
      samples: { type: Number },
      datasetHash: { type: String },
      // BLOCK 29.25: Window selection metadata
      years: { type: Number },
      reason: { type: String },
      // BLOCK 29.31: Horizon for this model
      horizonDays: { type: Number, default: 30 }
    },

    // BLOCK 29.14: Walk-forward proxy evaluation (Python ML)
    walkForward: {
      evalStart: { type: String },
      evalEnd: { type: String },
      windowDays: { type: Number },
      stepDays: { type: Number },
      windows: { type: Number },
      median_proxy_sharpe: { type: Number },
      std_proxy_sharpe: { type: Number },
      positive_window_frac: { type: Number },
      stability_score: { type: Number },
      reportPath: { type: String }
    },

    // BLOCK 29.15: Walk-forward trading evaluation (real backtest)
    walkForwardTrading: {
      evalStart: { type: Date },
      evalEnd: { type: Date },
      windowDays: { type: Number },
      stepDays: { type: Number },
      purgeDays: { type: Number },
      windows: { type: Number },

      median_sharpe: { type: Number },
      std_sharpe: { type: Number },
      positive_window_frac: { type: Number },
      stability_score: { type: Number },

      median_maxDD: { type: Number },
      median_hitRate: { type: Number },

      // BLOCK 29.27: Meta-stability (variance across folds)
      metaStability: { type: Number },

      // Cost model used
      costModel: {
        feeBps: { type: Number },
        slippageBps: { type: Number },
        spreadBps: { type: Number },
        roundTripCost: { type: Number }
      },

      // Individual window runs
      runs: [{
        fromTs: { type: Date },
        toTs: { type: Date },
        trades: { type: Number },
        sharpe: { type: Number },
        maxDD: { type: Number },
        hitRate: { type: Number },
        cagr: { type: Number },
        avgLeverage: { type: Number },
        avgVolAnn: { type: Number }
      }]
    },

    // BLOCK 29.25: Window scoring for auto-selection
    windowScore: {
      score: { type: Number },
      components: {
        cvAcc: { type: Number },
        cvLL: { type: Number },
        wfStab: { type: Number },
        wfMedS: { type: Number },
        maxDD: { type: Number }
      }
    },

    // BLOCK 29.28: ML explainability
    mlExplain: {
      featureNames: [String],
      importances: [Number],
      normalizedImportances: [Number]
    },

    // BLOCK 29.29: Ensemble membership
    ensemble: {
      groupId: { type: String },
      member: { type: Boolean, default: false },
      weight: { type: Number, default: 0 }
    },

    artifactPath: { type: String }, // where json artifact is stored

    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalModelRegistrySchema.index({ symbol: 1, version: 1 }, { unique: true });
FractalModelRegistrySchema.index({ symbol: 1, status: 1 });
FractalModelRegistrySchema.index({ modelKey: 1, status: 1 });

export const FractalModelRegistryModel = model('fractal_model_registry', FractalModelRegistrySchema);
