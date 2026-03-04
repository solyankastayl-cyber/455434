// B3.3 - Remote Parser HTTP Client
// Pure HTTP communication, no business logic

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  RemoteHealthResponse,
  RemoteSearchResponse,
  RemoteAccountResponse,
} from './remote.types.js';
import { RuntimeErrorCodes, createRuntimeError } from '../runtime.errors.js';

const DEFAULT_TIMEOUT = 30000; // 30s

export class RemoteParserClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string, timeout: number = DEFAULT_TIMEOUT) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FOMO-AI-v4/1.0',
      },
      validateStatus: (status) => status < 500, // Accept 4xx for proper error handling
    });
  }

  /**
   * Health check endpoint
   */
  async health(): Promise<RemoteHealthResponse> {
    try {
      const res = await this.client.get('/health');
      
      if (res.status === 200) {
        return res.data as RemoteHealthResponse;
      }
      
      return {
        status: 'ERROR',
        message: `Health check returned ${res.status}`,
      };
    } catch (error) {
      return this.handleConnectionError(error);
    }
  }

  /**
   * Search tweets by keyword
   */
  async searchByKeyword(
    keyword: string,
    limit: number = 20
  ): Promise<RemoteSearchResponse> {
    try {
      // Try multiple endpoint patterns (compatibility)
      const endpoints = [
        `/search/keyword?q=${encodeURIComponent(keyword)}&limit=${limit}`,
        `/search?q=${encodeURIComponent(keyword)}&limit=${limit}`,
        `/parse/search?query=${encodeURIComponent(keyword)}&maxResults=${limit}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const res = await this.client.get(endpoint);
          if (res.status === 200 && res.data) {
            return res.data as RemoteSearchResponse;
          }
        } catch {
          continue;
        }
      }

      throw createRuntimeError(
        RuntimeErrorCodes.INVALID_RESPONSE,
        'No valid search endpoint found',
        this.baseUrl
      );
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Get account summary
   */
  async getAccountSummary(username: string): Promise<RemoteAccountResponse> {
    try {
      const cleanUsername = username.replace(/^@/, '');
      
      // Try multiple endpoint patterns
      const endpoints = [
        `/account/${cleanUsername}/summary`,
        `/account/${cleanUsername}`,
        `/user/${cleanUsername}`,
        `/parse/account?username=${cleanUsername}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const res = await this.client.get(endpoint);
          if (res.status === 200 && res.data) {
            return res.data as RemoteAccountResponse;
          }
        } catch {
          continue;
        }
      }

      throw createRuntimeError(
        RuntimeErrorCodes.NOT_FOUND,
        `Account ${cleanUsername} not found`,
        this.baseUrl
      );
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Get account tweets
   */
  async getAccountTweets(
    username: string,
    limit: number = 20
  ): Promise<RemoteSearchResponse> {
    try {
      const cleanUsername = username.replace(/^@/, '');
      
      // Try multiple endpoint patterns
      const endpoints = [
        `/account/${cleanUsername}/tweets?limit=${limit}`,
        `/user/${cleanUsername}/tweets?limit=${limit}`,
        `/parse/account/tweets?username=${cleanUsername}&maxResults=${limit}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const res = await this.client.get(endpoint);
          if (res.status === 200 && res.data) {
            return res.data as RemoteSearchResponse;
          }
        } catch {
          continue;
        }
      }

      throw createRuntimeError(
        RuntimeErrorCodes.NOT_FOUND,
        `Tweets for ${cleanUsername} not found`,
        this.baseUrl
      );
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Handle connection-level errors
   */
  private handleConnectionError(error: any): RemoteHealthResponse {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === 'ECONNREFUSED') {
        return { status: 'DOWN', message: 'Connection refused' };
      }
      if (axiosError.code === 'ENOTFOUND') {
        return { status: 'DOWN', message: 'Host not found' };
      }
      if (axiosError.code === 'ECONNABORTED') {
        return { status: 'DOWN', message: 'Connection timeout' };
      }
    }

    return {
      status: 'ERROR',
      message: error?.message || 'Unknown error',
    };
  }

  /**
   * Normalize errors to RuntimeError
   */
  private normalizeError(error: any): Error {
    if (error?.code && error?.name === 'RuntimeError') {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response?.status === 429) {
        return createRuntimeError(
          RuntimeErrorCodes.RATE_LIMITED,
          'Rate limited by parser',
          this.baseUrl
        );
      }
      
      if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
        return createRuntimeError(
          RuntimeErrorCodes.AUTH_REQUIRED,
          'Authentication required',
          this.baseUrl
        );
      }
      
      if (axiosError.code === 'ECONNREFUSED') {
        return createRuntimeError(
          RuntimeErrorCodes.CONNECTION_REFUSED,
          'Connection refused',
          this.baseUrl
        );
      }
      
      if (axiosError.code === 'ECONNABORTED') {
        return createRuntimeError(
          RuntimeErrorCodes.TIMEOUT,
          'Request timed out',
          this.baseUrl
        );
      }
    }

    return createRuntimeError(
      RuntimeErrorCodes.UNKNOWN,
      error?.message || 'Unknown error',
      this.baseUrl
    );
  }
}
