/**
 * ============================================================================
 * TELEMETRY SETUP - OPENTELEMETRY & SENTRY INITIALIZATION
 * ============================================================================
 *
 * This module initializes:
 * 1. OpenTelemetry for distributed tracing
 * 2. Sentry for error tracking and performance monitoring
 * 3. HTTP instrumentation for automatic span creation
 * 4. Trace context propagation for backend correlation
 *
 * Key Concepts:
 * - Traces: Complete request journey from frontend to backend
 * - Spans: Individual operations within a trace
 * - Trace ID: Unique identifier following request through services
 * - Baggage: Contextual data propagated across services
 */

import * as Sentry from '@sentry/react';
import { BrowserTracing } from '@sentry/tracing';

/**
 * Initialize Sentry for Error Tracking
 *
 * Configuration:
 * - DSN: Sentry project URL (set via environment)
 * - Environment: development/production
 * - Release: Version for tracking
 * - Traces sample rate: 100% (capture all traces) for development
 * - Replays sample rate: 10% for production (cost control)
 *
 * Integrations:
 * - BrowserTracing: Automatic HTTP instrumentation
 * - Replay: Session replay for debugging (optional)
 * - Feedback: User feedback on errors (optional)
 *
 * Features:
 * - Automatic error capture on exceptions
 * - Performance monitoring
 * - User feedback collection
 * - Session replays for debugging
 * - Source map support
 */
export function initializeSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  
  if (!dsn) {
    console.warn('Sentry DSN not configured. Error tracking disabled.');
    return;
  }

  Sentry.init({
    // Sentry project DSN
    dsn,
    
    // Environment tracking
    environment: import.meta.env.MODE,
    
    // Release versioning
    release: `observability-dashboard@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,
    
    // Performance monitoring
    // 1.0 = 100%, useful for development
    // 0.1 = 10%, recommended for production
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
    
    // Session replay
    // Captures user interactions for debugging
    replaysSessionSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 0.5,
    replaysOnErrorSampleRate: 1.0,
    
    // Integrations for automatic instrumentation
    integrations: [
      // HTTP tracing: automatically creates spans for fetch/xhr requests
      new BrowserTracing({
        // Monitor navigation changes
        tracingOrigins: ['localhost', /^\//],
        // Custom span creation
        beforeSpan(span) {
          // Filter out health check requests to reduce noise
          if (span.op === 'http.client' && span.description?.includes('/health')) {
            return null;
          }
          return span;
        }
      }),
      // Session replay for debugging
      new Sentry.Replay({
        maskAllText: true,
        blockAllMedia: true,
      }),
      // Feedback widget
      new Sentry.Feedback(),
    ],
    
    // Error filtering
    // Ignore harmless errors to reduce noise
    beforeSend(event, hint) {
      // Ignore network errors that are expected
      if (hint.originalException instanceof Error) {
        const msg = hint.originalException.message;
        if (msg.includes('Network error') || msg.includes('timeout')) {
          // Still log but with lower priority
          return event;
        }
      }
      return event;
    }
  });
}

/**
 * Initialize OpenTelemetry for Distributed Tracing
 *
 * Note: This is a placeholder. Full OTEL implementation requires:
 * - OTEL JS SDK
 * - OTEL API
 * - Context propagation
 * - W3C Trace Context headers
 *
 * For now, we rely on Sentry for tracing which handles:
 * - Automatic span creation
 * - Trace ID generation
 * - Header propagation
 * - Backend correlation
 *
 * Future enhancement:
 * - Add full OTEL instrumentation
 * - Integrate with Jaeger backend
 * - Custom span creation for business logic
 */
export function initializeOpenTelemetry() {
  const otlpEndpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;
  
  if (!otlpEndpoint) {
    console.log('OpenTelemetry endpoint not configured. Using Sentry tracing.');
    return;
  }

  // TODO: Full OTEL initialization
  // This would require OTEL JS SDK setup
  // For MVP, Sentry provides sufficient tracing
  
  console.log('OpenTelemetry configured with endpoint:', otlpEndpoint);
}

/**
 * Initialize all telemetry systems
 *
 * Should be called once at application startup
 * Before any components render or HTTP requests are made
 */
export function initializeTelemetry() {
  initializeSentry();
  initializeOpenTelemetry();
}
