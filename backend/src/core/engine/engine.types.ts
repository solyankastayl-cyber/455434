/**
 * Engine Types (Sprint 4 - v1)
 * 
 * Контракты. Ничего лишнего.
 */
import { TimeWindow } from '../common/window.service.js';

export type EngineDecisionLabel = 'BUY' | 'SELL' | 'NEUTRAL';
export type EngineStrength = 'low' | 'medium' | 'high';
export type EngineSource = 'signals' | 'contexts' | 'actors' | 'flows' | 'graph';

export interface EngineWhy {
  title: string;
  evidence: string;
  source: EngineSource;
}

export interface EngineRisk {
  title: string;
  evidence: string;
}

export interface EngineDecision {
  label: EngineDecisionLabel;
  strength: EngineStrength;
  mode: 'rule_v1';
  why: EngineWhy[];
  risks: EngineRisk[];
}

export interface EngineInput {
  asset: {
    address: string;
    symbol?: string;
  };
  window: TimeWindow;

  signals: {
    type: string;
    deviation: number;
    severity: string;
    source: string;
  }[];

  contexts: {
    id: string;
    overlapScore: number;
    primarySignalType: string;
    involvedActors: string[];
  }[];

  corridors: {
    from: string;
    to: string;
    volumeUsd: number;
    type?: string;
  }[];

  flows: {
    netFlowUsd: number;
    deviation: number;
  };

  price?: {
    changePct: number;
  };

  coverage: {
    percent: number;
    checked: string[];
  };
}

export interface EngineCTA {
  viewContexts: string;
  viewActors: string;
  createAlert: string;
}

export interface EngineResponse {
  status: 'completed' | 'pending' | 'failed';
  window: string;
  coverage: {
    pct: number;
    checked: string[];
  };
  decision: EngineDecision;
  inputsUsed: {
    actorSignals: number;
    contexts: number;
    corridors: number;
  };
  cta: EngineCTA;
}
