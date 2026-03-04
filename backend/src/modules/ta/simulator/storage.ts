/**
 * Phase 3.0: Execution Simulator - Storage Layer
 * 
 * MongoDB operations for simulation data.
 * All collections are immutable (append-only) for audit trail.
 */

import { Db, Collection, ObjectId } from 'mongodb';
import {
  SimRunSpec,
  SimOrder,
  SimPosition,
  SimEvent,
  SimSummary,
} from './domain.js';

const COLLECTIONS = {
  RUNS: 'ta_sim_runs',
  ORDERS: 'ta_sim_orders',
  POSITIONS: 'ta_sim_positions',
  EVENTS: 'ta_sim_events',
};

// ═══════════════════════════════════════════════════════════════
// STORAGE CLASS
// ═══════════════════════════════════════════════════════════════

export class SimStorage {
  private runsCollection: Collection<SimRunSpec>;
  private ordersCollection: Collection<SimOrder>;
  private positionsCollection: Collection<SimPosition>;
  private eventsCollection: Collection<SimEvent>;
  
  constructor(db: Db) {
    this.runsCollection = db.collection(COLLECTIONS.RUNS);
    this.ordersCollection = db.collection(COLLECTIONS.ORDERS);
    this.positionsCollection = db.collection(COLLECTIONS.POSITIONS);
    this.eventsCollection = db.collection(COLLECTIONS.EVENTS);
  }
  
