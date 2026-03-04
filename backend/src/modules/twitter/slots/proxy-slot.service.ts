// ProxySlot Service - MULTI Architecture
import { ProxySlotModel, IProxySlot, ProxySlotStatus, ProxyProtocol } from './proxy-slot.model.js';

export interface CreateProxySlotDTO {
  name: string;
  host: string;
  port: number;
  protocol?: ProxyProtocol;
  username?: string;
  password?: string;
  notes?: string;
}

export interface UpdateProxySlotDTO {
  name?: string;
  host?: string;
  port?: number;
  protocol?: ProxyProtocol;
  username?: string;
  password?: string;
  status?: ProxySlotStatus;
  notes?: string;
}

const COOLDOWN_MINUTES = 30;
const WINDOW_HOURS = 1;
const MAX_REQUESTS_PER_WINDOW = 200;

export class ProxySlotService {
  async create(data: CreateProxySlotDTO): Promise<IProxySlot> {
    const slot = await ProxySlotModel.create({
      ...data,
      status: 'ACTIVE',
      usedInWindow: 0,
      windowStart: new Date(),
    });
    console.log(`[ProxySlotService] Created slot: ${slot.name} (${slot.host}:${slot.port})`);
    return slot;
  }

  async findAll(): Promise<IProxySlot[]> {
    return ProxySlotModel.find().sort({ createdAt: -1 }).lean();
  }

  async findById(id: string): Promise<IProxySlot | null> {
    return ProxySlotModel.findById(id).lean();
  }

  async findActive(): Promise<IProxySlot[]> {
    const now = new Date();
    return ProxySlotModel.find({
      status: 'ACTIVE',
      $or: [
        { cooldownUntil: { $exists: false } },
        { cooldownUntil: { $lt: now } },
      ],
    }).lean();
  }

  async findAvailable(): Promise<IProxySlot[]> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

    const slots = await ProxySlotModel.find({
      status: 'ACTIVE',
      $or: [
        { cooldownUntil: { $exists: false } },
        { cooldownUntil: { $lt: now } },
      ],
    }).lean();

    const available: IProxySlot[] = [];
    for (const slot of slots) {
      if (!slot.windowStart || slot.windowStart < hourAgo) {
        await ProxySlotModel.updateOne(
          { _id: slot._id },
          { windowStart: now, usedInWindow: 0 }
        );
        slot.usedInWindow = 0;
      }
      if (slot.usedInWindow < MAX_REQUESTS_PER_WINDOW) {
        available.push(slot);
      }
    }
    return available;
  }

  async selectBestSlot(): Promise<IProxySlot | null> {
    const available = await this.findAvailable();
    if (available.length === 0) return null;
    available.sort((a, b) => a.usedInWindow - b.usedInWindow);
    return available[0];
  }

  async update(id: string, data: UpdateProxySlotDTO): Promise<IProxySlot | null> {
    return ProxySlotModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
  }

  async incrementUsage(id: string): Promise<void> {
    await ProxySlotModel.updateOne(
      { _id: id },
      {
        $inc: { usedInWindow: 1, totalRequests: 1 },
        $set: { lastUsedAt: new Date() },
      }
    );
  }

  async setCooldown(id: string, minutes: number = COOLDOWN_MINUTES): Promise<void> {
    const cooldownUntil = new Date(Date.now() + minutes * 60 * 1000);
    await ProxySlotModel.updateOne({ _id: id }, { status: 'COOLDOWN', cooldownUntil });
    console.log(`[ProxySlotService] Slot ${id} in cooldown until ${cooldownUntil.toISOString()}`);
  }

  async setError(id: string, error: string): Promise<void> {
    await ProxySlotModel.updateOne(
      { _id: id },
      {
        $inc: { totalErrors: 1 },
        $set: { lastError: { code: 'ERROR', message: error, at: new Date() } },
      }
    );
  }

  async setStatus(id: string, status: ProxySlotStatus): Promise<void> {
    const update: any = { status };
    if (status === 'ACTIVE') update.cooldownUntil = null;
    await ProxySlotModel.updateOne({ _id: id }, update);
    console.log(`[ProxySlotService] Slot ${id} status -> ${status}`);
  }

  async delete(id: string): Promise<boolean> {
    const result = await ProxySlotModel.findByIdAndDelete(id);
    return !!result;
  }

  async checkAndRecoverCooldowns(): Promise<number> {
    const now = new Date();
    const result = await ProxySlotModel.updateMany(
      { status: 'COOLDOWN', cooldownUntil: { $lt: now } },
      { $set: { status: 'ACTIVE', cooldownUntil: null } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[ProxySlotService] Recovered ${result.modifiedCount} slots from cooldown`);
    }
    return result.modifiedCount;
  }

  async count(): Promise<{ total: number; active: number; cooldown: number; disabled: number }> {
    const [total, active, cooldown, disabled] = await Promise.all([
      ProxySlotModel.countDocuments(),
      ProxySlotModel.countDocuments({ status: 'ACTIVE' }),
      ProxySlotModel.countDocuments({ status: 'COOLDOWN' }),
      ProxySlotModel.countDocuments({ status: 'DISABLED' }),
    ]);
    return { total, active, cooldown, disabled };
  }

  getProxyUrl(slot: IProxySlot): string | null {
    // Skip proxy for "direct" slots (no proxy needed)
    if (!slot.host || slot.host === 'direct' || slot.host === 'localhost') {
      return null;
    }
    const auth = slot.username && slot.password ? `${slot.username}:${slot.password}@` : '';
    return `${slot.protocol || 'http'}://${auth}${slot.host}:${slot.port}`;
  }
}

export const proxySlotService = new ProxySlotService();
