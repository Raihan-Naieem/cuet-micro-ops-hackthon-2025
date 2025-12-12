import React, { useState, useEffect } from 'react'
import * as Sentry from '@sentry/react'

/**
 * TraceViewer Component
 * 
 * Displays distributed trace information for debugging and monitoring.
 * 
 * Features:
 * - Shows current Sentry trace ID
 * - Displays baggage data (correlation context)
 * - Copy trace ID to clipboard
 * - Links to Jaeger tracing UI
 * - Shows trace status
 * - Displays environment info
 * - Real-time trace context updates
 * 
 * Distributed Tracing Concepts:
 * - Trace ID: Unique identifier for request across services
 * - Parent Span ID: Current operation in the trace
 * - Baggage: User/request context propagated across services
 * - W3C Trace Context: Standard format for trace propagation
 * 
 * Props: None
 * 
 * State:
 * - traceId: Current Sentry trace ID
 * - parentSpanId: Current span ID
 * - baggage: Baggage context data
 * - copied: Whether trace ID was recently copied
 */
interface TraceInfo {
  traceId: string | null
  parentSpanId: string | null
  baggage: Record<string, string>
  environment: string
}

export const TraceViewer: React.FC = () => {
  // State: Trace information
  const [traceInfo, setTraceInfo] = useState<TraceInfo>({
    traceId: null,
    parentSpanId: null,
    baggage: {},
    environment: import.meta.env.MODE || 'production',
  })
  const [copied, setCopied] = useState(false)

  /**
   * Update trace information
   * 
   * Gets current trace ID and span ID from Sentry.
   * This runs whenever a new request is made or span is created.
   */
  const updateTraceInfo = () => {
    // Get active span from Sentry
    const activeSpan = Sentry.getActiveSpan()
    
    if (activeSpan) {
      // Extract trace information
      const spanContext = activeSpan.spanContext()
      
      // Get baggage (correlation context)
      // Baggage contains user info, session data, etc.
      const baggage = Sentry.getGlobalScope()?.baggage?.toJSON() || {}

      setTraceInfo({
        traceId: spanContext.traceId || null,
        parentSpanId: spanContext.spanId || null,
        baggage: baggage as Record<string, string>,
        environment: import.meta.env.MODE || 'production',
      })
    }
  }

  /**
   * Effect: Set up trace info update on mount and interval
   * 
   * Updates trace information:
   * - On component mount
   * - Every time an API request is made
   * - Every 5 seconds to catch new traces
   * 
   * Dependencies: None (runs once on mount)
   */
  useEffect(() => {
    // Update immediately
    updateTraceInfo()

    // Also update periodically to catch new traces
    // 5 second interval to stay current with requests
    const interval = setInterval(updateTraceInfo, 5000)

    return () => clearInterval(interval)
  }, [])

  /**
   * Copy trace ID to clipboard
   * 
   * Makes it easy for users to share trace IDs with support
   * or include in bug reports.
   */
  const copyTraceId = async () => {
    if (!traceInfo.traceId) return

    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(traceInfo.traceId)
      
      // Show feedback
      setCopied(true)
      
      // Reset feedback after 2 seconds
      setTimeout(() => setCopied(false), 2000)

      // Log action for analytics
      Sentry.captureMessage('Trace ID copied', {
        level: 'info',
        contexts: {
          trace: {
            trace_id: traceInfo.traceId,
          },
        },
      })
    } catch (error) {
      console.error('Failed to copy trace ID:', error)
    }
  }

  /**
   * Get Jaeger tracing UI URL
   * 
   * Constructs URL to view this trace in Jaeger dashboard.
   * Assumes Jaeger is running on standard port 16686.
   */
  const getJaegerUrl = (): string => {
    if (!traceInfo.traceId) return '#'
    
    // Jaeger trace URL format
    // Default to localhost:16686 in development
    const jaegerBase = import.meta.env.VITE_JAEGER_URL || 'http://localhost:16686'
    return `${jaegerBase}/trace/${traceInfo.traceId}`
  }

  /**
   * Render trace viewer UI
   * 
   * Shows:
   * - Current trace ID (clickable, copyable)
   * - Parent span ID
   * - Environment
   * - Baggage data
   * - Links to Jaeger
   */
  return (
    <div className="trace-viewer-card">
      <div className="card-header">
        <h2>Trace Context</h2>
        <span className="env-badge">{traceInfo.environment}</span>
      </div>

      <div className="trace-content">
        {/* Trace ID Section */}
        <div className="trace-section">
          <h3>Trace ID</h3>
          {traceInfo.traceId ? (
            <div className="trace-id-container">
              <code className="trace-id">{traceInfo.traceId}</code>
              <button
                onClick={copyTraceId}
                className="copy-button"
                title="Copy trace ID to clipboard"
              >
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
              <a
                href={getJaegerUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="jaeger-link"
                title="View trace in Jaeger UI"
              >
                🔍 View in Jaeger
              </a>
            </div>
          ) : (
            <p className="no-trace">No active trace. Make an API request to generate one.</p>
          )}
        </div>

        {/* Span ID Section */}
        {traceInfo.parentSpanId && (
          <div className="trace-section">
            <h3>Parent Span ID</h3>
            <code className="span-id">{traceInfo.parentSpanId}</code>
            <p className="hint">Current operation in the trace</p>
          </div>
        )}

        {/* Baggage Section */}
        <div className="trace-section">
          <h3>Baggage (Context)</h3>
          {Object.keys(traceInfo.baggage).length > 0 ? (
            <div className="baggage-items">
              {Object.entries(traceInfo.baggage).map(([key, value]) => (
                <div key={key} className="baggage-item">
                  <span className="baggage-key">{key}</span>
                  <span className="baggage-value">{String(value).substring(0, 50)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">No baggage data. Make a request to populate context.</p>
          )}
        </div>

        {/* Info Section */}
        <div className="trace-section info-section">
          <h4>About Distributed Tracing</h4>
          <ul className="info-list">
            <li><strong>Trace ID:</strong> Unique identifier for entire request flow</li>
            <li><strong>Span ID:</strong> Identifies a single operation within the trace</li>
            <li><strong>Baggage:</strong> Context data propagated across all services</li>
            <li><strong>Correlation:</strong> Trace ID in all logs for finding related operations</li>
          </ul>
        </div>
      </div>

      <div className="trace-footer">
        <p>
          💡 Use trace IDs to correlate frontend and backend logs.
          Share trace IDs with support when reporting issues.
        </p>
      </div>
    </div>
  )
}

export default TraceViewer
