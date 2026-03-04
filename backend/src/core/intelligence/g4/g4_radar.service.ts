/**
 * G4 Threat Radar Service
 * 
 * Real-time threat monitoring and alerting
 */

import { Db } from 'mongodb';
import { WatchlistManager } from './subscriptions/watchlist.manager.js';
import { AlertEvent } from './g4.types.js';
import { checkVolumeSpike } from './triggers/volume_spike.trigger.js';

export class G4RadarService {
  private watchlistManager: WatchlistManager;

  constructor(private db: Db) {
    this.watchlistManager = new WatchlistManager(db);
  }

  /**
   * Get watchlist manager
   */
  getWatchlistManager(): WatchlistManager {
    return this.watchlistManager;
  }

  /**
   * Check all active watchlists for triggers
   */
  async checkAllWatchlists(): Promise<AlertEvent[]> {
    const watchlists = await this.watchlistManager.getActive();
    const alerts: AlertEvent[] = [];

    for (const watchlist of watchlists) {
      const watchlistAlerts = await this.checkWatchlist(watchlist.id);
      alerts.push(...watchlistAlerts);
    }

    return alerts;
  }

  /**
   * Check specific watchlist for triggers
   */
  async checkWatchlist(watchlistId: string): Promise<AlertEvent[]> {
    const watchlist = await this.watchlistManager.get(watchlistId);
    if (!watchlist || !watchlist.active) return [];

    const alerts: AlertEvent[] = [];

    // Check each trigger type
    for (const triggerType of watchlist.triggers) {
      let alert: AlertEvent | null = null;

      switch (triggerType) {
        case 'VOLUME_SPIKE':
          alert = await checkVolumeSpike(this.db, {
            network: watchlist.network,
            address: watchlist.subject,
            watchlistId: watchlist.id,
          });
          break;

        // Add other triggers here as implemented
        default:
          break;
      }

      if (alert) {
        // Save alert to database
        await this.db.collection('g4_alerts').insertOne(alert);
        alerts.push(alert);
      }
    }

    return alerts;
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(limit: number = 50): Promise<AlertEvent[]> {
    const docs = await this.db
      .collection('g4_alerts')
      .find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return docs as AlertEvent[];
  }

  /**
   * Get alerts for specific watchlist
   */
  async getAlertsForWatchlist(watchlistId: string, limit: number = 50): Promise<AlertEvent[]> {
    const docs = await this.db
      .collection('g4_alerts')
      .find({ watchlistId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return docs as AlertEvent[];
  }
}
