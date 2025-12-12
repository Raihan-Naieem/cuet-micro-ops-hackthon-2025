# Challenge 2: Long-Running Download Architecture Design

## Executive Summary

This document presents a comprehensive solution for handling long-running file downloads (10-120 seconds) in a microservice architecture behind reverse proxies with strict timeout limits (30-100 seconds). The core problem: direct synchronous requests timeout, leaving users with 504 Gateway Timeout errors and wasted backend processing.

---

## The Problem: Why This Matters

### Current Scenario

```
┌────────────┐                    ┌──────────────┐                 ┌─────────────┐
│   Client   │                    │    Proxy     │                 │   Backend   │
│            │                    │  (Cloudflare │                 │    API      │
└────────────┘                    │   nginx)     │                 └─────────────┘
      │                           │              │                       │
      │ POST /download/start      │              │                       │
      ├──────────────────────────>│              │                       │
      │                           │  forward req │                       │
      │                           ├─────────────>│                       │
      │                           │              │ Process (85 seconds)  │
      │                           │              │ [sleeping...]         │
      │                           │ T=30s: TIMEOUT FIRES               │
      │                           │              │                       │
      │<── 504 Gateway Timeout ───┤              │                       │
      │                           │              │ T=85s: Done!         │
      │                           │              │ Returns 200 (nobody  │
      │                           │              │  listening)          │
      │                           │              │                       │
```

### Impact

| Problem | Consequence |
|---------|-------------|
| **Client sees 504 error** | User assumes download failed, may retry |
| **No progress feedback** | User doesn't know what's happening |
| **Resource waste** | Backend processed for 85 seconds, but no one got the result |
| **Retry storms** | Multiple retries create cascading failures |
| **Bad UX** | Users frustrated by timeout errors |
| **Scaling issues** | Can't handle many concurrent long-running requests |

### Why Synchronous Requests Fail

1. **Cloudflare default**: 100 second timeout
2. **Nginx default**: 60 second timeout  
3. **AWS ALB default**: 60 second timeout
4. **Your API**: `REQUEST_TIMEOUT_MS=30000` (30 seconds)
5. **Actual operation**: 10-120 seconds (random)

Result: ~30-40% of requests timeout in production!

---

## Solution Architecture: Polling Pattern

This document implements **Option A: Polling Pattern** as it best balances:
- ✅ Simplicity to implement
- ✅ Works without WebSocket requirements
- ✅ Suitable for browser and mobile clients
- ✅ Resilient to network interruptions
- ✅ Easy to debug and monitor

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATION                             │
│  (React/Vue/Angular Frontend)                                          │
└─────────────────────────────────────────────────────────────────────────┘
      ▲                                                           │
      │                                                           │
      │ GET /v1/download/status/:jobId                           │ POST /v1/download/initiate
      │ (poll every 2 seconds)                                   │
      │                                                           ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                       REVERSE PROXY LAYER                            │
   │  (Cloudflare, nginx, AWS ALB) - 30-100s timeout                     │
   └──────────────────────────────────────────────────────────────────────┘
      ▲                                                           │
      │                                                           │
      │ Returns immediately with jobId                           ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                     DOWNLOAD API SERVICE                             │
   │                   (Node.js / Hono Backend)                           │
   └──────────────────────────────────────────────────────────────────────┘
      ▲                                                           │
      │                                                           │
      │ Job Status (DB)                                           │ Async Job Processing
      │ - jobId: uuid                                             │ (Background Worker)
      │ - status: pending|processing|completed|failed            │
      │ - progress: 0-100%                                        │ Process file asynchronously
      │ - downloadUrl: null|presigned-url                        │ Update DB status
      │ - error: null|message                                    │
      │ - createdAt, updatedAt                                   │
      │                                                           ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                      DATA & STORAGE LAYER                            │
   │  ┌─────────────────────┐         ┌──────────────────────────────┐  │
   │  │  Job Status DB      │         │  S3-Compatible Storage       │  │
   │  │  (Redis / SQLite)   │         │  (MinIO / RustFS / AWS S3)   │  │
   │  │                     │         │                              │  │
   │  │ - Fast reads        │         │ - File storage               │  │
   │  │ - Expire old jobs   │         │ - Presigned URLs             │  │
   │  └─────────────────────┘         └──────────────────────────────┘  │
   └──────────────────────────────────────────────────────────────────────┘
