/**
 * BLOCK 23-29.19: Fractal Settings Schema
 * Auto-tunable parameters for self-learning + ensemble + calibration + risk
 */

import { Schema, model } from 'mongoose';

const FractalSettingsSchema = new Schema(
  {
    symbol: { type: String, required: true },

    // BLOCK 23: Base tunable parameters
    minWindowQuality: { type: Number, default: 0.7 },
    scoreQualityPower: { type: Number, default: 1.5 },
    regimeWeightBoost: { type: Number, default: 1.0 },

    // BLOCK 24.9: Bad regimes (auto-disabled)
    badRegimes: [{
      trend: { type: String },
      vol: { type: String }
    }],

    // BLOCK 25: Confidence calibration
    confidenceScale: { type: Number, default: 1.0 },
    confidenceBias: { type: Number, default: 0.0 },

    // BLOCK 28: Ensemble weights
    ensemble: {
      w_rule: { type: Number, default: 0.5 },
      w_ml: { type: Number, default: 0.5 },
      threshold: { type: Number, default: 0.15 }
    },

    // BLOCK 29.16: Cost model (transaction costs)
    costModel: {
      feeBps: { type: Number, default: 4 },        // Commission bps (0.04%)
      slippageBps: { type: Number, default: 6 },   // Slippage bps
      spreadBps: { type: Number, default: 2 },     // Half-spread bps
      neutralHoldBps: { type: Number, default: 0 } // Penalty for flat (usually 0)
    },

    // BLOCK 29.17: Risk model (volatility targeting)
    riskModel: {
      volTargetAnnual: { type: Number, default: 0.6 }, // 60% annualized target
      maxLeverage: { type: Number, default: 2.0 },     // Max leverage clamp
      minLeverage: { type: Number, default: 0.0 },     // Min leverage (0 = can be flat)
      volLookbackDays: { type: Number, default: 60 }   // Realized vol lookback
    },

    // BLOCK 29.18: Drawdown model (kill switch + taper)
    ddModel: {
      softDD: { type: Number, default: 0.12 },     // 12% DD -> taper starts
      hardDD: { type: Number, default: 0.25 },     // 25% DD -> kill switch
      minMult: { type: Number, default: 0.15 },    // Minimum exposure multiplier
      taperPower: { type: Number, default: 1.5 },  // Taper curvature
      coolDownDays: { type: Number, default: 30 }  // Cool down after recovery
    },

    // BLOCK 29.19: Regime exposure map
    regimeExposure: {
      enabled: { type: Boolean, default: true },
      
      // Default multipliers by trend/vol
      defaults: {
        UP_TREND: { type: Number, default: 1.0 },
        SIDEWAYS: { type: Number, default: 0.6 },
        DOWN_TREND: { type: Number, default: 0.7 },
        LOW_VOL: { type: Number, default: 1.0 },
        NORMAL_VOL: { type: Number, default: 1.0 },
        HIGH_VOL: { type: Number, default: 0.5 }
      },

      // Override specific combinations
      overrides: [{
        trend: { type: String },
        vol: { type: String },
        mult: { type: Number }
      }]
    },

    // BLOCK 29.20: Position lifecycle model
    positionModel: {
      enabled: { type: Boolean, default: true },

      enterThreshold: { type: Number, default: 0.20 },   // confidence to enter
      exitThreshold: { type: Number, default: 0.10 },    // confidence below -> exit

      minHoldDays: { type: Number, default: 10 },        // no exit before min hold
      maxHoldDays: { type: Number, default: 45 },        // force exit
      coolDownDays: { type: Number, default: 5 },        // after exit/flip

      flipAllowed: { type: Boolean, default: true },     // allow LONG<->SHORT
      flipThreshold: { type: Number, default: 0.35 }     // stronger confidence to flip
    },

    // BLOCK 29.24: Promotion freeze
    promotionFrozenUntil: { type: Date },

    // BLOCK 29.25: Auto train window adaptation
    autoTrainWindow: {
      enabled: { type: Boolean, default: true },
      windowYears: { type: [Number], default: [4, 6, 8, 10] },
      minStartDate: { type: String, default: '2014-01-01' },
      endMode: { type: String, default: 'LATEST_SETTLED' },
      weights: {
        wfTradingStability: { type: Number, default: 0.45 },
        wfTradingMedianSharpe: { type: Number, default: 0.25 },
        cvLogLoss: { type: Number, default: 0.15 },
        cvAcc: { type: Number, default: 0.10 },
        maxDD: { type: Number, default: 0.05 }
      },
      budget: {
        maxCandidates: { type: Number, default: 5 },
        maxTrainMinutes: { type: Number, default: 25 }
      },
      earlyStop: {
        enabled: { type: Boolean, default: true },
        minScoreGain: { type: Number, default: 0.08 },
        minStability: { type: Number, default: 0.22 },
        minMedianSharpe: { type: Number, default: 0.55 },
        requireBeatsActive: { type: Boolean, default: true }
      },
      filters: {
        minSamples: { type: Number, default: 500 },
        minYears: { type: Number, default: 4 },
        dropIfAccBelow: { type: Number, default: 0.515 }
      },
      purgeDays: { type: Number, default: 30 }
    },

    // BLOCK 29.29: Ensemble mode
    ensembleMode: {
      enabled: { type: Boolean, default: false },
      windows: { type: [Number], default: [4, 6, 8] },
      weightBy: { type: String, default: 'SCORE' },
      minWeight: { type: Number, default: 0.10 },
      temperature: { type: Number, default: 2.0 }
    },

    // BLOCK 29.31: Adaptive horizon
    adaptiveHorizon: {
      enabled: { type: Boolean, default: true },
      horizons: { type: [Number], default: [14, 30, 60] },
      policy: { type: String, default: 'STABILITY' },
      fixed: { type: Number, default: 30 },
      minSamplesPerHorizon: { type: Number, default: 80 },
      minStability: { type: Number, default: 0.15 }
    },

    // Performance metrics at time of last tune
    lastTuneMetrics: {
      hitRate: { type: Number },
      mae: { type: Number },
      sampleCount: { type: Number }
    },

    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalSettingsSchema.index({ symbol: 1 }, { unique: true });

export const FractalSettingsModel = model('fractal_settings', FractalSettingsSchema);
