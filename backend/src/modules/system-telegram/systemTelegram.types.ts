/**
 * System Telegram Alert Types
 * 
 * Types for admin/ops Telegram notifications.
 * This is NOC/Ops channel, NOT user-facing.
 */

export type SystemAlertType =
  | 'POLICY_VIOLATION'
  | 'COOLDOWN_APPLIED'
  | 'USER_DISABLED'
  | 'PARSER_DOWN'
  | 'PARSER_RECOVERED';

export interface PolicyViolationAlert {
  userId: string;
  violationType: string;
  currentValue: number;
  limitValue: number;
  action: 'WARN' | 'COOLDOWN' | 'DISABLE';
  policyScope: 'GLOBAL' | 'USER';
  timestamp: string;
}

export interface CooldownAlert {
  userId: string;
  minutes: number;
  reason: string;
}

export interface UserDisabledAlert {
  userId: string;
  reason: string;
  cooldowns24h: number;
}

export interface ParserAlert {
  service: string;
  status: 'DOWN' | 'UP';
  error?: string;
}
