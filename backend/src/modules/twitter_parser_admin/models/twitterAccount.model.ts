// TwitterAccount Model - v4.0 Parser Control Plane
// Logical Twitter accounts (NO passwords, NO cookies, NO tokens)

export interface TwitterAccountLastError {
  code: string;
  message: string;
  at: number; // timestamp ms
}

export interface TwitterAccountMeta {
  verified?: boolean;
  createdManually?: boolean;
}

export type TwitterAccountStatus = 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'NEEDS_LOGIN';

export interface TwitterAccount {
  _id: string;
  label: string;
  status: TwitterAccountStatus;
  notes?: string;
  lastLoginAt?: number;
  lastError?: TwitterAccountLastError;
  meta?: TwitterAccountMeta;
  createdAt: number;
  updatedAt: number;
}

// MongoDB document (before _id transform)
export interface TwitterAccountDoc {
  _id: any;
  label: string;
  status: TwitterAccountStatus;
  notes?: string;
  lastLoginAt?: number;
  lastError?: TwitterAccountLastError;
  meta?: TwitterAccountMeta;
  createdAt: number;
  updatedAt: number;
}
