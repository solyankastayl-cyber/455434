/**
 * WebSocket Module Index (P2.3)
 */
export { eventBus, type SystemEvent, type EventType } from './event-bus.js';
export { registerWebSocket, setupWebSocketGateway, stopHeartbeat, getConnectionStats } from './ws-gateway.js';
