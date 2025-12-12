/**
 * ============================================================================
 * OBSERVABILITY DASHBOARD - MAIN APPLICATION
 * ============================================================================
 *
 * This React application provides real-time visibility into the Delineate
 * microservice with:
 * - Health status monitoring
 * - Download job tracking with progress
 * - Error tracking via Sentry
 * - Distributed tracing with OpenTelemetry
 * - Performance metrics visualization
 *
 * Features:
 * - Real-time API status updates
 * - Download job polling with progress bars
 * - Error log with Sentry integration
 * - Trace ID correlation for debugging
 * - Manual Sentry error trigger for testing
 *
 * OpenTelemetry Setup:
 * - Automatic HTTP instrumentation
 * - Custom spans for user interactions
 * - Trace ID propagation to backend
 * - Performance metrics collection
 *
 * Sentry Setup:
 * - Error boundary wrapping
 * - Automatic error capture
 * - User feedback on errors
 * - Performance monitoring
 * - Release tracking
 */

import React, { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import { initializeOpenTelemetry } from './lib/telemetry';
import { api } from './lib/api';
import { HealthStatus } from './components/HealthStatus';
import { DownloadManager } from './components/DownloadManager';
import { ErrorLog } from './components/ErrorLog';
import { TraceViewer } from './components/TraceViewer';
import './App.css';

/**
 * Initialize OpenTelemetry for distributed tracing
 * Must be called before any HTTP requests
 */
initializeOpenTelemetry();

/**
 * Main Application Component
 *
 * Provides a dashboard for monitoring the Delineate microservice
 * including health checks, download progress, and error tracking.
 *
 * Error Boundary:
 * Wrapped in Sentry's Error Boundary to catch and report React errors
 * Any uncaught errors are sent to Sentry and displayed to user
 */
function App() {
  const [errors, setErrors] = useState<Array<{ id: string; message: string; timestamp: Date }>>([]);
  const [traceId, setTraceId] = useState<string | null>(null);

  // Simulate an error for testing Sentry integration
  const triggerTestError = async () => {
    try {
      // This will trigger the API's Sentry test endpoint
      await api.get('/v1/download/check?sentry_test=true', {
        json: { file_id: 70000 }
      });
    } catch (err) {
      // Error will be captured by Sentry middleware
      const error = err instanceof Error ? err : new Error(String(err));
      
      // Also add to local error log
      setErrors(prev => [...prev, {
        id: crypto.randomUUID(),
        message: `Test Error: ${error.message}`,
        timestamp: new Date()
      }]);
      
      // Send to Sentry
      Sentry.captureException(error, {
        tags: {
          component: 'app',
          action: 'trigger_test_error'
        }
      });
    }
  };

  // Get current trace ID from API responses
  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      response => {
        const requestId = response.headers['x-request-id'];
        if (requestId) setTraceId(requestId);
        return response;
      },
      error => {
        if (error.response?.headers['x-request-id']) {
          setTraceId(error.response.headers['x-request-id']);
        }
        return Promise.reject(error);
      }
    );

    return () => api.interceptors.response.eject(interceptor);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🔍 Delineate Microservice - Observability Dashboard</h1>
        <p className="subtitle">Real-time monitoring, error tracking, and distributed tracing</p>
      </header>

      <main className="app-main">
        {/* Top row: Health status and trace viewer */}
        <div className="dashboard-row">
          <div className="dashboard-column">
            <HealthStatus />
          </div>
          <div className="dashboard-column">
            <TraceViewer traceId={traceId} />
          </div>
        </div>

        {/* Middle row: Download manager */}
        <div className="dashboard-row">
          <div className="dashboard-column full-width">
            <DownloadManager />
          </div>
        </div>

        {/* Bottom row: Error log */}
        <div className="dashboard-row">
          <div className="dashboard-column full-width">
            <div className="card">
              <h2>🧪 Testing & Debugging</h2>
              <button 
                onClick={triggerTestError}
                className="btn btn-danger"
              >
                Trigger Sentry Test Error
              </button>
              <p className="help-text">
                Click to send a test error to Sentry. 
                You should see it appear in your Sentry dashboard.
              </p>
            </div>
          </div>
        </div>

        {/* Error log */}
        <div className="dashboard-row">
          <div className="dashboard-column full-width">
            <ErrorLog errors={errors} />
          </div>
        </div>
      </main>

      {traceId && (
        <footer className="app-footer">
          <p>Current Trace ID: <code>{traceId}</code></p>
          <p>Use this ID to correlate frontend and backend logs in observability platform</p>
        </footer>
      )}
    </div>
  );
}

/**
 * Wrap app with Sentry Error Boundary
 *
 * This catches React component errors and:
 * - Sends error to Sentry
 * - Shows fallback UI
 * - Allows user to provide feedback
 *
 * Benefits:
 * - App doesn't crash on error
 * - Error context preserved for debugging
 * - User informed gracefully
 */
export default Sentry.withErrorBoundary(App, {
  fallback: (
    <div className="error-fallback">
      <h1>⚠️ Something went wrong</h1>
      <p>The application encountered an unexpected error.</p>
      <p>Our team has been notified and will investigate.</p>
      <button onClick={() => window.location.reload()}>
        Reload Application
      </button>
    </div>
  ),
  showDialog: true,
});
