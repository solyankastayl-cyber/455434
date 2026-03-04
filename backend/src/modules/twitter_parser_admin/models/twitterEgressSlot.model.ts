// TwitterEgressSlot Model - v4.0 Parser Control Plane
// Abstract egress slots (PROXY or REMOTE_WORKER)

export type EgressSlotType = 'PROXY' | 'REMOTE_WORKER';
export type EgressSlotHealthStatus = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'ERROR';

export interface SlotProxy {
  url: string;
  region?: string;
  provider?: string;
}

export interface SlotWorker {
  baseUrl: string;
  region?: string;
  provider?: string;
}

export interface SlotLimits {
  requestsPerHour: number;
  maxConcurrent: number;
}

export interface SlotUsage {
  windowStartAt?: number;
  usedInWindow: number;
}

export interface SlotHealth {
  status: EgressSlotHealthStatus;
  lastCheckAt?: number;
  lastError?: string;
}

export interface TwitterEgressSlot {
  _id: string;
  label: string;
  type: EgressSlotType;
  enabled: boolean;
  accountId?: string;
  proxy?: SlotProxy;
  worker?: SlotWorker;
  limits: SlotLimits;
  usage: SlotUsage;
  health: SlotHealth;
  cooldownUntil?: number;
  createdAt: number;
  updatedAt: number;
}

// MongoDB document (before _id transform)
export interface TwitterEgressSlotDoc {
  _id: any;
  label: string;
  type: EgressSlotType;
  enabled: boolean;
  accountId?: any;
  proxy?: SlotProxy;
  worker?: SlotWorker;
  limits: SlotLimits;
  usage: SlotUsage;
  health: SlotHealth;
  cooldownUntil?: number;
  createdAt: number;
  updatedAt: number;
}

// Default values
export const DEFAULT_SLOT_LIMITS: SlotLimits = {
  requestsPerHour: 200,
  maxConcurrent: 1,
};

export const DEFAULT_SLOT_USAGE: SlotUsage = {
  usedInWindow: 0,
};

export const DEFAULT_SLOT_HEALTH: SlotHealth = {
  status: 'UNKNOWN',
};
