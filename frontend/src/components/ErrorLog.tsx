import React, { useState, useEffect } from 'react'
import * as Sentry from '@sentry/react'

/**
 * ErrorLog Component
 * 
 * Displays recent errors captured by Sentry with details.
 * 
 * Features:
 * - Shows recent errors from Sentry
 * - Expandable error details (stack trace, context)
 * - Timestamps for each error
 * - Request ID correlation
 * - Link to Sentry dashboard
 * - Clear all button
 * - Auto-scroll to latest errors
 * - Error count badge
 * 
 * Integration:
 * - Reads errors from Sentry SDK
 * - Shows errors as they occur
 * - Updates in real-time
 * 
 * Props: None
 * 
 * State:
 * - errors: Array of captured errors
 * - expandedErrors: Set of expanded error IDs
 * - sentryDSN: DSN from environment for dashboard link
 */
interface DisplayError {
  id: string
  message: string
  timestamp: Date
  stack?: string
  context?: Record<string, any>
  tags?: Record<string, any>
  requestId?: string
}

export const ErrorLog: React.FC = () => {
  // State: Error tracking
  const [errors, setErrors] = useState<DisplayError[]>([])
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())

  /**
   * Get Sentry dashboard URL
   * 
   * Extracts DSN from Sentry config to create dashboard link.
   * Allows users to view full error details in Sentry.
   */
  const getSentryDashboardUrl = (): string => {
    // Try to get DSN from Sentry client
    const client = Sentry.getCurrentClient()
    if (client?.getOptions()?.dsn) {
      // Extract project ID from DSN
      // DSN format: https://key@sentry.io/projectId
      const dsn = client.getOptions().dsn
      const projectId = dsn.split('/').pop()
      if (projectId) {
        return `https://sentry.io/organizations/personal/issues/?project=${projectId}`
      }
    }
    return 'https://sentry.io'
  }

  /**
   * Effect: Set up Sentry error observer
   * 
   * Subscribes to Sentry events to capture errors in real-time.
   * Updates error list as new errors are captured.
   * 
   * Dependencies: None (runs once on mount)
   */
  useEffect(() => {
    /**
     * Error observer callback
     * 
     * Called whenever Sentry captures an error.
     * Extracts error details and adds to display list.
     */
    const handleError = (event: any) => {
      // Only track error events, not other events
      if (event.level !== 'error' && event.level !== 'fatal') {
        return
      }

      // Extract error information
      const newError: DisplayError = {
        id: `error-${Date.now()}-${Math.random()}`,
        message: event.message || event.exception?.[0]?.value || 'Unknown error',
        timestamp: new Date(),
        stack: event.exception?.[0]?.stacktrace ? 
          event.exception[0].stacktrace.frames.map((f: any) => 
            `  at ${f.function} (${f.filename}:${f.lineno})`
          ).join('\n') : 
          undefined,
        context: event.contexts,
        tags: event.tags,
        requestId: event.request?.headers?.['x-request-id'],
      }

      // Add to error list (keep last 20 errors)
      setErrors(prev => [newError, ...prev].slice(0, 20))

      // Auto-scroll to show new error
      const errorLogElement = document.querySelector('.error-log-content')
      if (errorLogElement) {
        setTimeout(() => {
          errorLogElement.scrollTop = 0
        }, 100)
      }
    }

    // Subscribe to Sentry events
    // This captures all events including errors, exceptions, messages
    const unsubscribe = Sentry.beforeSend((event, hint) => {
      if (event.level === 'error' || event.level === 'fatal') {
        handleError(event)
      }
      return event
    })

    // Cleanup subscription on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [])

  /**
   * Toggle error details expansion
   * 
   * Expands/collapses stack trace and context information.
   */
  const toggleExpanded = (errorId: string) => {
    setExpandedErrors(prev => {
      const newSet = new Set(prev)
      if (newSet.has(errorId)) {
        newSet.delete(errorId)
      } else {
        newSet.add(errorId)
      }
      return newSet
    })
  }

  /**
   * Clear all errors
   * 
   * Removes all errors from display log.
   * Doesn't affect Sentry backend - future errors still tracked.
   */
  const clearErrors = () => {
    setErrors([])
    setExpandedErrors(new Set())
  }

  /**
   * Render error log UI
   * 
   * Shows:
   * - Error count badge
   * - List of recent errors
   * - Expandable error details
   * - Timestamps and request IDs
   * - Link to Sentry dashboard
   * - Clear button
   */
  return (
    <div className="error-log-card">
      <div className="card-header">
        <div>
          <h2>Error Log</h2>
          <span className="error-count">{errors.length} errors</span>
        </div>
        <div className="error-actions">
          {errors.length > 0 && (
            <button 
              onClick={clearErrors}
              className="secondary-button"
              title="Clear all errors from this log"
            >
              Clear
            </button>
          )}
          <a 
            href={getSentryDashboardUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="secondary-button"
            title="View full error details in Sentry"
          >
            Sentry Dashboard
          </a>
        </div>
      </div>

      <div className="error-log-content">
        {errors.length === 0 ? (
          <div className="empty-state">
            <p>✓ No errors captured</p>
            <p className="hint">Errors will appear here as they occur</p>
          </div>
        ) : (
          <div className="error-list">
            {errors.map((error) => {
              const isExpanded = expandedErrors.has(error.id)
              return (
                <div key={error.id} className="error-item">
                  {/* Error header - always visible */}
                  <div 
                    className="error-header"
                    onClick={() => toggleExpanded(error.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="error-main">
                      <span className="error-toggle">
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <div className="error-text">
                        <h4 className="error-message">{error.message}</h4>
                        <p className="error-time">
                          {error.timestamp.toLocaleTimeString()}
                          {error.requestId && ` • ${error.requestId}`}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Expandable error details */}
                  {isExpanded && (
                    <div className="error-details">
                      {error.stack && (
                        <div className="error-section">
                          <h5>Stack Trace</h5>
                          <pre className="stack-trace">{error.stack}</pre>
                        </div>
                      )}

                      {error.context && Object.keys(error.context).length > 0 && (
                        <div className="error-section">
                          <h5>Context</h5>
                          <pre className="error-json">
                            {JSON.stringify(error.context, null, 2)}
                          </pre>
                        </div>
                      )}

                      {error.tags && Object.keys(error.tags).length > 0 && (
                        <div className="error-section">
                          <h5>Tags</h5>
                          <div className="tags">
                            {Object.entries(error.tags).map(([key, value]) => (
                              <span key={key} className="tag">
                                <strong>{key}:</strong> {String(value)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="error-log-footer">
        <p className="info-text">
          💡 Errors are captured in real-time and sent to Sentry for analysis.
          Click on any error to see full details.
        </p>
      </div>
    </div>
  )
}

export default ErrorLog
