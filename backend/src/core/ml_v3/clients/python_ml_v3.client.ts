/**
 * Python ML V3 Client - B4.3
 * 
 * HTTP client for calling Python ML Service v3 endpoints
 */
import axios, { AxiosError } from 'axios';

export interface EvaluateRequest {
  task: 'market' | 'actor';
  modelId: string;       // model artifact path or ID
  datasetId: string;
}

export interface EvaluateResponse {
  rows: number;
  accuracy: number;
  f1: number;
  precision: number;
  recall: number;
  confusion: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  meta?: Record<string, any>;
}

export class PythonMLV3Client {
  constructor(
    private baseUrl: string,
    private timeoutMs: number = 60000  // 60s for evaluation
  ) {}

  async evaluate(req: EvaluateRequest): Promise<EvaluateResponse> {
    const url = `${this.baseUrl}/api/v3/evaluate`;
    
    try {
      const { data } = await axios.post(url, req, {
        timeout: this.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.data) {
          throw new Error(`ML Service error: ${JSON.stringify(axiosError.response.data)}`);
        }
        if (axiosError.code === 'ECONNREFUSED') {
          throw new Error('ML Service unavailable (connection refused)');
        }
        if (axiosError.code === 'ETIMEDOUT') {
          throw new Error('ML Service timeout');
        }
      }
      throw error;
    }
  }
  
  /**
   * Health check
   */
  async health(): Promise<{ status: string }> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000,
      });
      return data;
    } catch (error) {
      throw new Error('ML Service health check failed');
    }
  }
}

export default PythonMLV3Client;
