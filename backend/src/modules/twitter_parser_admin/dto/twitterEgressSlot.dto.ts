// TwitterEgressSlot DTOs - v4.0 Parser Control Plane

import {
  EgressSlotType,
  SlotProxy,
  SlotWorker,
  SlotLimits,
  SlotUsage,
  SlotHealth,
} from '../models/twitterEgressSlot.model.js';

// Create
export interface CreateTwitterEgressSlotDto {
  label: string;
  type: EgressSlotType;
  enabled?: boolean;
  accountId?: string;
  proxy?: SlotProxy;
  worker?: SlotWorker;
  limits?: Partial<SlotLimits>;
}

// Update
export interface UpdateTwitterEgressSlotDto {
  label?: string;
  type?: EgressSlotType;
  enabled?: boolean;
  proxy?: SlotProxy;
  worker?: SlotWorker;
  limits?: Partial<SlotLimits>;
}

// Bind account
export interface BindAccountDto {
  accountId: string;
}

// Response (what API returns)
export interface TwitterEgressSlotResponseDto {
  _id: string;
  label: string;
  type: EgressSlotType;
  enabled: boolean;
  accountId?: string;
  accountLabel?: string; // populated for convenience
  proxy?: SlotProxy;
  worker?: SlotWorker;
  limits: SlotLimits;
  usage: SlotUsage;
  health: SlotHealth;
  cooldownUntil?: number;
  createdAt: number;
  updatedAt: number;
}

// List response
export interface TwitterEgressSlotsListResponseDto {
  ok: boolean;
  data: TwitterEgressSlotResponseDto[];
  total: number;
}

// Single response
export interface TwitterEgressSlotSingleResponseDto {
  ok: boolean;
  data: TwitterEgressSlotResponseDto;
}

// Monitor/Stats response
export interface TwitterParserMonitorDto {
  ok: boolean;
  data: {
    totalAccounts: number;
    activeAccounts: number;
    totalSlots: number;
    enabledSlots: number;
    healthySlots: number;
    degradedSlots: number;
    errorSlots: number;
    totalCapacityPerHour: number;
    usedThisHour: number;
    availableThisHour: number;
  };
}
