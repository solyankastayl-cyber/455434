/**
 * Timelines Repository
 */
import {
  StrategyTimelineModel,
  IStrategyTimelineEvent,
  StrategyTimelineEventType,
  generateTimelineReason,
} from './strategy_timeline.model.js';
import { SignalTimelineModel, ISignalTimelineEvent } from './signal_timeline.model.js';
import { BundleTimelineModel, IBundleTimelineEvent } from './bundle_timeline.model.js';

// ========== STRATEGY TIMELINE ==========

export interface CreateStrategyTimelineInput {
  address: string;
  chain?: string;
  eventType: StrategyTimelineEventType;
  timestamp: Date;
  strategy: string;
  phase?: string;
  confidence: number;
  stability: number;
  previousStrategy?: string;
  previousConfidence?: number;
  previousStability?: number;
  additionalContext?: string;
  sourceType?: string;
  sourceId?: string;
}

export async function createStrategyTimelineEvent(
  input: CreateStrategyTimelineInput
): Promise<IStrategyTimelineEvent> {
  const reason = generateTimelineReason(
    input.eventType,
    input.strategy,
    input.previousStrategy,
    input.confidence,
    input.stability,
    input.additionalContext
  );
  
  const event = new StrategyTimelineModel({
    ...input,
    address: input.address.toLowerCase(),
    reason,
  });
  
  return event.save();
}

export async function getStrategyTimeline(
  address: string,
  limit: number = 50
): Promise<IStrategyTimelineEvent[]> {
  return StrategyTimelineModel
    .find({ address: address.toLowerCase() })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

export async function getStrategyTimelineByType(
  address: string,
  eventType: StrategyTimelineEventType,
  limit: number = 20
): Promise<IStrategyTimelineEvent[]> {
  return StrategyTimelineModel
    .find({ address: address.toLowerCase(), eventType })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

// ========== SIGNAL TIMELINE ==========

export interface CreateSignalTimelineInput {
  address: string;
  chain?: string;
  timestamp: Date;
  signalType: string;
  severity: number;
  confidence: number;
  context?: {
    strategy?: string;
    phase?: string;
    relatedSignals?: string[];
  };
  title: string;
  description: string;
  signalId: string;
  alertTriggered?: boolean;
  alertId?: string;
}

export async function createSignalTimelineEvent(
  input: CreateSignalTimelineInput
): Promise<ISignalTimelineEvent> {
  const event = new SignalTimelineModel({
    ...input,
    address: input.address.toLowerCase(),
  });
  
  return event.save();
}

export async function getSignalTimeline(
  address: string,
  limit: number = 50
): Promise<ISignalTimelineEvent[]> {
  return SignalTimelineModel
    .find({ address: address.toLowerCase() })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

export async function getSignalTimelineByType(
  address: string,
  signalType: string,
  limit: number = 20
): Promise<ISignalTimelineEvent[]> {
  return SignalTimelineModel
    .find({ address: address.toLowerCase(), signalType })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

// ========== BUNDLE TIMELINE ==========

export interface CreateBundleTimelineInput {
  address: string;
  chain?: string;
  timestamp: Date;
  bundleType: string;
  bundleId: string;
  volumeUsd: number;
  transferCount: number;
  confidence: number;
  phase: IBundleTimelineEvent['phase'];
  description: string;
  actors?: string[];
}

export async function createBundleTimelineEvent(
  input: CreateBundleTimelineInput
): Promise<IBundleTimelineEvent> {
  const event = new BundleTimelineModel({
    ...input,
    address: input.address.toLowerCase(),
  });
  
  return event.save();
}

export async function getBundleTimeline(
  address: string,
  limit: number = 50
): Promise<IBundleTimelineEvent[]> {
  return BundleTimelineModel
    .find({ address: address.toLowerCase() })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

export async function getBundleTimelineByType(
  address: string,
  bundleType: string,
  limit: number = 20
): Promise<IBundleTimelineEvent[]> {
  return BundleTimelineModel
    .find({ address: address.toLowerCase(), bundleType })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

export async function getBundleTimelineById(
  bundleId: string,
  limit: number = 20
): Promise<IBundleTimelineEvent[]> {
  return BundleTimelineModel
    .find({ bundleId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}
