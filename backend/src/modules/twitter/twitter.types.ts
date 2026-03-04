// Twitter Parser Types

export type ParserMode = 'LIMITED' | 'STANDARD' | 'FULL';
export type ParserState = 'RUNNING' | 'PAUSED' | 'DEGRADED' | 'ERROR' | 'STOPPED';

export interface ParserHealth {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version?: string;
  state: ParserState;
  mode: ParserMode;
  browser?: {
    active: boolean;
    ready: boolean;
  };
  uptime: number;
  timestamp?: string;
}

export interface ParserSearchResponse {
  ok: boolean;
  query: string;
  mode: ParserMode;
  limits?: {
    requested: number;
    returned: number;
    max: number;
  };
  items: any[];
}

export interface ParserAccountResponse {
  ok: boolean;
  username: string;
  user: any;
  tweets?: any[];
  tweetsCount?: number;
}

export interface ParserFollowersResponse {
  ok: boolean;
  username: string;
  mode: ParserMode;
  limits?: {
    found: number;
    returned: number;
    max: number;
  };
  items: any[];
}
