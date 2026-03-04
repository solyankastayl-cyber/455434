// TwitterAccount DTOs - v4.0 Parser Control Plane

import { TwitterAccountStatus, TwitterAccountMeta } from '../models/twitterAccount.model.js';

// Create
export interface CreateTwitterAccountDto {
  label: string;
  status?: TwitterAccountStatus;
  notes?: string;
  meta?: TwitterAccountMeta;
}

// Update
export interface UpdateTwitterAccountDto {
  label?: string;
  status?: TwitterAccountStatus;
  notes?: string;
  meta?: TwitterAccountMeta;
}

// Response (what API returns)
export interface TwitterAccountResponseDto {
  _id: string;
  label: string;
  status: TwitterAccountStatus;
  notes?: string;
  lastLoginAt?: number;
  lastError?: {
    code: string;
    message: string;
    at: number;
  };
  meta?: TwitterAccountMeta;
  createdAt: number;
  updatedAt: number;
}

// List response
export interface TwitterAccountsListResponseDto {
  ok: boolean;
  data: TwitterAccountResponseDto[];
  total: number;
}

// Single response
export interface TwitterAccountSingleResponseDto {
  ok: boolean;
  data: TwitterAccountResponseDto;
}