  /**
   * Initialize indexes
   */
  async initialize(): Promise<void> {
    // Runs
    await this.runsCollection.createIndex({ runId: 1 }, { unique: true });
    await this.runsCollection.createIndex({ symbol: 1, tf: 1, createdAt: -1 });
    await this.runsCollection.createIndex({ status: 1 });
    
    // Orders
    await this.ordersCollection.createIndex({ runId: 1, orderId: 1 }, { unique: true });
    await this.ordersCollection.createIndex({ runId: 1, scenarioId: 1 });
    await this.ordersCollection.createIndex({ symbol: 1, tf: 1, createdTs: -1 });
    await this.ordersCollection.createIndex({ status: 1 });
    
    // Positions
    await this.positionsCollection.createIndex({ runId: 1, positionId: 1 }, { unique: true });
    await this.positionsCollection.createIndex({ runId: 1, scenarioId: 1 });
    await this.positionsCollection.createIndex({ symbol: 1, tf: 1, entryTs: -1 });
    await this.positionsCollection.createIndex({ status: 1 });
    await this.positionsCollection.createIndex({ exitReason: 1 });
    
    // Events
    await this.eventsCollection.createIndex({ runId: 1, ts: 1 });
    await this.eventsCollection.createIndex({ runId: 1, stepId: 1 });
    await this.eventsCollection.createIndex({ type: 1 });
    
    console.log('[SimStorage] Indexes created');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RUNS
  // ═══════════════════════════════════════════════════════════════
  
  async insertRun(run: SimRunSpec): Promise<void> {
    await this.runsCollection.insertOne(run as any);
  }
  
  async updateRunStatus(
    runId: string,
    status: SimRunSpec['status'],
    extra?: Partial<SimRunSpec>
  ): Promise<void> {
    await this.runsCollection.updateOne(
      { runId },
      { $set: { status, ...extra } }
    );
  }
  
  async getRun(runId: string): Promise<SimRunSpec | null> {
    return this.runsCollection.findOne({ runId });
  }
  
  async getRecentRuns(limit: number = 20): Promise<SimRunSpec[]> {
    return this.runsCollection
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ORDERS
  // ═══════════════════════════════════════════════════════════════
  
  async insertOrder(order: SimOrder): Promise<void> {
    await this.ordersCollection.insertOne(order as any);
  }
  
  async insertOrders(orders: SimOrder[]): Promise<void> {
    if (orders.length === 0) return;
    await this.ordersCollection.insertMany(orders as any[]);
  }
  
  async updateOrder(runId: string, orderId: string, update: Partial<SimOrder>): Promise<void> {
    await this.ordersCollection.updateOne(
      { runId, orderId },
      { $set: update }
    );
  }
  
  async getOrdersByRun(runId: string): Promise<SimOrder[]> {
    return this.ordersCollection
      .find({ runId })
      .sort({ createdTs: 1 })
      .toArray();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // POSITIONS
  // ═══════════════════════════════════════════════════════════════
  
  async insertPosition(position: SimPosition): Promise<void> {
    await this.positionsCollection.insertOne(position as any);
  }
  
  async updatePosition(runId: string, positionId: string, update: Partial<SimPosition>): Promise<void> {
    await this.positionsCollection.updateOne(
      { runId, positionId },
      { $set: update }
    );
  }
  
  async getPositionsByRun(runId: string): Promise<SimPosition[]> {
    return this.positionsCollection
      .find({ runId })
      .sort({ entryTs: 1 })
      .toArray();
  }
  
  async getClosedPositions(runId: string): Promise<SimPosition[]> {
    return this.positionsCollection
      .find({ runId, status: 'CLOSED' })
      .sort({ entryTs: 1 })
      .toArray();
  }
  
  async getOpenPositions(runId: string): Promise<SimPosition[]> {
    return this.positionsCollection
      .find({ runId, status: 'OPEN' })
      .toArray();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════
  
  async insertEvent(event: SimEvent): Promise<void> {
    await this.eventsCollection.insertOne(event as any);
  }
  
  async getEventsByRun(runId: string): Promise<SimEvent[]> {
    return this.eventsCollection
      .find({ runId })
      .sort({ ts: 1 })
      .toArray();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SUMMARY AGGREGATION
  // ═══════════════════════════════════════════════════════════════
  
  async computeSummary(runId: string): Promise<SimSummary | null> {
    const run = await this.getRun(runId);
    if (!run) return null;
    
    const positions = await this.getClosedPositions(runId);
    
    if (positions.length === 0) {
      return {
        runId,
        symbol: run.symbol,
        tf: run.tf,
        totalSteps: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        timeouts: 0,
        noEntries: 0,
        winRate: 0,
        avgR: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDrawdownR: 0,
        totalRWins: 0,
        totalRLosses: 0,
        avgWinR: 0,
        avgLossR: 0,
        avgBarsInTrade: 0,
        avgBarsToWin: 0,
        avgBarsToLoss: 0,
        totalFees: 0,
        totalSlippage: 0,
      };
    }
    
    // Categorize by exit reason
    const wins = positions.filter(p => p.rMultiple && p.rMultiple > 0);
    const losses = positions.filter(p => p.rMultiple && p.rMultiple <= 0);
    const timeouts = positions.filter(p => p.exitReason === 'TIMEOUT');
    const noEntries = positions.filter(p => p.exitReason === 'NO_ENTRY');
    
    // R calculations
    const rValues = positions.map(p => p.rMultiple || 0).filter(r => r !== 0);
    const totalR = rValues.reduce((sum, r) => sum + r, 0);
    const avgR = rValues.length > 0 ? totalR / rValues.length : 0;
    
    const winRs = wins.map(p => p.rMultiple || 0);
    const lossRs = losses.map(p => Math.abs(p.rMultiple || 0));
    
    const totalRWins = winRs.reduce((sum, r) => sum + r, 0);
    const totalRLosses = lossRs.reduce((sum, r) => sum + r, 0);
    
    const avgWinR = wins.length > 0 ? totalRWins / wins.length : 0;
    const avgLossR = losses.length > 0 ? totalRLosses / losses.length : 0;
    
    // Win rate
    const resolved = wins.length + losses.length;
    const winRate = resolved > 0 ? wins.length / resolved : 0;
    
    // Expectancy: (winRate * avgWin) - (lossRate * avgLoss)
    const expectancy = (winRate * avgWinR) - ((1 - winRate) * avgLossR);
    
    // Profit factor
    const profitFactor = totalRLosses > 0 ? totalRWins / totalRLosses : totalRWins > 0 ? Infinity : 0;
    
    // Max drawdown (simplified: track cumulative R curve)
    let peakR = 0;
    let maxDD = 0;
    let cumR = 0;
    for (const r of rValues) {
      cumR += r;
      if (cumR > peakR) peakR = cumR;
      const dd = peakR - cumR;
      if (dd > maxDD) maxDD = dd;
    }
    
    // Time metrics
    const avgBarsInTrade = positions.reduce((sum, p) => sum + p.barsInTrade, 0) / positions.length;
    const avgBarsToWin = wins.length > 0 
      ? wins.reduce((sum, p) => sum + p.barsInTrade, 0) / wins.length 
      : 0;
    const avgBarsToLoss = losses.length > 0
      ? losses.reduce((sum, p) => sum + p.barsInTrade, 0) / losses.length
      : 0;
    
    // Costs
    const totalFees = positions.reduce((sum, p) => sum + p.feesPaid, 0);
    const totalSlippage = positions.reduce((sum, p) => sum + p.slippagePaid, 0);
    
    // By pattern type
    const byPatternType: Record<string, { trades: number; winRate: number; avgR: number }> = {};
    
    const patternGroups = new Map<string, SimPosition[]>();
    for (const p of positions) {
      // Need to join with scenario to get pattern type
      // For now, skip this (would need scenario storage)
    }
    
    return {
      runId,
      symbol: run.symbol,
      tf: run.tf,
      totalSteps: 0, // Would need step count from run
      totalTrades: positions.length,
      wins: wins.length,
      losses: losses.length,
      timeouts: timeouts.length,
      noEntries: noEntries.length,
      winRate,
      avgR,
      expectancy,
      profitFactor,
      maxDrawdownR: maxDD,
      totalRWins,
      totalRLosses,
      avgWinR,
      avgLossR,
      avgBarsInTrade,
      avgBarsToWin,
      avgBarsToLoss,
      totalFees,
      totalSlippage,
      byPatternType,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    totalRuns: number;
    completedRuns: number;
    totalPositions: number;
    totalOrders: number;
  }> {
    const [totalRuns, completedRuns, totalPositions, totalOrders] = await Promise.all([
      this.runsCollection.countDocuments(),
      this.runsCollection.countDocuments({ status: 'DONE' }),
      this.positionsCollection.countDocuments(),
      this.ordersCollection.countDocuments(),
    ]);
    
    return { totalRuns, completedRuns, totalPositions, totalOrders };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let storageInstance: SimStorage | null = null;

export function initSimStorage(db: Db): SimStorage {
  storageInstance = new SimStorage(db);
  return storageInstance;
}

export function getSimStorage(): SimStorage | null {
  return storageInstance;
}
