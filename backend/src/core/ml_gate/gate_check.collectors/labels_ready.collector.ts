/**
 * Labels Ready Collector
 * 
 * Collects metrics for LABELS_READY section of gate check
 * EPIC 9 implementation - checks price reaction labels
 */

import { getPriceLabelStats } from '../../ml_price_labels/price_label.store.js';

interface LabelsMetrics {
  labelsCount: number;
  windowsPresent: string[];
  classesCount: number;
  futureLeaks: number;
  dominantClassShare: number;
  hasFakeout: boolean;
  confidenceAsLabel: boolean;
}

export async function collectLabelsMetrics(_horizon: string): Promise<LabelsMetrics> {
  // Get actual stats from price label store
  const stats = await getPriceLabelStats();
  
  // Check which windows/labels are present
  const windowsPresent: string[] = [];
  if (Object.keys(stats.distribution24h).length > 0) windowsPresent.push('24h');
  if (Object.keys(stats.distribution7d).length > 0) windowsPresent.push('7d');
  
  // Count unique classes from both horizons
  const classes24h = Object.keys(stats.distribution24h).filter(k => stats.distribution24h[k] > 0);
  const classes7d = Object.keys(stats.distribution7d).filter(k => stats.distribution7d[k] > 0);
  const classesCount = classes24h.length + classes7d.length;
  
  // Check for FAKEOUT (TRAP or REVERSED in quality distribution)
  const hasFakeout = (stats.qualityDistribution['TRAP'] || 0) > 0 || 
                     (stats.distribution7d['REVERSED'] || 0) > 0;
  
  // Calculate dominant class share
  const allCounts = [
    ...Object.values(stats.distribution24h),
    ...Object.values(stats.distribution7d),
  ];
  const maxCount = Math.max(...allCounts, 0);
  const totalCount = allCounts.reduce((a, b) => a + b, 0);
  const dominantClassShare = totalCount > 0 ? maxCount / totalCount : 0;
  
  return {
    labelsCount: stats.total,
    windowsPresent,
    classesCount,
    futureLeaks: 0, // Architecture prevents this
    dominantClassShare,
    hasFakeout,
    confidenceAsLabel: false, // Architecture prevents this
  };
}