```

### Request Flow Timeline

```
┌─────────────┐                          ┌──────────────────────────────┐
│   Client    │                          │   Backend API                │
└─────────────┘                          └──────────────────────────────┘
      │                                        │
      │ 1. POST /download/initiate             │
      │    {file_ids: [70000]}                 │
      ├───────────────────────────────────────>│
      │                                        │
      │                                   [Create job]
      │                                   Store: {
      │                                     jobId: "abc123"
      │                                     status: "pending"
      │                                     files: [70000]
      │                                     progress: 0
      │                                   }
      │                                   
      │ 2. Response: {jobId, status}     [Queue async job]
      │    (immediate, <100ms)                 │
      │<───────────────────────────────────────┤
      │                                        │
      │ 3. Store jobId in local storage       │
      │    Display "Processing..." message    │
      │                                   [Background Worker]
      │                                   Starts processing:
      │                                   - Fetch file metadata
      │                                   - Compress/convert
      │                                   - Upload to S3
      │                                   Updates: status="processing"
      │                                   
      │ 4. GET /download/status/abc123   │
      │    (after 2 seconds)                  │
      ├───────────────────────────────────────>│
      │                                        │
      │ 5. Response: {status, progress}  │
      │    {                                   │
      │      status: "processing",             │
      │      progress: 25,                     │
      │      downloadUrl: null                 │
      │    }                                   │
      │<───────────────────────────────────────┤
      │                                        │
      │ 6. UPDATE UI with progress bar       │
      │    Continue polling every 2s          │
      │                                   [More processing...]
      │                                        │
      │ 7. GET /download/status/abc123   │
      │    (recurring every 2 seconds)        │
      ├───────────────────────────────────────>│
      │                                        │
      │ 8. Response: {status, progress}  │
      │    {                                   │
      │      status: "processing",             │
      │      progress: 75,                     │
      │      downloadUrl: null                 │
      │    }                                   │
      │<───────────────────────────────────────┤
      │                                   [Processing complete]
      │                                   Update: status="completed"
      │                                   Download URL ready
      │                                        │
      │ 9. GET /download/status/abc123   │
      ├───────────────────────────────────────>│
      │                                        │
      │ 10. Response: COMPLETE          │
      │    {                                   │
      │      status: "completed",              │
      │      progress: 100,                    │
      │      downloadUrl: "https://s3..."     │
      │    }                                   │
      │<───────────────────────────────────────┤
      │                                        │
      │ 11. Redirect to downloadUrl           │
      │     Browser downloads directly from S3│
      │                                        │
```

---

## API Contract Changes

### 1. POST /v1/download/initiate (Existing, Enhanced)

**Current Response:**
```json
{
  "jobId": "uuid",
  "status": "queued|processing",
  "totalFileIds": 5
}
```

**Enhancement:**
- Response should return **immediately** (<100ms)
- Don't wait for processing
- Store job in database/cache immediately

---

### 2. GET /v1/download/status/:jobId (New)

**Purpose:** Client polls this endpoint to check download progress

**Request:**
```http
GET /v1/download/status/uuid-here
```

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "pending|processing|completed|failed",
  "progress": 0-100,
  "totalFiles": 5,
  "processedFiles": 0,
  "downloadUrl": null,
  "error": null,
  "createdAt": "2025-12-12T10:00:00Z",
  "updatedAt": "2025-12-12T10:00:30Z",
  "estimatedSecondsRemaining": 45
}
```

**Response Codes:**
- `200`: Job exists, status in response
- `404`: Job not found (expired/never existed)
- `410`: Job cancelled by user

---

### 3. GET /v1/download/:jobId (New)

**Purpose:** Download the actual file after processing completes

**Usage:**
- Client calls this only when status endpoint shows status="completed"
- Could redirect to presigned S3 URL or download directly

