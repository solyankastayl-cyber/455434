/**
 * Engine V2: Signals Fetcher
 * 
 * Fetches D1 signals by subject (actor/entity) for a time window
 */
import { D1SignalModel } from '../d1_signals/d1_signal.model.js';
import type { D1Window, D1Signal } from '../d1_signals/d1_signal.types.js';

export type EngineWindow = '1h' | '6h' | '24h' | '7d';

/**
 * Fetch signals for a given subject
 */
export async function fetchSignalsBySubject(
  subjectType: 'actor' | 'entity',
  subjectId: string,
  window: EngineWindow
): Promise<D1Signal[]> {
  // Map engine windows to D1 windows (D1 only supports 24h, 7d, 30d)
  const d1Window: D1Window = window === '1h' || window === '6h' ? '24h' : 
                             window === '24h' ? '24h' : '7d';
  
  // Build query based on subject type
  const query: any = {
    window: d1Window,
    status: { $in: ['new', 'active', 'cooling'] }, // Exclude archived
  };
  
  if (subjectType === 'actor') {
    query.$or = [
      { 'primary.kind': 'actor', 'primary.id': subjectId },
      { 'secondary.kind': 'actor', 'secondary.id': subjectId },
      { 'entities': { $elemMatch: { kind: 'actor', id: subjectId } } },
    ];
  } else {
    query.$or = [
      { 'primary.kind': 'entity', 'primary.id': subjectId },
      { 'secondary.kind': 'entity', 'secondary.id': subjectId },
      { 'entities': { $elemMatch: { kind: 'entity', id: subjectId } } },
    ];
  }
  
  const signals = await D1SignalModel.find(query)
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  
  return signals as D1Signal[];
}

/**
 * Fetch all signals for a window (for global analysis)
 */
export async function fetchAllSignals(window: EngineWindow): Promise<D1Signal[]> {
  const d1Window: D1Window = window === '1h' || window === '6h' ? '24h' : 
                             window === '24h' ? '24h' : '7d';
  
  const signals = await D1SignalModel.find({
    window: d1Window,
    status: { $in: ['new', 'active', 'cooling'] },
  })
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();
  
  return signals as D1Signal[];
}
