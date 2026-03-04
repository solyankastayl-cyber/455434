/**
 * Recalibrate Confidence Job (Phase 12A.3)
 * 
 * Processes completed simulations to update confidence calibration.
 * Recalculates calibration factors for all decision types.
 * Runs every 30 minutes.
 */
import { SimulationModel } from '../core/simulations/simulations.model.js';
import {
  processSimulationForCalibration,
  recalibrateAllDecisionTypes,
} from '../core/adaptive/adaptive.service.js';
import {
  getCalibrationStats,
  getPoorlyCalibrated,
} from '../core/adaptive/confidence_calibration.repository.js';

interface RecalibrateResult {
  simulationsProcessed: number;
  calibrationsUpdated: number;
  poorlyCalibrated: number;
  warnings: string[];
  duration: number;
}

// Track last processed simulation
let lastProcessedSimulationAt = new Date(0);

/**
 * Recalibrate confidence based on simulation outcomes
 */
export async function recalibrateConfidence(): Promise<RecalibrateResult> {
  const start = Date.now();
  let simulationsProcessed = 0;
  const warnings: string[] = [];
  
  try {
    // Get completed simulations since last run
    const newSimulations = await SimulationModel
      .find({
        status: 'completed',
        updatedAt: { $gt: lastProcessedSimulationAt },
      })
      .sort({ updatedAt: 1 })
      .limit(100)
      .lean();
    
    for (const simulation of newSimulations) {
      try {
        const processed = await processSimulationForCalibration(simulation._id.toString());
        if (processed) simulationsProcessed++;
      } catch (err) {
        console.error(`[Recalibrate] Error processing simulation ${simulation._id}:`, err);
      }
    }
    
    // Update last processed timestamp
    if (newSimulations.length > 0) {
      lastProcessedSimulationAt = new Date(newSimulations[newSimulations.length - 1].updatedAt);
    }
    
    // Recalculate all calibrations
    const calibrationsUpdated = await recalibrateAllDecisionTypes();
    
    // Check for poorly calibrated subjects
    const poorlyCalibratedList = await getPoorlyCalibrated();
    
    for (const cal of poorlyCalibratedList) {
      if (cal.calibrationFactor < 0.85) {
        warnings.push(
          `Decision type '${cal.subjectId}' is overconfident (factor: ${cal.calibrationFactor.toFixed(2)})`
        );
      } else if (cal.calibrationFactor > 1.15) {
        warnings.push(
          `Decision type '${cal.subjectId}' is underconfident (factor: ${cal.calibrationFactor.toFixed(2)})`
        );
      }
    }
    
    return {
      simulationsProcessed,
      calibrationsUpdated,
      poorlyCalibrated: poorlyCalibratedList.length,
      warnings,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Recalibrate] Job failed:', err);
    return {
      simulationsProcessed: 0,
      calibrationsUpdated: 0,
      poorlyCalibrated: 0,
      warnings: ['Job failed: ' + String(err)],
      duration: Date.now() - start,
    };
  }
}

/**
 * Get job status
 */
export async function getRecalibrateConfidenceStatus() {
  const stats = await getCalibrationStats();
  const poorlyCalibrated = await getPoorlyCalibrated();
  
  return {
    ...stats,
    lastProcessedAt: lastProcessedSimulationAt,
    poorlyCalibratedCount: poorlyCalibrated.length,
    poorlyCalibratedTypes: poorlyCalibrated.map(p => ({
      type: p.subjectId,
      factor: p.calibrationFactor,
    })),
  };
}
