/**
 * ============================================================================
 * API CLIENT WITH SENTRY INTEGRATION
 * ============================================================================
 *
 * This module provides an HTTP client that:
 * - Communicates with the backend API
 * - Automatically captures errors in Sentry
 * - Propagates trace IDs for distributed tracing
 * - Includes retry logic for resilience
 * - Handles request/response logging
 *
 * Key Features:
 * - Automatic error tracking
 * - Trace context propagation
 * - Request ID correlation
 * - Retry logic with exponential backoff
 * - Performance monitoring
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as Sentry from '@sentry/react';

/**
 * Create configured API client
 *
 * Configuration:
 * - Base URL: Backend API location
 * - Timeout: Request timeout (30 seconds)
 * - Retry: Automatic retry on failure
 * - Headers: Include trace context
 *
 * Interceptors:
 * - Request: Add trace context headers
 * - Response: Extract trace ID
 * - Error: Capture in Sentry
 */
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor
 * Adds tracing headers and Sentry context
 *
 * Headers added:
 * - x-request-id: Unique request identifier
 * - baggage: Sentry tracing baggage
 * - sentry-trace: Trace context for distributed tracing
 *
 * Benefits:
 * - Backend can correlate requests with frontend
 * - Traces propagated through entire system
 * - Errors tagged with request context
 */
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Get current Sentry transaction for trace context
    const span = Sentry.getActiveSpan();
    const client = Sentry.getClient();
    
    if (client && span) {
      // Add Sentry tracing context headers
      // These are used by backend to correlate requests
      const spanContext = span.getTraceContext();
      config.headers['sentry-trace'] = [
        spanContext.trace_id,
        spanContext.span_id,
        '1' // sampled
      ].join('-');
    }
    
    // Add request ID for correlation
    if (!config.headers['x-request-id']) {
      config.headers['x-request-id'] = crypto.randomUUID();
    }
    
    return config;
  },
  error => Promise.reject(error)
);

/**
 * Response Interceptor
 * Extracts trace ID and handles errors
 *
 * On success:
 * - Extract request ID from response headers
 * - Store for correlation
 *
 * On error:
 * - Capture in Sentry
 * - Tag with request context
 * - Add to error log
 * - Implement retry logic
 */
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // Start with 1 second

api.interceptors.response.use(
  response => {
    // Reset retry count on success
    retryCount = 0;
    
    // Extract trace ID for frontend logging
    const requestId = response.headers['x-request-id'];
    if (requestId) {
      // Store in Sentry context for correlation
      Sentry.setTag('request_id', requestId);
    }
    
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig;
    
    // Get request context for error reporting
    const requestId = error.response?.headers['x-request-id'] as string | undefined;
    const method = config?.method?.toUpperCase() || 'UNKNOWN';
    const url = config?.url || 'unknown';
    
    // Capture in Sentry with context
    Sentry.captureException(error, {
      tags: {
        type: 'api_error',
        method,
        status: error.response?.status || 'unknown'
      },
      contexts: {
        http: {
          method,
          url,
          status_code: error.response?.status,
          request_id: requestId,
        }
      }
    });
    
    // Retry logic for transient errors
    if (
      config &&
      retryCount < MAX_RETRIES &&
      error.response &&
      (error.response.status === 429 || // Rate limit
       error.response.status === 503 || // Service unavailable
       error.response.status === 504)   // Gateway timeout
    ) {
      retryCount++;
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = RETRY_DELAY * Math.pow(2, retryCount - 1);
      
      console.log(
        `Retrying request (attempt ${retryCount}/${MAX_RETRIES}) after ${delay}ms:`,
        `${method} ${url}`
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return api(config);
    }
    
    return Promise.reject(error);
  }
);

/**
 * API Service Methods
 * Typed endpoints for type safety
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  checks: {
    storage: 'ok' | 'error';
  };
}

export interface DownloadJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  totalFiles: number;
  processedFiles: number;
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  estimatedSecondsRemaining: number | null;
}

export const apiService = {
  /**
   * Health Check
   * Verifies API and storage are accessible
   *
   * Returns: Health status with dependency checks
   * Timeout: 5 seconds (should be fast)
   */
  async getHealth() {
    const response = await api.get<HealthCheckResponse>('/health', {
      timeout: 5000
    });
    return response.data;
  },

  /**
   * Initiate Download
   * Starts async download job
   *
   * Parameters:
   * - fileIds: Array of files to download
   *
   * Returns:
   * - jobId: Job identifier for polling
   * - status: Job status (pending/processing)
   *
   * Timeout: 10 seconds (should return quickly)
   */
  async initiateDownload(fileIds: number[]) {
    const response = await api.post<{ jobId: string; status: string }>(
      '/v1/download/initiate',
      { file_ids: fileIds },
      { timeout: 10000 }
    );
    return response.data;
  },

  /**
   * Get Download Status
   * Polls for job progress
   *
   * Parameters:
   * - jobId: Job identifier from initiate
   *
   * Returns:
   * - Full job status including progress
   * - downloadUrl when complete
   *
   * Timeout: 5 seconds (polling endpoint)
   */
  async getDownloadStatus(jobId: string) {
    const response = await api.get<DownloadJob>(
      `/v1/download/status/${jobId}`,
      { timeout: 5000 }
    );
    return response.data;
  },

  /**
   * Cancel Download
   * Stops ongoing download
   *
   * Parameters:
   * - jobId: Job identifier to cancel
   *
   * Returns:
   * - Confirmation of cancellation
   *
   * Timeout: 5 seconds
   */
  async cancelDownload(jobId: string) {
    const response = await api.post(
      `/v1/download/cancel/${jobId}`,
      {},
      { timeout: 5000 }
    );
    return response.data;
  },

  /**
   * Check File Availability
   * Quick check if file exists
   *
   * Parameters:
   * - fileId: File to check
   *
   * Returns:
   * - available: Boolean file existence
   * - size: File size if available
   * - s3Key: S3 path
   *
   * Timeout: 5 seconds
   */
  async checkDownload(fileId: number) {
    const response = await api.post(
      '/v1/download/check',
      { file_id: fileId },
      { timeout: 5000 }
    );
    return response.data;
  }
};
