/**
 * Phase O: Event Bus
 * 
 * In-process event bus for real-time event distribution
 */

import { TAStreamEvent } from './stream_types.js';

type Handler = (e: TAStreamEvent) => void;

export class EventBus {
  private handlers = new Set<Handler>();
  private eventCount = 0;
  private lastEvent: TAStreamEvent | null = null;

  /**
   * Subscribe to events
   * @returns Unsubscribe function
   */
  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Publish event to all subscribers
   */
  publish(event: TAStreamEvent): void {
    this.eventCount++;
    this.lastEvent = event;
    
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[EventBus] Handler error:', err);
      }
    }
  }

  /**
   * Get subscriber count
   */
  get subscriberCount(): number {
    return this.handlers.size;
  }

  /**
   * Get stats
   */
  getStats(): { subscribers: number; eventCount: number; lastEvent: TAStreamEvent | null } {
    return {
      subscribers: this.handlers.size,
      eventCount: this.eventCount,
      lastEvent: this.lastEvent,
    };
  }

  /**
   * Clear all subscribers
   */
  clear(): void {
    this.handlers.clear();
  }
}

// Singleton instance
export const globalEventBus = new EventBus();