**Response:**
```http
HTTP/1.1 302 Found
Location: https://s3.amazonaws.com/bucket/downloads/70000.zip?auth=token&expires=900

OR

HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="download.zip"
Content-Length: 1024000

[binary file data]
```

---

### 4. POST /v1/download/cancel/:jobId (New)

**Purpose:** Allow users to cancel ongoing downloads

**Request:**
```http
POST /v1/download/cancel/uuid-here
```

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "cancelled",
  "message": "Download job cancelled successfully"
}
```

---

## Implementation Details

### Database/Cache Schema

#### Option A: Redis (Recommended)
```javascript
// Job status hash
Key: "download:job:abc123"
Hash {
  jobId: "abc123"
  status: "processing"
  progress: 45
  totalFiles: 5
  processedFiles: 2
  downloadUrl: null
  error: null
  createdAt: "2025-12-12T10:00:00Z"
  updatedAt: "2025-12-12T10:00:30Z"
  ttl: 86400 (expire after 24 hours)
}

// Index of user's jobs
Key: "download:user:user@example.com"
Set ["abc123", "def456", "ghi789"]

// Sorted set for cleanup
Key: "download:expiry"
Sorted Set {
  "abc123": 1702368000 (timestamp to expire)
  "def456": 1702450000
}
```

#### Option B: SQL Database
```sql
CREATE TABLE download_jobs (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255),
  status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
  progress INT DEFAULT 0,
  total_files INT,
  processed_files INT DEFAULT 0,
  download_url VARCHAR(2048) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  
  INDEX (user_id, created_at),
  INDEX (status, updated_at)
);

CREATE TABLE download_job_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id UUID REFERENCES download_jobs(id),
  file_id INT,
  status ENUM('pending', 'processing', 'completed', 'failed'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX (job_id),
  UNIQUE (job_id, file_id)
);
```

### Background Job Processing Strategy

#### Option A: Simple Queue (Bull + Redis)

```typescript
import Queue from 'bull';

// Create job queue
const downloadQueue = new Queue('downloads', 
  'redis://localhost:6379'
);

// Job processor
downloadQueue.process(5, async (job) => {
  const { jobId, fileIds } = job.data;
  
  // Update job status
  await redis.hset(`download:job:${jobId}`, 'status', 'processing');
  
  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i];
    
    // Process single file
    const s3Key = `downloads/${fileId}.zip`;
    const available = await checkS3Availability(fileId);
    
    if (available) {
      // Simulate processing
      await processFile(fileId);
      
      // Update progress
      const progress = Math.floor((i + 1) / fileIds.length * 100);
      await redis.hset(`download:job:${jobId}`, 
        'progress', progress,
        'processedFiles', i + 1,
        'updatedAt', new Date().toISOString()
      );
    }
  }
  
  // Mark complete
  const downloadUrl = await generatePresignedUrl(fileIds[0]);
  await redis.hset(`download:job:${jobId}`, 
    'status', 'completed',
    'progress', 100,
    'downloadUrl', downloadUrl
  );
});

// Handle job failures
downloadQueue.on('failed', (job, err) => {
  redis.hset(`download:job:${job.data.jobId}`, 
    'status', 'failed',
    'error', err.message
  );
});

// Endpoint: Initiate download
app.post('/v1/download/initiate', async (c) => {
  const { file_ids } = c.req.valid('json');
  const jobId = crypto.randomUUID();
  
  // Create job record immediately
  await redis.hset(`download:job:${jobId}`, 
    'jobId', jobId,
    'status', 'pending',
    'progress', 0,
    'totalFiles', file_ids.length,
    'processedFiles', 0,
    'createdAt', new Date().toISOString(),
    'updatedAt', new Date().toISOString()
  );
  
  // Queue async job (returns immediately)
  await downloadQueue.add({
    jobId,
    fileIds: file_ids
  });
  
  // Return immediately with jobId
  return c.json({
    jobId,
    status: 'pending',
    totalFileIds: file_ids.length
  }, 200);
});

