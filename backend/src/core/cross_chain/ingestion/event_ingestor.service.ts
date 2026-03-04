/**
 * Event Ingestor Service (P2.3.2)
 * 
 * Ingests events from chain adapters into unified store
 * - Normalization
 * - Deduplication
 * - Bulk insert
 * - Retry-safe
 * - Idempotent
 */

import { 
  UnifiedChainEventModel, 
  type UnifiedChainEvent,
  eventExists
} from '../storage/unified_events.model.js';
import { 
  addEventIds, 
  deduplicateInMemory 
} from '../deduplication/event_deduplicator.js';

// ============================================
// Ingestion Stats
// ============================================

interface IngestionResult {
  success: boolean;
  inserted: number;
  duplicates: number;
  errors: number;
  errorMessages: string[];
}

// ============================================
// Event Ingestor
// ============================================

/**
 * Ingest a batch of events
 * 
 * Features:
 * - Automatic deduplication
 * - Bulk insert for performance
 * - Handles MongoDB duplicate key errors
 * - Returns detailed stats
 */
export async function ingestEvents(
  events: Omit<UnifiedChainEvent, 'eventId' | 'createdAt'>[]
): Promise<IngestionResult> {
  if (events.length === 0) {
    return {
      success: true,
      inserted: 0,
      duplicates: 0,
      errors: 0,
      errorMessages: []
    };
  }
  
  try {
    // Add event IDs
    const eventsWithIds = addEventIds(events);
    
    // Deduplicate in memory
    const uniqueEvents = deduplicateInMemory(eventsWithIds);
    const inMemoryDuplicates = events.length - uniqueEvents.length;
    
    // Normalize addresses
    const normalizedEvents = uniqueEvents.map(event => ({
      ...event,
      from: event.from.toLowerCase(),
      to: event.to.toLowerCase(),
      tokenAddress: event.tokenAddress?.toLowerCase(),
      createdAt: new Date()
    }));
    
    // Bulk insert with ordered: false to continue on duplicate key errors
    const bulkOps = normalizedEvents.map(event => ({
      insertOne: {
        document: event
      }
    }));
    
    try {
      const result = await UnifiedChainEventModel.bulkWrite(bulkOps, {
        ordered: false // Continue on errors
      });
      
      return {
        success: true,
        inserted: result.insertedCount || 0,
        duplicates: inMemoryDuplicates + (normalizedEvents.length - (result.insertedCount || 0)),
        errors: 0,
        errorMessages: []
      };
      
    } catch (error: any) {
      // Handle MongoDB duplicate key errors
      if (error.code === 11000 || error.name === 'MongoBulkWriteError') {
        const inserted = error.result?.nInserted || 0;
        const duplicates = normalizedEvents.length - inserted;
        
        return {
          success: true,
          inserted,
          duplicates: inMemoryDuplicates + duplicates,
          errors: 0,
          errorMessages: []
        };
      }
      
      throw error;
    }
    
  } catch (error: any) {
    console.error('[Ingestor] Error ingesting events:', error);
    
    return {
      success: false,
      inserted: 0,
      duplicates: 0,
      errors: events.length,
      errorMessages: [error.message]
    };
  }
}

/**
 * Ingest single event (convenience wrapper)
 */
export async function ingestEvent(
  event: Omit<UnifiedChainEvent, 'eventId' | 'createdAt'>
): Promise<IngestionResult> {
  return ingestEvents([event]);
}

/**
 * Check if events would be duplicates before inserting
 */
export async function checkDuplicates(
  events: Omit<UnifiedChainEvent, 'eventId' | 'createdAt'>[]
): Promise<{
  duplicates: string[];
  new: string[];
}> {
  const eventsWithIds = addEventIds(events);
  const eventIds = eventsWithIds.map(e => e.eventId);
  
  const existing = await UnifiedChainEventModel.find({
    eventId: { $in: eventIds }
  }).select('eventId').lean();
  
  const existingIds = new Set(existing.map(e => e.eventId));
  
  const duplicates = eventIds.filter(id => existingIds.has(id));
  const newIds = eventIds.filter(id => !existingIds.has(id));
  
  return {
    duplicates,
    new: newIds
  };
}

/**
 * Get ingestion statistics
 */
export async function getIngestionStats(): Promise<{
  totalEvents: number;
  eventsBySource: Record<string, number>;
  oldestEvent: number;
  newestEvent: number;
}> {
  const [bySource, oldest, newest] = await Promise.all([
    UnifiedChainEventModel.aggregate([
      { $group: { _id: '$ingestionSource', count: { $sum: 1 } } }
    ]),
    UnifiedChainEventModel.findOne().sort({ timestamp: 1 }).select('timestamp').lean(),
    UnifiedChainEventModel.findOne().sort({ timestamp: -1 }).select('timestamp').lean()
  ]);
  
  const eventsBySource = bySource.reduce((acc, stat) => {
    acc[stat._id] = stat.count;
    return acc;
  }, {} as Record<string, number>);
  
  const totalEvents = Object.values(eventsBySource).reduce((sum, count) => sum + count, 0);
  
  return {
    totalEvents,
    eventsBySource,
    oldestEvent: oldest?.timestamp || 0,
    newestEvent: newest?.timestamp || 0
  };
}
