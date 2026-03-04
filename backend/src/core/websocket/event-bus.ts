/**
 * Event Bus (P2.3)
 * 
 * Central event emitter for internal system events.
 * All events go through this bus before reaching WebSocket clients.
 * 
 * Pattern: Worker/Service → EventBus → WS Gateway → Clients
 */
import { EventEmitter } from 'events';

// Typed event names
export type EventType = 
  | 'bootstrap.progress'
  | 'bootstrap.done'
  | 'bootstrap.failed'
  | 'resolver.updated'
  | 'attribution.confirmed'
  | 'attribution.suspected'
  | 'alert.new'
  | 'signal.new';

// Event payloads
export interface BootstrapProgressEvent {
  type: 'bootstrap.progress';
  dedupKey: string;
  progress: number;
  step: string;
  eta: number | null;
}

export interface BootstrapDoneEvent {
  type: 'bootstrap.done';
  dedupKey: string;
}

export interface BootstrapFailedEvent {
  type: 'bootstrap.failed';
  dedupKey: string;
  error: string;
}

export interface ResolverUpdatedEvent {
  type: 'resolver.updated';
  input: string;
  status: string;
  confidence: number;
  label?: string;
}

export interface AttributionConfirmedEvent {
  type: 'attribution.confirmed';
  subjectType: string;
  subjectId: string;
  address: string;
}

export interface AlertNewEvent {
  type: 'alert.new';
  alertId: string;
  severity: number;
  message: string;
}

export interface SignalNewEvent {
  type: 'signal.new';
  signalId: string;
  actor: string;
  action: string;
}

export type SystemEvent = 
  | BootstrapProgressEvent
  | BootstrapDoneEvent
  | BootstrapFailedEvent
  | ResolverUpdatedEvent
  | AttributionConfirmedEvent
  | AlertNewEvent
  | SignalNewEvent;

// Single global event bus
class EventBus extends EventEmitter {
  private static instance: EventBus;
  
  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many WS connections
  }
  
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }
  
  /**
   * Emit a typed system event
   */
  emitEvent(event: SystemEvent): void {
    console.log(`[EventBus] ${event.type}:`, JSON.stringify(event).slice(0, 100));
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard for WS gateway
  }
  
  /**
   * Subscribe to all events (for WS gateway)
   */
  onAnyEvent(callback: (event: SystemEvent) => void): void {
    this.on('*', callback);
  }
  
  /**
   * Unsubscribe from all events
   */
  offAnyEvent(callback: (event: SystemEvent) => void): void {
    this.off('*', callback);
  }
}

export const eventBus = EventBus.getInstance();
export default eventBus;
