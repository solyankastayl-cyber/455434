/**
 * Update Adaptive Weights Job (Phase 12A.1 + 12A.2)
 * 
 * Processes recent feedback and adjusts weights accordingly.
 * Runs every 10 minutes.
 */
import { FeedbackModel } from '../core/feedback/feedback.model.js';
import { processFeedbackForWeights } from '../core/adaptive/adaptive.service.js';
import { getWeightsStats, getBoundaryWeights } from '../core/adaptive/adaptive_weights.repository.js';

interface UpdateWeightsResult {
  processedFeedback: number;
  weightsAdjusted: number;
  boundaryHits: number;
  warnings: string[];
  duration: number;
}

// Track last processed feedback
let lastProcessedAt = new Date(0);

/**
 * Update adaptive weights based on feedback
 */
export async function updateAdaptiveWeights(): Promise<UpdateWeightsResult> {
  const start = Date.now();
  let processedFeedback = 0;
  let weightsAdjusted = 0;
  let boundaryHits = 0;
  const warnings: string[] = [];
  
  try {
    // Get feedback since last run
    const newFeedback = await FeedbackModel
      .find({ 
        createdAt: { $gt: lastProcessedAt },
        rating: { $exists: true }
      })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
    
    for (const feedback of newFeedback) {
      try {
        const result = await processFeedbackForWeights(feedback._id.toString());
        
        processedFeedback++;
        weightsAdjusted += result.adjusted.length;
        boundaryHits += result.boundaryHits.length;
        
        // Log boundary hits
        for (const hit of result.boundaryHits) {
          warnings.push(`Weight ${hit} hit boundary`);
          console.log(`[Adaptive Weights] WARNING: Weight ${hit} hit boundary limit`);
        }
        
      } catch (err) {
        console.error(`[Adaptive Weights] Error processing feedback ${feedback._id}:`, err);
      }
    }
    
    // Update last processed timestamp
    if (newFeedback.length > 0) {
      lastProcessedAt = new Date(newFeedback[newFeedback.length - 1].createdAt);
    }
    
    // Check for weights that have hit boundaries multiple times
    const boundaryWeights = await getBoundaryWeights();
    if (boundaryWeights.length > 0) {
      warnings.push(
        `${boundaryWeights.length} weights have hit boundaries >5 times - may need recalibration`
      );
    }
    
  } catch (err) {
    console.error('[Adaptive Weights] Job failed:', err);
  }
  
  return {
    processedFeedback,
    weightsAdjusted,
    boundaryHits,
    warnings,
    duration: Date.now() - start,
  };
}

/**
 * Get job status
 */
export async function getUpdateAdaptiveWeightsStatus() {
  const stats = await getWeightsStats();
  const boundaryWeights = await getBoundaryWeights();
  
  return {
    ...stats,
    lastProcessedAt,
    weightsAtBoundary: boundaryWeights.length,
  };
}
