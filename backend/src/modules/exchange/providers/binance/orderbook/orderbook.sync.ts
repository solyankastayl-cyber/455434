/**
 * PHASE 1 — Binance Orderbook Sync Engine
 * =========================================
 * 
 * Implements official Binance orderbook sync algorithm:
 * 1. Buffer diff events until snapshot received
 * 2. Apply snapshot, get lastUpdateId
 * 3. Discard diffs where u <= lastUpdateId
 * 4. First valid diff: U <= lastUpdateId+1 <= u
 * 5. Subsequent diffs must be continuous: U == prev_u + 1
 * 6. On gap: resync (new snapshot)
 */

import { createBinanceClient } from '../../../network/httpClient.factory.js';
import { 
  OrderbookState, 
  BinanceDepthSnapshot, 
  BinanceDepthEvent,
  OrderbookSyncStatus,
} from './orderbook.types.js';
import { applySnapshot, createEmptyState } from './orderbook.state.js';

// ═══════════════════════════════════════════════════════════════
// SYNC ENGINE
// ═══════════════════════════════════════════════════════════════

export class BinanceOrderbookSync {
  private buffer: BinanceDepthEvent[] = [];
  private lastAppliedU = 0;
  private syncing = false;
  
  constructor(
    private readonly symbol: string,
    private state: OrderbookState,
    private readonly maxBuffer: number = 5000,
  ) {}
  
  // ═════════════════════════════════════════════════════════════
  // ON DIFF EVENT (called from WebSocket)
  // ═════════════════════════════════════════════════════════════
  
  async onDiff(ev: BinanceDepthEvent): Promise<void> {
    // Ignore wrong symbol
    if (ev.s !== this.symbol) return;
    
    if (this.state.status !== 'READY') {
      // Buffer events while syncing
      this.buffer.push(ev);
      if (this.buffer.length > this.maxBuffer) this.buffer.shift();
      
      // Start sync if not already
      await this.ensureSnapshotSync();
      return;
    }
    
    // READY mode: enforce continuity
    if (ev.U !== this.lastAppliedU + 1) {
      console.log(`[OB Sync] ${this.symbol} GAP detected: expected U=${this.lastAppliedU + 1}, got U=${ev.U}`);
      this.resync('GAP');
      this.buffer.push(ev);
      await this.ensureSnapshotSync();
      return;
    }
    
    this.applyDiff(ev);
  }
  
  // ═════════════════════════════════════════════════════════════
  // SNAPSHOT SYNC
  // ═════════════════════════════════════════════════════════════
  
  private async ensureSnapshotSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    
    try {
      this.state.status = 'SYNCING';
      
      // Fetch snapshot via REST
      const snap = await this.fetchSnapshot();
      applySnapshot(this.state, snap);
      
      console.log(`[OB Sync] ${this.symbol} snapshot applied: lastUpdateId=${snap.lastUpdateId}`);
      
      // Discard old buffered events
      this.buffer = this.buffer.filter(e => e.u > snap.lastUpdateId);
      
      // Find first valid event
      const idx = this.buffer.findIndex(
        e => e.U <= snap.lastUpdateId + 1 && e.u >= snap.lastUpdateId + 1
      );
      
      if (idx === -1) {
        // Not enough buffered yet, keep buffering
        console.log(`[OB Sync] ${this.symbol} waiting for valid diff (buffered: ${this.buffer.length})`);
        this.state.status = 'BUFFERING';
        return;
      }
      
      // Apply from idx onward with continuity check
      this.lastAppliedU = snap.lastUpdateId;
      
      for (let i = idx; i < this.buffer.length; i++) {
        const e = this.buffer[i];
        
        // Check continuity (skip first as we already validated)
        if (i > idx && e.U !== this.lastAppliedU + 1) {
          console.log(`[OB Sync] ${this.symbol} non-contiguous during apply`);
          this.resync('NON_CONTIGUOUS');
          this.state.status = 'BUFFERING';
          return;
        }
        
        this.applyDiff(e);
      }
      
      // Clear buffer, mark ready
      this.buffer = [];
      this.state.status = 'READY';
      this.state.ready = true;
      
      console.log(`[OB Sync] ${this.symbol} READY`);
      
    } catch (error: any) {
      console.error(`[OB Sync] ${this.symbol} snapshot failed:`, error.message);
      this.state.status = 'ERROR';
      this.state.errorReason = error.message;
    } finally {
      this.syncing = false;
    }
  }
  
  // ═════════════════════════════════════════════════════════════
  // FETCH SNAPSHOT
  // ═════════════════════════════════════════════════════════════
  
  private async fetchSnapshot(): Promise<BinanceDepthSnapshot> {
    const client = await createBinanceClient();
    const res = await client.get('/fapi/v1/depth', {
      params: { symbol: this.symbol, limit: 1000 },
    });
    return res.data;
  }
  
  // ═════════════════════════════════════════════════════════════
  // APPLY DIFF
  // ═════════════════════════════════════════════════════════════
  
  private applyDiff(ev: BinanceDepthEvent): void {
    // Apply bids
    for (const [pStr, qStr] of ev.b) {
      const p = Number(pStr);
      const q = Number(qStr);
      if (q === 0) {
        this.state.bids.delete(p);
      } else {
        this.state.bids.set(p, q);
      }
    }
    
    // Apply asks
    for (const [pStr, qStr] of ev.a) {
      const p = Number(pStr);
      const q = Number(qStr);
      if (q === 0) {
        this.state.asks.delete(p);
      } else {
        this.state.asks.set(p, q);
      }
    }
    
    this.lastAppliedU = ev.u;
    this.state.lastUpdateId = ev.u;
    this.state.lastEventTime = ev.E;
  }
  
  // ═════════════════════════════════════════════════════════════
  // RESYNC
  // ═════════════════════════════════════════════════════════════
  
  private resync(reason: string): void {
    this.state.status = 'BUFFERING';
    this.state.ready = false;
    this.lastAppliedU = 0;
    console.log(`[OB Sync] ${this.symbol} resync triggered: ${reason}`);
  }
  
  // ═════════════════════════════════════════════════════════════
  // STATUS
  // ═════════════════════════════════════════════════════════════
  
  getStatus() {
    return {
      symbol: this.symbol,
      status: this.state.status,
      ready: this.state.ready,
      buffered: this.buffer.length,
      lastUpdateId: this.state.lastUpdateId,
      lastEventTime: this.state.lastEventTime,
      bidsCount: this.state.bids.size,
      asksCount: this.state.asks.size,
    };
  }
  
  getState(): OrderbookState {
    return this.state;
  }
  
  reset(): void {
    this.buffer = [];
    this.lastAppliedU = 0;
    this.state = createEmptyState(this.symbol);
    this.syncing = false;
  }
}

console.log('[Phase 1] Binance Orderbook Sync loaded');
