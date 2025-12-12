import React, { useState, useCallback } from 'react'
import * as Sentry from '@sentry/react'
import { api } from '../lib/api'

/**
 * DownloadManager Component
 * 
 * Manages the lifecycle of download jobs from initiation to completion.
 * 
 * Features:
 * - Initiate new download jobs
 * - Real-time progress tracking with polling
 * - Progress bar visualization
 * - File count tracking
 * - Estimated time remaining
 * - Cancel button for active jobs
 * - Direct S3 download link when complete
 * - Automatic Sentry error tracking
 * 
 * User Flow:
 * 1. User enters file ID to download
 * 2. Click "Start Download" to initiate
 * 3. System polls status every 2 seconds
 * 4. Progress bar updates as download progresses
 * 5. When done, display download link
 * 6. User can download file or start another
 * 
 * Props: None
 * 
 * State:
 * - fileId: Input file identifier
 * - jobs: Array of active download jobs
 * - jobPollingIntervals: Map of interval IDs for cleanup
 */
interface DownloadJob {
  id: string
  fileId: string
  status: 'initiating' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  filesProcessed: number
  totalFiles: number
  estimatedTimeRemaining: number
  startTime: Date
  error?: string
  downloadUrl?: string
}

export const DownloadManager: React.FC = () => {
  // State: User input
  const [fileId, setFileId] = useState('')
  const [isInitiating, setIsInitiating] = useState(false)
  
  // State: Active jobs
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  
  // State: Polling interval tracking for cleanup
  const [jobPollingIntervals, setJobPollingIntervals] = useState<Map<string, NodeJS.Timeout>>(new Map())

  /**
   * Initiate download
   * 
   * Called when user clicks "Start Download" button.
   * 
   * Process:
   * 1. Validate input
   * 2. Call POST /v1/download/initiate with fileId
   * 3. Create new job entry with status 'initiating'
   * 4. Start polling for status updates
   * 5. Capture any errors in Sentry
   */
  const initiateDownload = useCallback(async () => {
    if (!fileId.trim()) {
      alert('Please enter a file ID')
      return
    }

    setIsInitiating(true)

    try {
      // Call backend to initiate download
      // Returns immediately with job ID
      // Actual download happens asynchronously in background
      const response = await api.initiateDownload(fileId)
      
      // Create job entry for UI tracking
      const newJob: DownloadJob = {
        id: response.jobId,
        fileId: fileId,
        status: 'processing',
        progress: 0,
        filesProcessed: 0,
        totalFiles: 1,
        estimatedTimeRemaining: 0,
        startTime: new Date(),
      }

      // Add job to state
      setJobs(prev => [...prev, newJob])
      
      // Clear input for next download
      setFileId('')

      // Start polling for status updates
      // Polls every 2 seconds - balances responsiveness with server load
      const pollInterval = setInterval(async () => {
        await pollJobStatus(response.jobId)
      }, 2000)

      // Track interval for cleanup
      setJobPollingIntervals(prev => new Map(prev).set(response.jobId, pollInterval))

      // Capture successful initiation in Sentry
      Sentry.captureMessage('Download initiated', {
        level: 'info',
        contexts: {
          download: {
            job_id: response.jobId,
            file_id: fileId,
          },
        },
      })

    } catch (error) {
      // Handle initiation error
      const errorMsg = error instanceof Error ? error.message : 'Failed to initiate download'
      alert(errorMsg)

      // Capture error in Sentry with context
      Sentry.captureException(error, {
        tags: {
          component: 'DownloadManager',
          action: 'initiate_download',
        },
        contexts: {
          download: {
            file_id: fileId,
          },
        },
      })
    } finally {
      setIsInitiating(false)
    }
  }, [fileId])

  /**
   * Poll job status
   * 
   * Called periodically (every 2 seconds) to check download progress.
   * 
   * Updates job state with:
   * - Current progress percentage
   * - Files processed count
   * - Estimated time remaining
   * - Download link when complete
   * 
   * Cleans up polling when job completes or fails
   */
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      // Call backend to get job status
      const status = await api.getDownloadStatus(jobId)

      // Update job in state
      setJobs(prev => prev.map(job => {
        if (job.id !== jobId) return job

        return {
          ...job,
          status: status.status as any,
          progress: status.progress,
          filesProcessed: status.filesProcessed || 0,
          totalFiles: status.totalFiles || 1,
          estimatedTimeRemaining: status.estimatedTimeRemaining || 0,
          downloadUrl: status.downloadUrl,
          error: status.error,
        }
      }))

      // Check if job is complete
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        // Clean up polling interval
        const interval = jobPollingIntervals.get(jobId)
        if (interval) {
          clearInterval(interval)
          setJobPollingIntervals(prev => {
            const newMap = new Map(prev)
            newMap.delete(jobId)
            return newMap
          })
        }

        // Capture completion in Sentry
        const level = status.status === 'completed' ? 'info' : 'warning'
        Sentry.captureMessage(`Download ${status.status}`, {
          level: level as any,
          contexts: {
            download: {
              job_id: jobId,
              status: status.status,
              duration_seconds: Math.round(
                (Date.now() - (jobs.find(j => j.id === jobId)?.startTime?.getTime() || 0)) / 1000
              ),
            },
          },
        })
      }

    } catch (error) {
      // Handle polling error - don't fail the entire job
      console.error(`Failed to poll status for job ${jobId}:`, error)
      
      // Capture non-fatal polling error
      Sentry.captureException(error, {
        tags: {
          component: 'DownloadManager',
          action: 'poll_status',
        },
      })
    }
  }, [jobPollingIntervals, jobs])

  /**
   * Cancel download job
   * 
   * Called when user clicks cancel button on a job.
   * 
   * Process:
   * 1. Call POST /v1/download/cancel/:jobId
   * 2. Stop polling for status
   * 3. Remove job from active list
   */
  const cancelDownload = useCallback(async (jobId: string) => {
    try {
      // Call backend to cancel job
      await api.cancelDownload(jobId)

      // Stop polling
      const interval = jobPollingIntervals.get(jobId)
      if (interval) {
        clearInterval(interval)
        setJobPollingIntervals(prev => {
          const newMap = new Map(prev)
          newMap.delete(jobId)
          return newMap
        })
      }

      // Update job status to cancelled
      setJobs(prev => prev.map(job => 
        job.id === jobId ? { ...job, status: 'cancelled' } : job
      ))

    } catch (error) {
      alert('Failed to cancel download')
      Sentry.captureException(error, {
        tags: {
          component: 'DownloadManager',
          action: 'cancel_download',
        },
      })
    }
  }, [jobPollingIntervals])

  /**
   * Render download manager UI
   * 
   * Shows:
   * - Input field for file ID
   * - Start button
   * - List of active jobs with progress bars
   * - Download link when complete
   * - Cancel buttons for active jobs
   */
  return (
    <div className="download-manager-card">
      <div className="card-header">
        <h2>Download Manager</h2>
      </div>

      <div className="download-input">
        <input
          type="text"
          placeholder="Enter file ID to download"
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && initiateDownload()}
          disabled={isInitiating}
        />
        <button
          onClick={initiateDownload}
          disabled={isInitiating || !fileId.trim()}
          className="primary-button"
        >
          {isInitiating ? 'Initiating...' : 'Start Download'}
        </button>
      </div>

      <div className="jobs-list">
        {jobs.length === 0 ? (
          <p className="empty-state">No active downloads</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="job-card">
              <div className="job-header">
                <div>
                  <h3>File: {job.fileId}</h3>
                  <p className="job-id">Job ID: {job.id}</p>
                </div>
                <span className={`job-status ${job.status}`}>
                  {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                </span>
              </div>

              {job.status === 'processing' && (
                <div className="progress-section">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <div className="progress-info">
                    <span>{job.progress.toFixed(1)}%</span>
                    <span>
                      {job.filesProcessed} / {job.totalFiles} files
                    </span>
                    {job.estimatedTimeRemaining > 0 && (
                      <span>
                        ~{Math.ceil(job.estimatedTimeRemaining / 1000)}s remaining
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => cancelDownload(job.id)}
                    className="cancel-button"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {job.status === 'completed' && job.downloadUrl && (
                <div className="success-section">
                  <p className="success-message">✓ Download complete</p>
                  <a 
                    href={job.downloadUrl}
                    download
                    className="download-link"
                  >
                    Download File
                  </a>
                </div>
              )}

              {job.status === 'failed' && (
                <div className="error-section">
                  <p className="error-message">✗ {job.error || 'Download failed'}</p>
                </div>
              )}

              {job.status === 'cancelled' && (
                <div className="cancelled-section">
                  <p className="cancelled-message">↻ Download cancelled</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default DownloadManager
