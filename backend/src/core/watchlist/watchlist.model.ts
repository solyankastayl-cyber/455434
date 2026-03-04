/**
 * Watchlist Model
 * 
 * WatchlistItem = база интереса (что отслеживаем)
 * - НЕ имеет условий
 * - НЕ шлёт уведомлений
 * - = "я за этим слежу"
 * 
 * Любой AlertRule ВСЕГДА привязан к WatchlistItem
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Watchlist item types
 */
export type WatchlistItemType = 'token' | 'wallet' | 'actor' | 'entity';

/**
 * Target specification
 */
export interface WatchlistTarget {
  address: string;
  chain: string;
  symbol?: string;
  name?: string;
}

/**
 * WatchlistItem Document Interface
 */
export interface IWatchlistItem extends Document {
  _id: Types.ObjectId;
  userId: string;
  type: WatchlistItemType;
  target: WatchlistTarget;
  
  // Metadata
  note?: string;
  tags?: string[];
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * WatchlistItem Schema
 */
const WatchlistItemSchema = new Schema<IWatchlistItem>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['token', 'wallet', 'actor', 'entity'],
      required: true,
    },
    target: {
      address: {
        type: String,
        required: true,
        lowercase: true,
      },
      chain: {
        type: String,
        required: true,
        default: 'ethereum',
      },
      symbol: String,
      name: String,
    },
    note: String,
    tags: [String],
  },
  {
    timestamps: true,
    collection: 'watchlist_items',
  }
);

// Compound index for uniqueness: one item per user+type+address+chain
WatchlistItemSchema.index(
  { userId: 1, type: 1, 'target.address': 1, 'target.chain': 1 },
  { unique: true }
);

// Index for querying user's watchlist
WatchlistItemSchema.index({ userId: 1, createdAt: -1 });

export const WatchlistItemModel = mongoose.model<IWatchlistItem>(
  'WatchlistItem',
  WatchlistItemSchema
);

// ============================================================================
// REPOSITORY FUNCTIONS
// ============================================================================

/**
 * Find or create watchlist item
 * Returns existing or newly created item
 */
export async function findOrCreateWatchlistItem(
  userId: string,
  type: WatchlistItemType,
  target: WatchlistTarget
): Promise<IWatchlistItem> {
  const existing = await WatchlistItemModel.findOne({
    userId,
    type,
    'target.address': target.address.toLowerCase(),
    'target.chain': target.chain,
  });

  if (existing) {
    return existing;
  }

  const item = new WatchlistItemModel({
    userId,
    type,
    target: {
      ...target,
      address: target.address.toLowerCase(),
    },
  });

  await item.save();
  return item;
}

/**
 * Get user's watchlist items
 */
export async function getUserWatchlist(
  userId: string,
  type?: WatchlistItemType
): Promise<IWatchlistItem[]> {
  const query: any = { userId };
  if (type) query.type = type;
  
  return WatchlistItemModel.find(query).sort({ createdAt: -1 });
}

/**
 * Remove watchlist item
 */
export async function removeWatchlistItem(
  userId: string,
  itemId: string
): Promise<boolean> {
  const result = await WatchlistItemModel.deleteOne({
    _id: itemId,
    userId,
  });
  return result.deletedCount > 0;
}

/**
 * Get watchlist item by ID
 */
export async function getWatchlistItem(
  itemId: string
): Promise<IWatchlistItem | null> {
  return WatchlistItemModel.findById(itemId);
}
