// B3.1 - Runtime Types
// Foundation contract - DO NOT modify after B3.1 completion

export type RuntimeSourceType =
  | 'MOCK'
  | 'REMOTE_WORKER'
  | 'PROXY'
  | 'OFFICIAL_API';

export type RuntimeStatus =
  | 'OK'
  | 'DOWN'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'ERROR';

export interface RuntimeMeta {
  source: RuntimeSourceType;
  slotId: string;
  accountId: string;
  duration?: number;
}

export interface RuntimeResponse<T> {
  ok: boolean;
  status: RuntimeStatus;
  data?: T;
  error?: string;
  meta?: RuntimeMeta;
}

// Slot health derived from RuntimeStatus
export type SlotHealthStatus =
  | 'OK'
  | 'DEGRADED'
  | 'ERROR'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

// Map runtime status to slot health
export function mapRuntimeToSlotHealth(status: RuntimeStatus): SlotHealthStatus {
  switch (status) {
    case 'OK':
      return 'OK';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'AUTH_REQUIRED':
      return 'AUTH_REQUIRED';
    case 'DOWN':
    case 'ERROR':
    default:
      return 'ERROR';
  }
}
