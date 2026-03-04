/**
 * TELEGRAM SPLIT - Parser Health Monitor (Phase 5.2.2)
 * 
 * Monitors parser health and sends system alerts via TelegramRouter
 */

import { telegramRouter } from './index.js';

interface ParserState {
  lastCheckAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  isDown: boolean;
  downSince: Date | null;
}

class ParserHealthMonitor {
  private state: ParserState = {
    lastCheckAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    isDown: false,
    downSince: null,
  };
  
  private readonly FAILURE_THRESHOLD = 3; // Alert after 3 consecutive failures
  private readonly DOWN_MINUTES_THRESHOLD = 5; // Must be down for 5 minutes before alerting
  
  /**
   * Record successful health check
   */
  recordSuccess(): void {
    const now = new Date();
    const wasDown = this.state.isDown;
    
    this.state.lastCheckAt = now;
    this.state.lastSuccessAt = now;
    this.state.consecutiveFailures = 0;
    
    // If was down, record recovery
    if (wasDown) {
      const downtimeMinutes = this.state.downSince
        ? Math.round((now.getTime() - this.state.downSince.getTime()) / 60000)
        : 0;
      
      this.state.isDown = false;
      this.state.downSince = null;
      
      // Notify recovery via TelegramRouter (Phase 5.2.2)
      telegramRouter.notifyParserUp({ downtimeMinutes }).catch(err => {
        console.error('[ParserMonitor] Failed to send recovery notification:', err);
      });
      
      console.log(`[ParserMonitor] Parser RECOVERED after ${downtimeMinutes} minutes`);
    }
  }
  
  /**
   * Record failed health check
   */
  recordFailure(error: string): void {
    const now = new Date();
    
    this.state.lastCheckAt = now;
    this.state.lastFailureAt = now;
    this.state.consecutiveFailures++;
    
    // If not yet marked as down and threshold reached
    if (!this.state.isDown && this.state.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this.state.isDown = true;
      this.state.downSince = now;
      
      console.warn(`[ParserMonitor] Parser marked as DOWN after ${this.state.consecutiveFailures} failures`);
    }
    
    // If down and past minimum downtime threshold, send alert
    if (this.state.isDown && this.state.downSince) {
      const downMinutes = Math.round((now.getTime() - this.state.downSince.getTime()) / 60000);
      
      if (downMinutes >= this.DOWN_MINUTES_THRESHOLD) {
        // Only send notification once when crossing threshold via TelegramRouter (Phase 5.2.2)
        if (downMinutes === this.DOWN_MINUTES_THRESHOLD) {
          telegramRouter.notifyParserDown({ error }).catch(err => {
            console.error('[ParserMonitor] Failed to send down notification:', err);
          });
          
          console.error(`[ParserMonitor] Parser DOWN alert sent - ${downMinutes} minutes downtime`);
        }
      }
    }
  }
  
  /**
   * Get current parser state
   */
  getState(): Readonly<ParserState> {
    return { ...this.state };
  }
  
  /**
   * Check if currently down
   */
  isCurrentlyDown(): boolean {
    return this.state.isDown;
  }
  
  /**
   * Get downtime in minutes
   */
  getDowntimeMinutes(): number {
    if (!this.state.isDown || !this.state.downSince) return 0;
    return Math.round((Date.now() - this.state.downSince.getTime()) / 60000);
  }
}

// Singleton instance
export const parserHealthMonitor = new ParserHealthMonitor();