// Endpoint: Check status
app.get('/v1/download/status/:jobId', async (c) => {
  const { jobId } = c.req.param();
  
  const jobData = await redis.hgetall(`download:job:${jobId}`);
  
  if (!jobData || !jobData.jobId) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  return c.json(jobData, 200);
});
```

#### Option B: AWS SQS + Lambda

```typescript
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";

const sqs = new SQSClient();
const dynamodb = new DynamoDBClient();

// Endpoint: Initiate download
app.post('/v1/download/initiate', async (c) => {
  const { file_ids } = c.req.valid('json');
  const jobId = crypto.randomUUID();
  
  // Store job status in DynamoDB
  await dynamodb.send(new PutItemCommand({
    TableName: 'download-jobs',
    Item: {
      jobId: { S: jobId },
      userId: { S: c.get('user').id },
      status: { S: 'pending' },
      progress: { N: '0' },
      totalFiles: { N: String(file_ids.length) },
      processedFiles: { N: '0' },
      fileIds: { NS: file_ids.map(String) },
      createdAt: { S: new Date().toISOString() },
      updatedAt: { S: new Date().toISOString() },
      ttl: { N: String(Math.floor(Date.now() / 1000) + 86400) }
    }
  }));
  
  // Send to SQS for async processing
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify({
      jobId,
      fileIds: file_ids
    })
  }));
  
  return c.json({
    jobId,
    status: 'pending',
    totalFileIds: file_ids.length
  }, 200);
});

