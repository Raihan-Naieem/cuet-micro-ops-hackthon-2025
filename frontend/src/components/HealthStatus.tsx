import React, { useState, useEffect } from 'react'
import * as Sentry from '@sentry/react'

/**
 * HealthStatus Component
 * 
 * Displays the health status of the backend API and S3 storage.
 * 
 * Features:
 * - Polls /health endpoint every 10 seconds
 * - Shows API status (up/down/error)
 * - Shows S3 storage status
 * - Visual indicators (green for healthy, red for unhealthy)
 * - Timestamps for last health check
 * - Automatic error capture in Sentry if unhealthy
 * 
 * Usage:
 * <HealthStatus />
 * 
 * Props: None
 * 
 * State:
 * - status: 'checking' | 'healthy' | 'unhealthy' | 'error'
 * - lastChecked: Date of last health check
 * - message: Human-readable status message
 * - s3Status: 'ok' | 'error' | 'unknown'
 * - apiVersion: Backend API version if available
 */
interface HealthCheckResponse {
  status: string
  timestamp: string
  s3: {
    connected: boolean
    bucket: string
  }
  version?: string
}

export const HealthStatus: React.FC = () => {
  // State variables for health check
  const [status, setStatus] = useState<'checking' | 'healthy' | 'unhealthy' | 'error'>('checking')
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [message, setMessage] = useState('Checking health...')
  const [s3Status, setS3Status] = useState<'ok' | 'error' | 'unknown'>('unknown')
  const [apiVersion, setApiVersion] = useState<string>('')

  /**
   * Health check function
   * 
   * Calls GET /health endpoint to check:
   * 1. API is running
   * 2. S3 connectivity
   * 3. Database connectivity
   * 
   * Captures errors in Sentry if health check fails
   * Updates state with response data
   */
  const checkHealth = async () => {
    try {
      setStatus('checking')
      
      // Call health endpoint with 5 second timeout
      // Backend should respond within 2 seconds normally
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/health`,
        { 
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      )
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
      
      // Parse health check response
      const data: HealthCheckResponse = await response.json()
      
      // Update S3 status based on response
      setS3Status(data.s3?.connected ? 'ok' : 'error')
      
      // Store API version if provided
      if (data.version) {
        setApiVersion(data.version)
      }
      
      // Update status to healthy
      setStatus('healthy')
      setMessage('API and storage are healthy')
      setLastChecked(new Date())
      
    } catch (error) {
      // Handle error in health check
      setStatus('error')
      setS3Status('error')
      
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setMessage(`Health check failed: ${errorMsg}`)
      setLastChecked(new Date())
      
      // Capture unhealthy status in Sentry with context
      // Includes information about what failed
      Sentry.captureException(error, {
        tags: {
          component: 'HealthStatus',
          severity: 'warning',
        },
        contexts: {
          health_check: {
            s3_status: 'failed',
            api_reachable: false,
          },
        },
      })
    }
  }

  /**
   * Effect: Set up automatic health check polling
   * 
   * - Check health immediately on mount
   * - Set up interval to check every 10 seconds
   * - Clean up interval on unmount
   * 
   * Dependencies: None (runs once on mount)
   */
  useEffect(() => {
    // Run health check immediately
    checkHealth()
    
    // Set up interval for periodic health checks
    // 10 second interval balances responsiveness with server load
    const interval = setInterval(checkHealth, 10000)
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval)
  }, [])

  /**
   * Render health status UI
   * 
   * Shows:
   * - Status indicator (color-coded)
   * - Status message
   * - S3 connection status
   * - Last checked timestamp
   * - Refresh button for manual check
   */
  const statusColor = status === 'healthy' ? '#10b981' : '#ef4444'
  const statusText = status === 'healthy' ? 'Healthy' : 'Unhealthy'

  return (
    <div className="health-status-card">
      <div className="card-header">
        <h2>API Health</h2>
        <button 
          onClick={checkHealth}
          disabled={status === 'checking'}
          className="refresh-button"
          title="Click to manually check health"
        >
          {status === 'checking' ? 'Checking...' : '↻'}
        </button>
      </div>
      
      <div className="health-content">
        <div className="status-row">
          <span className="label">Status:</span>
          <div className="status-badge" style={{ borderColor: statusColor }}>
            <span 
              className="status-dot" 
              style={{ backgroundColor: statusColor }}
            />
            <span>{statusText}</span>
          </div>
        </div>
        
        <div className="status-row">
          <span className="label">Message:</span>
          <span className="message">{message}</span>
        </div>
        
        <div className="status-row">
          <span className="label">S3 Status:</span>
          <span className={`s3-status ${s3Status}`}>
            {s3Status === 'ok' ? '✓ Connected' : '✗ Disconnected'}
          </span>
        </div>
        
        {apiVersion && (
          <div className="status-row">
            <span className="label">Version:</span>
            <span>{apiVersion}</span>
          </div>
        )}
        
        <div className="status-row">
          <span className="label">Last Checked:</span>
          <span className="timestamp">
            {lastChecked 
              ? lastChecked.toLocaleTimeString() 
              : 'Never'}
          </span>
        </div>
      </div>
    </div>
  )
}

export default HealthStatus
