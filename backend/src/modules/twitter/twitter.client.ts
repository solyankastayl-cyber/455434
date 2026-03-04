// HTTP Client to Twitter Parser Service

import axios, { AxiosError } from 'axios';
import type { ParserHealth, ParserSearchResponse, ParserAccountResponse, ParserFollowersResponse } from './twitter.types.js';

const PARSER_URL = process.env.TWITTER_PARSER_URL || 'http://localhost:5001';
const TIMEOUT = 30000; // 30 seconds

export class TwitterParserClient {
  private baseURL: string;

  constructor(baseURL: string = PARSER_URL) {
    this.baseURL = baseURL;
  }

  async health(): Promise<ParserHealth> {
    try {
      const response = await axios.get(`${this.baseURL}/health`, { timeout: 5000 });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          status: 'down',
          service: 'twitter-parser',
          state: 'ERROR',
          mode: 'LIMITED',
          uptime: 0,
        };
      }
      throw error;
    }
  }

  async status(): Promise<any> {
    const response = await axios.get(`${this.baseURL}/status`, { timeout: 5000 });
    return response.data;
  }

  async search(query: string): Promise<ParserSearchResponse> {
    const response = await axios.get(`${this.baseURL}/search/keyword`, {
      params: { q: query },
      timeout: TIMEOUT,
    });
    return response.data;
  }

  async accountSummary(username: string): Promise<ParserAccountResponse> {
    const response = await axios.get(`${this.baseURL}/account/${username}/summary`, {
      timeout: TIMEOUT,
    });
    return response.data;
  }

  async accountTweets(username: string): Promise<ParserAccountResponse> {
    const response = await axios.get(`${this.baseURL}/account/${username}/tweets`, {
      timeout: TIMEOUT,
    });
    return response.data;
  }

  async accountFollowers(username: string): Promise<ParserFollowersResponse> {
    const response = await axios.get(`${this.baseURL}/account/${username}/followers`, {
      timeout: TIMEOUT,
    });
    return response.data;
  }

  // Admin passthrough
  async setMode(mode: string): Promise<any> {
    const response = await axios.post(`${this.baseURL}/admin/mode`, { mode }, {
      timeout: 5000,
    });
    return response.data;
  }

  async pause(): Promise<any> {
    const response = await axios.post(`${this.baseURL}/admin/pause`, {}, {
      timeout: 5000,
    });
    return response.data;
  }

  async resume(): Promise<any> {
    const response = await axios.post(`${this.baseURL}/admin/resume`, {}, {
      timeout: 5000,
    });
    return response.data;
  }

  async boost(minutes: number = 10): Promise<any> {
    const response = await axios.post(`${this.baseURL}/admin/boost`, { minutes }, {
      timeout: 5000,
    });
    return response.data;
  }

  async getState(): Promise<any> {
    const response = await axios.get(`${this.baseURL}/admin/state`, {
      timeout: 5000,
    });
    return response.data;
  }
}