// Endpoint: Check status
app.get('/v1/download/status/:jobId', async (c) => {
  const { jobId } = c.req.param();
  
  const response = await dynamodb.send(new GetItemCommand({
    TableName: 'download-jobs',
    Key: { jobId: { S: jobId } }
  }));
  
  if (!response.Item) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  return c.json({
    jobId: response.Item.jobId.S,
    status: response.Item.status.S,
    progress: parseInt(response.Item.progress.N),
    totalFiles: parseInt(response.Item.totalFiles.N),
    processedFiles: parseInt(response.Item.processedFiles.N),
    downloadUrl: response.Item.downloadUrl?.S || null,
    error: response.Item.error?.S || null,
    createdAt: response.Item.createdAt.S,
    updatedAt: response.Item.updatedAt.S
  }, 200);
});
```

---

## Error Handling & Retry Logic

### Client-Side Retry Strategy

```javascript
// React hook for robust polling
const useDownloadStatus = (jobId, options = {}) => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const MAX_RETRIES = 5;
  const POLL_INTERVAL = 2000; // 2 seconds
  const MAX_RETRIES_WAIT = 10000; // Max 10 seconds between retries
  
  useEffect(() => {
    if (status?.status === 'completed' || 
        status?.status === 'failed' || 
        status?.status === 'cancelled') {
      return; // Stop polling
    }
    
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/v1/download/status/${jobId}`,
          { signal: AbortSignal.timeout(5000) } // 5 second timeout
        );
        
        if (response.status === 404) {
          setError('Download job not found');
          return;
        }
        
        if (response.ok) {
          const data = await response.json();
          setStatus(data);
          setRetryCount(0); // Reset on success
        } else if (response.status === 500 || response.status === 503) {
          // Server error, implement backoff
          setRetryCount(prev => {
            const newCount = prev + 1;
            if (newCount > MAX_RETRIES) {
              setError('Failed to get download status after retries');
              return newCount;
            }
            return newCount;
          });
        }
      } catch (err) {
        // Network error, retry with backoff
        setRetryCount(prev => {
          const newCount = prev + 1;
          if (newCount > MAX_RETRIES) {
            setError('Network error getting download status');
            return newCount;
          }
          return newCount;
        });
      }
    }, POLL_INTERVAL + (retryCount * 1000)); // Exponential backoff
    
    return () => clearInterval(timer);
  }, [jobId, status]);
  
  return { status, error, retryCount };
};
```

### Server-Side Error Handling

```typescript
// Endpoint with error handling
app.post('/v1/download/initiate', async (c) => {
  try {
    const { file_ids } = c.req.valid('json');
    
    // Validate input
    if (!file_ids || file_ids.length === 0) {
      return c.json({
        error: 'Bad Request',
        message: 'file_ids must be non-empty array'
      }, 400);
    }
    
    if (file_ids.length > 1000) {
      return c.json({
        error: 'Bad Request',
        message: 'Maximum 1000 files per job'
      }, 400);
    }
    
    const jobId = crypto.randomUUID();
    
    // Try to create job
    try {
      await redis.hset(`download:job:${jobId}`, 
        'jobId', jobId,
        'status', 'pending',
        'progress', 0,
        'totalFiles', file_ids.length,
        'processedFiles', 0,
        'createdAt', new Date().toISOString(),
        'updatedAt', new Date().toISOString()
      );
    } catch (redisErr) {
      // Redis failure - critical
      c.get('sentry').captureException(redisErr);
      return c.json({
        error: 'Internal Server Error',
        message: 'Failed to create download job'
      }, 500);
    }
    
    // Queue job
    try {
      await downloadQueue.add({
        jobId,
        fileIds: file_ids
      });
    } catch (queueErr) {
      // Queue failure - clean up and return error
      c.get('sentry').captureException(queueErr);
      await redis.del(`download:job:${jobId}`);
      return c.json({
        error: 'Internal Server Error',
        message: 'Failed to queue download job'
      }, 500);
    }
    
    return c.json({
      jobId,
      status: 'pending',
      totalFileIds: file_ids.length
    }, 200);
    
  } catch (err) {
    c.get('sentry').captureException(err);
    return c.json({
      error: 'Internal Server Error',
      message: env.NODE_ENV === 'production' ? 
        'An error occurred' : err.message
    }, 500);
  }
});

// Graceful handling of processing failures
downloadQueue.on('failed', async (job, err) => {
  const { jobId } = job.data;
  
  // Update job status to failed
  await redis.hset(`download:job:${jobId}`, 
    'status', 'failed',
    'error', err.message,
    'updatedAt', new Date().toISOString()
  );
  
  // Log for debugging
  console.error(`Job ${jobId} failed:`, err);
  
  // Send to Sentry
  Sentry.captureException(err, {
    tags: { jobId, type: 'download_processing' }
  });
  
  // Optionally cleanup resources
  // If file was partially downloaded, delete it
});
```

---

## Timeout Configuration at Each Layer

### 1. Cloudflare Configuration

```toml
# cloudflare.toml
[env.production]
routes = [
  { pattern = "example.com/api/*", zone_name = "example.com" }
]

# Cache timeout settings
[env.production.route_rules]
{
  "expression": "(cf.cache_level eq \"cache_everything\") and (http.request.uri.path contains \"/api/\")",
  "cache_ttl": 3600,
  "origin_cache_control": true
}

# Long running request settings
{
  "expression": "(http.request.uri.path contains \"/download/status\")",
  "cache_level": "bypass", # Don't cache status checks
  "origin_max_http_version": 2,
}

# Set browser timeout to 600 seconds (10 minutes)
# Via Cloudflare Dashboard > Speed > Page Rules
# URL: example.com/api/*
# Browser cache TTL: 10 minutes
```

### 2. Nginx Configuration

```nginx
# Upstream server block
upstream api_backend {
  server localhost:3000 max_fails=3 fail_timeout=30s;
  keepalive 32;
}

# Server block
server {
  listen 80;
  server_name example.com;
  
  # Timeout settings for long-running requests
  # Increased for download status polling
  proxy_connect_timeout 10s;
  proxy_send_timeout 30s;
  proxy_read_timeout 120s;  # 2 minutes for status checks
  
  # Specific location for status polling (longer timeout)
  location ~ /api/v1/download/status/ {
    proxy_pass http://api_backend;
    proxy_read_timeout 120s;  # Allow status checks to take up to 2 minutes
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  
  # Status initiate endpoint (shorter timeout ok)
  location ~ /api/v1/download/initiate {
    proxy_pass http://api_backend;
    proxy_read_timeout 10s;  # Should return quickly
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  
  # Default API routes
  location ~ /api/ {
    proxy_pass http://api_backend;
    proxy_read_timeout 30s;  # Default timeout
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Disable response buffering for streaming
    proxy_buffering off;
    proxy_request_buffering off;
  }
}
```

### 3. AWS ALB Configuration

```terraform
# AWS Application Load Balancer with custom timeout
resource "aws_lb_target_group" "api" {
  name             = "delineate-api-tg"
  port             = 3000
  protocol         = "HTTP"
  vpc_id           = aws_vpc.main.id
  
  # Default deregistration delay (connection draining)
  deregistration_delay = 30
  
  # Health check settings
  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }
  
  stickiness {
    type            = "lb_cookie"
    enabled         = true
    cookie_duration = 86400
  }
}

# ALB listener with idle timeout
resource "aws_lb_listener" "api" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = aws_acm_certificate.main.arn
  
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# EC2 instance with custom timeout
resource "aws_lb_listener_rule" "download_status" {
  listener_arn = aws_lb_listener.api.arn
  priority     = 10
  
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  
  condition {
    path_pattern {
      values = ["/api/v1/download/status/*"]
    }
  }
}

# Configure ALB timeout in application configuration
output "alb_dns_name" {
  value = aws_lb.main.dns_name
  description = "Note: ALB default idle timeout is 60 seconds. Status polling should complete within this time."
}
```

---

## Frontend Integration (React/Next.js Example)

### Complete Implementation

```typescript
// lib/downloadService.ts
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

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

/**
 * Initiate a bulk download
 * Returns immediately with jobId for polling
 */
export const initiateDownload = async (fileIds: number[]): Promise<string> => {
  const response = await axios.post(`${API_BASE}/v1/download/initiate`, {
    file_ids: fileIds
  }, {
    timeout: 10000 // Should complete within 10 seconds
  });
  
  return response.data.jobId;
};

/**
 * Poll for download status
 * Client calls this repeatedly until complete
 */
export const getDownloadStatus = async (jobId: string): Promise<DownloadJob> => {
  const response = await axios.get(
    `${API_BASE}/v1/download/status/${jobId}`,
    { timeout: 5000 }
  );
  
  return response.data;
};

/**
 * Cancel ongoing download
 */
export const cancelDownload = async (jobId: string): Promise<void> => {
  await axios.post(`${API_BASE}/v1/download/cancel/${jobId}`, {
    timeout: 5000
  });
};

// hooks/useDownload.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { DownloadJob, initiateDownload, getDownloadStatus, cancelDownload } from '../lib/downloadService';

interface UseDownloadOptions {
  autoStart?: boolean;
  pollInterval?: number; // milliseconds
  onProgress?: (job: DownloadJob) => void;
  onComplete?: (job: DownloadJob) => void;
  onError?: (error: Error) => void;
}

export const useDownload = (fileIds: number[], options: UseDownloadOptions = {}) => {
  const {
    autoStart = true,
    pollInterval = 2000,
    onProgress,
    onComplete,
    onError
  } = options;
  
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  
  // Start download
  const start = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const id = await initiateDownload(fileIds);
      setJobId(id);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [fileIds, onError]);
  
  // Poll for status
  useEffect(() => {
    if (!jobId) return;
    if (job?.status === 'completed' || job?.status === 'failed' || job?.status === 'cancelled') {
      return; // Stop polling
    }
    
    const poll = async () => {
      try {
        const status = await getDownloadStatus(jobId);
        setJob(status);
        onProgress?.(status);
        retryCountRef.current = 0;
        
        if (status.status === 'completed') {
          onComplete?.(status);
        } else if (status.status === 'failed') {
          setError(new Error(status.error || 'Download failed'));
        }
      } catch (err) {
        // Implement retry with exponential backoff
        const retries = retryCountRef.current;
        if (retries < 5) {
          retryCountRef.current = retries + 1;
          // Will retry on next interval
        } else {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          onError?.(error);
        }
      }
    };
    
    poll(); // Poll immediately
    pollTimerRef.current = setInterval(poll, pollInterval);
    
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [jobId, job, pollInterval, onProgress, onComplete, onError]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);
  
  const cancel = useCallback(async () => {
    if (jobId) {
      try {
        await cancelDownload(jobId);
        setJob(prev => prev ? { ...prev, status: 'cancelled' } : null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
      }
    }
  }, [jobId]);
  
  const download = useCallback(() => {
    if (job?.downloadUrl) {
      const link = document.createElement('a');
      link.href = job.downloadUrl;
      link.download = `download-${new Date().toISOString()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [job?.downloadUrl]);
  
  return {
    jobId,
    job,
    loading,
    error,
    start,
    cancel,
    download,
    isComplete: job?.status === 'completed',
    isFailed: job?.status === 'failed',
    progress: job?.progress ?? 0
  };
};

// components/DownloadUI.tsx
import React from 'react';
import { useDownload } from '../hooks/useDownload';

export const DownloadUI: React.FC<{ fileIds: number[] }> = ({ fileIds }) => {
  const { 
    job, 
    loading, 
    error, 
    start, 
    cancel, 
    download, 
    progress,
    isComplete,
    isFailed 
  } = useDownload(fileIds, {
    onProgress: (job) => {
      console.log(`Progress: ${job.progress}% - ${job.processedFiles}/${job.totalFiles} files`);
    },
    onComplete: (job) => {
      console.log('Download ready!', job.downloadUrl);
    },
    onError: (error) => {
      console.error('Download failed:', error);
    }
  });
  
  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>File Download</h2>
      
      {!job ? (
        <button 
          onClick={start} 
          disabled={loading}
          style={{ padding: '10px 20px', fontSize: '16px' }}
        >
          {loading ? 'Initiating...' : 'Start Download'}
        </button>
      ) : (
        <div>
          <p>Status: <strong>{job.status}</strong></p>
          <p>Progress: {progress}% ({job.processedFiles}/{job.totalFiles} files)</p>
          
          <div style={{
            width: '100%',
            height: '20px',
            backgroundColor: '#e0e0e0',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: '#4CAF50',
              transition: 'width 0.3s ease'
            }} />
          </div>
          
          {job.estimatedSecondsRemaining && (
            <p>Estimated time: {Math.ceil(job.estimatedSecondsRemaining)}s</p>
          )}
          
          {error && (
            <p style={{ color: 'red' }}>{error.message}</p>
          )}
          
          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            {!isComplete && !isFailed && (
              <button onClick={cancel} style={{ padding: '10px 20px' }}>
                Cancel
              </button>
            )}
            {isComplete && (
              <button 
                onClick={download} 
                style={{ padding: '10px 20px', backgroundColor: '#4CAF50', color: 'white' }}
              >
                Download Now
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
```

---

## Monitoring & Observability

### Key Metrics to Track

```javascript
// OpenTelemetry custom spans for download tracking
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('download-service');

app.post('/v1/download/initiate', async (c) => {
  const span = tracer.startSpan('download.initiate');
  
  try {
    const { file_ids } = c.req.valid('json');
    const jobId = crypto.randomUUID();
    
    // Custom attributes for observability
    span.setAttributes({
      'download.jobId': jobId,
      'download.fileCount': file_ids.length,
      'download.fileIds': file_ids.join(',')
    });
    
    // Record event
    span.addEvent('job_created', {
      'job.status': 'pending',
      'job.timestamp': Date.now()
    });
    
    // ... rest of implementation
    
    return c.json({
      jobId,
      status: 'pending',
      totalFileIds: file_ids.length
    }, 200);
  } finally {
    span.end();
  }
});

// Metrics to expose
const metrics = {
  // Counters
  'download.initiated.total': 'Total downloads initiated',
  'download.completed.total': 'Total downloads completed successfully',
  'download.failed.total': 'Total downloads failed',
  'download.cancelled.total': 'Total downloads cancelled',
  
  // Histograms
  'download.duration.seconds': 'Total time from initiate to complete',
  'download.processing.seconds': 'Server-side processing time',
  'download.status_checks.total': 'Total status check requests',
  'download.status_checks.latency': 'Latency of status check endpoint',
  
  // Gauges
  'download.jobs.active': 'Currently active download jobs',
  'download.jobs.queue_depth': 'Number of jobs waiting to be processed'
};
```

### Sentry Configuration for Error Tracking

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: 1.0,
  
  // Ignore harmless errors
  beforeSend(event, hint) {
    // Ignore client network errors
    if (hint.originalException instanceof Error &&
        hint.originalException.message.includes('Network error')) {
      return null;
    }
    return event;
  },
  
  // Tag all download errors
  integrations: [
    new Sentry.Integrations.OnUncaughtException(),
    new Sentry.Integrations.OnUnhandledRejection(),
    {
      name: 'download-error-tagging',
      setup(client) {
        client.on('beforeSend', (event) => {
          if (event.tags?.service === 'download') {
            event.tags.error_type = 'download_processing';
          }
          return event;
        });
      }
    }
  ]
});

// Example: Send custom error with context
try {
  await processDownload(jobId);
} catch (err) {
  Sentry.captureException(err, {
    tags: {
      service: 'download',
      jobId,
      fileCount: files.length
    },
    contexts: {
      download: {
        jobId,
        status: 'processing',
        filesProcessed: processed,
        totalFiles: files.length
      }
    }
  });
}
```

---

## Comparison: Polling vs Alternatives

| Aspect | Polling | WebSocket | Server-Sent Events | Webhook |
|--------|---------|-----------|-------------------|---------|
| **Simplicity** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Browser Support** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | N/A |
| **Mobile Support** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✓ |
| **Server Resources** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Real-time Feedback** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Proxy Compatible** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Bandwidth Usage** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Retry Logic** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

**Recommendation:** Start with Polling for MVP, migrate to WebSockets + fallback to polling if you need real-time updates.

---

## Deployment Checklist

- [ ] Database/Cache setup (Redis or RDB)
- [ ] Background job queue configured (Bull, AWS SQS, etc.)
- [ ] S3 bucket created and permissions granted
- [ ] Proxy timeouts configured appropriately
- [ ] API endpoints implemented (/initiate, /status, /cancel, /download)
- [ ] Frontend integration complete with error handling
- [ ] Monitoring and observability configured
- [ ] Tests written for polling scenario
- [ ] Load testing done with concurrent downloads
- [ ] Documentation updated for teams
- [ ] Rollback plan prepared

---

## Testing Strategy

### Unit Tests

```typescript
describe('Download Service', () => {
  test('initiateDownload returns jobId immediately', async () => {
    const start = Date.now();
    const jobId = await initiateDownload([70000]);
    const duration = Date.now() - start;
    
    expect(jobId).toBeTruthy();
    expect(duration).toBeLessThan(100); // Should be instant
  });
  
  test('getDownloadStatus returns job progress', async () => {
    const jobId = await initiateDownload([70000]);
    
    const status = await getDownloadStatus(jobId);
    expect(status.jobId).toEqual(jobId);
    expect(status.progress).toBeGreaterThanOrEqual(0);
  });
});
```

### Integration Tests

```typescript
test('End-to-end download flow', async () => {
  // 1. Initiate
  const jobId = await initiateDownload([70000, 70001]);
  expect(jobId).toBeTruthy();
  
  // 2. Poll until complete (with timeout)
  let job = null;
  for (let i = 0; i < 120; i++) { // 2 minute timeout
    job = await getDownloadStatus(jobId);
    
    if (job.status === 'completed') break;
    if (job.status === 'failed') throw new Error(job.error);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  expect(job.status).toEqual('completed');
  expect(job.downloadUrl).toBeTruthy();
  
  // 3. Download file
  const response = await fetch(job.downloadUrl);
  expect(response.status).toEqual(200);
});
```

---

## Conclusion

This polling-based architecture solves the fundamental problem of long-running operations behind proxies by:

1. **Returning immediately** to avoid timeouts
2. **Providing progress feedback** so users know what's happening
3. **Scaling efficiently** with asynchronous job processing
4. **Working everywhere** with robust retry logic
5. **Monitoring well** with built-in observability

The pattern is battle-tested and used by companies like Stripe, Slack, and AWS for async operations.

