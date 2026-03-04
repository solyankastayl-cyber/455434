// B3.3 - Remote Twitter Runtime (Railway / External Parser)
// Implements TwitterRuntime interface for remote HTTP endpoints

import {
  TwitterRuntime,
  TwitterTweet,
  TwitterAccount,
  SearchParams,
} from '../runtime.interface.js';
import { RuntimeResponse, RuntimeStatus } from '../runtime.types.js';
import { RemoteParserClient } from './remote.client.js';
import { RemoteMapper } from './remote.mapper.js';
import { RuntimeErrorCodes } from '../runtime.errors.js';

export class RemoteTwitterRuntime implements TwitterRuntime {
  readonly sourceType = 'REMOTE_WORKER';
  private client: RemoteParserClient;
  private slotId: string;
  private accountId: string;

  constructor(
    baseUrl: string,
    slotId: string = 'unknown',
    accountId: string = 'unknown'
  ) {
    this.client = new RemoteParserClient(baseUrl);
    this.slotId = slotId;
    this.accountId = accountId;
  }

  async getHealth(): Promise<RuntimeStatus> {
    const health = await this.client.health();
    
    switch (health.status) {
      case 'OK':
        return 'OK';
      case 'AUTH_REQUIRED':
        return 'AUTH_REQUIRED';
      case 'RATE_LIMITED':
        return 'RATE_LIMITED';
      case 'DOWN':
        return 'DOWN';
      default:
        return 'ERROR';
    }
  }

  async fetchTweetsByKeyword(
    params: SearchParams
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const startTime = Date.now();
    
    try {
      const raw = await this.client.searchByKeyword(
        params.keyword,
        params.limit || 20
      );

      const tweets = RemoteMapper.mapSearchResponse(raw);

      return {
        ok: true,
        status: 'OK',
        data: tweets,
        meta: {
          source: 'REMOTE_WORKER',
          slotId: this.slotId,
          accountId: this.accountId,
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      return this.handleError(error, startTime);
    }
  }

  async fetchAccountSummary(
    username: string
  ): Promise<RuntimeResponse<TwitterAccount>> {
    const startTime = Date.now();
    
    try {
      const raw = await this.client.getAccountSummary(username);
      const account = RemoteMapper.mapAccount(raw);

      return {
        ok: true,
        status: 'OK',
        data: account,
        meta: {
          source: 'REMOTE_WORKER',
          slotId: this.slotId,
          accountId: this.accountId,
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      return this.handleError(error, startTime);
    }
  }

  async fetchAccountTweets(
    username: string,
    limit: number = 20
  ): Promise<RuntimeResponse<TwitterTweet[]>> {
    const startTime = Date.now();
    
    try {
      const raw = await this.client.getAccountTweets(username, limit);
      const tweets = RemoteMapper.mapSearchResponse(raw);

      return {
        ok: true,
        status: 'OK',
        data: tweets,
        meta: {
          source: 'REMOTE_WORKER',
          slotId: this.slotId,
          accountId: this.accountId,
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      return this.handleError(error, startTime);
    }
  }

  /**
   * Convert errors to RuntimeResponse
   */
  private handleError(error: any, startTime: number): RuntimeResponse<any> {
    const duration = Date.now() - startTime;
    
    // Map error codes to status
    let status: RuntimeStatus = 'ERROR';
    if (error.code === RuntimeErrorCodes.RATE_LIMITED) {
      status = 'RATE_LIMITED';
    } else if (error.code === RuntimeErrorCodes.AUTH_REQUIRED) {
      status = 'AUTH_REQUIRED';
    } else if (error.code === RuntimeErrorCodes.CONNECTION_REFUSED || 
               error.code === RuntimeErrorCodes.TIMEOUT) {
      status = 'DOWN';
    }

    return {
      ok: false,
      status,
      error: error.message || 'Unknown error',
      meta: {
        source: 'REMOTE_WORKER',
        slotId: this.slotId,
        accountId: this.accountId,
        duration,
      },
    };
  }
}
