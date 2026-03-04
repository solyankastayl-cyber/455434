/**
 * BLOCK 29.26: Autopilot Run Schema
 * Audit trail for autopilot executions
 */

import { Schema, model } from 'mongoose';

const FractalAutopilotRunSchema = new Schema(
  {
    symbol: { type: String, required: true },
    ts: { type: Date, required: true },

    steps: {
      settled: { type: Schema.Types.Mixed },
      position: { type: Schema.Types.Mixed },
      drift: { type: Schema.Types.Mixed },
      windowSearch: { type: Schema.Types.Mixed },
      decision: { type: Schema.Types.Mixed }
    },

    result: {
      status: { type: String }, // OK | FROZEN | RETRAINED | PROMOTED | ROLLED_BACK | NOOP | ERROR
      reason: { type: String }
    }
  },
  { versionKey: false }
);

FractalAutopilotRunSchema.index({ symbol: 1, ts: -1 });

export const FractalAutopilotRunModel = model('fractal_autopilot_run', FractalAutopilotRunSchema);
