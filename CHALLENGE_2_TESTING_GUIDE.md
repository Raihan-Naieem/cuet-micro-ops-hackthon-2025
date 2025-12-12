# Challenge 2: Testing Guide - Long-Running Download Architecture on VM

## Overview

Challenge 2 requires designing an architecture to handle downloads that take 60-120 seconds while dealing with proxy timeouts (typically 30-100 seconds). This guide shows you how to test various approaches on a cloud VM.

---

## Phase 1: Setup VM Environment

### Step 1: Launch VM and Install Dependencies

On your Brilliant Cloud VM:

```bash
# SSH into your VM
ssh ubuntu@<your-vm-ip>

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git curl

# Install nginx (for testing proxy timeouts)
sudo apt-get install -y nginx

# Install pm2 (process manager for background services)
sudo npm install -g pm2

# Clone your repository
cd /home/ubuntu
git clone https://github.com/Raihan-Naieem/cuet-micro-ops-hackthon-2025.git
cd cuet-micro-ops-hackthon-2025

# Install dependencies
npm install
cp .env.example .env
```

---

## Phase 2: Understand the Problem

### Test 1: Direct API Call (No Proxy)

```bash
# Start the server with realistic delays (10-120s)
npm run start

# In another terminal, test a download request
curl -v -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Watch the logs:
# [Download] Starting file_id=70000 | delay=95.3s | enabled=true
# Request succeeds after ~95 seconds (but client timeout is 30s by default)
```

**Result**: Without a proxy, the request succeeds but takes ~95 seconds.

---

### Test 2: With Proxy Timeout (Simulate Real Problem)

Configure **nginx** to act as a reverse proxy with a 30-second timeout:

```bash
# Edit nginx config
sudo nano /etc/nginx/sites-available/default
```

Replace with:

```nginx
upstream delineate {
    server 127.0.0.1:3000;
}

server {
    listen 80 default_server;
    server_name _;
    
    # Simulate Cloudflare's 100s timeout, nginx's default 30s
    proxy_read_timeout 30s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    
    # Disable buffering to stream response immediately
    proxy_buffering off;
    proxy_request_buffering off;
    
    location / {
        proxy_pass http://delineate;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Restart nginx:

```bash
sudo systemctl restart nginx
sudo systemctl status nginx
```

Now test through the proxy:

```bash
# Request through nginx (port 80)
curl -v -X POST http://localhost/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Result: Gateway Timeout (504) after 30 seconds!
# This is the problem you need to solve.
```

**Result**: Request times out at 30 seconds with a 504 Gateway Timeout error.

---

## Phase 3: Testing Solution Patterns

### Solution Pattern A: Polling Pattern

This is the easiest pattern to implement and test.

#### Step 1: Implement Polling Endpoints

Add these endpoints to your API (in `src/index.ts`):

```typescript
// Start an async download job
app.post('/v1/download/initiate', (c) => {
  const jobId = crypto.randomUUID();
  const file_id = c.req.query('file_id') || Math.floor(Math.random() * 100000);
  
  // Generate random delay (10-120s for production, 5-15s for dev)
  const delay = Math.random() * (DELAY_MAX - DELAY_MIN) + DELAY_MIN;
  
  // Store job status
  jobs.set(jobId, {
    id: jobId,
    file_id,
    status: 'processing',
    startTime: Date.now(),
    estimatedDuration: delay,
    progress: 0
  });
  
  // Start processing in background (don't wait for completion)
  processDownload(jobId, delay);
  
  return c.json({ jobId, estimatedSeconds: Math.ceil(delay / 1000) }, 202);
});

// Check job status
app.get('/v1/download/status/:jobId', (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);
  
  if (!job) return c.json({ error: 'Not found' }, 404);
  
  const elapsedMs = Date.now() - job.startTime;
  const progress = Math.min(100, (elapsedMs / job.estimatedDuration) * 100);
  
  return c.json({
    jobId,
    status: job.status,
    progress: Math.round(progress),
    estimatedSecondsRemaining: Math.max(0, Math.ceil((job.estimatedDuration - elapsedMs) / 1000))
  });
});

// Get download result
app.get('/v1/download/:jobId', (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);
  
  if (!job) return c.json({ error: 'Not found' }, 404);
  if (job.status !== 'completed') return c.json({ status: job.status }, 202);
  
  return c.json({
    jobId,
    file_id: job.file_id,
    url: `/downloads/${job.file_id}.bin`,
    downloadUrl: `/v1/download/file/${job.file_id}`,
    completedAt: job.completedAt
  });
});
```

#### Step 2: Test Polling Pattern

```bash
# 1. Initiate download (returns immediately with jobId)
RESPONSE=$(curl -s -X POST "http://localhost/v1/download/initiate?file_id=70000")
JOB_ID=$(echo $RESPONSE | jq -r '.jobId')
ESTIMATED=$(echo $RESPONSE | jq -r '.estimatedSeconds')

echo "Job ID: $JOB_ID"
echo "Estimated Duration: ${ESTIMATED}s"

# 2. Poll status every 5 seconds
for i in {1..30}; do
  curl -s http://localhost/v1/download/status/$JOB_ID | jq '.progress,.estimatedSecondsRemaining'
  sleep 5
done

# 3. Get result when complete
curl -s http://localhost/v1/download/$JOB_ID | jq '.'
```

**Result**: 
- ✅ Initial request returns immediately (no timeout)
- ✅ Client can poll for progress
- ✅ User sees real-time progress updates
- ✅ Never exceeds 30s timeout on any individual request

---

### Solution Pattern B: WebSocket Pattern

For real-time push updates (faster UX):

#### Step 1: Create WebSocket Endpoint

```typescript
import { upgradeWebSocket } from "hono/ws";

app.get('/v1/download/subscribe/:jobId',
  upgradeWebSocket((c) => {
    const jobId = c.req.param('jobId');
    
    return {
      onMessage(event, ws) {
        // Not needed for server-initiated push
      },
      onClose: () => {
        console.log('Client disconnected from job:', jobId);
      }
    };
  }),
  (c) => {
    const jobId = c.req.param('jobId');
    const job = jobs.get(jobId);
    
    if (!job) return c.json({ error: 'Not found' }, 404);
    
    // WebSocket will be upgraded by the previous middleware
    return c.text('');
  }
);
```

#### Step 2: Test WebSocket

```bash
# Using websocat (install: sudo apt install websocat)
JOB_ID="<your-job-id>"

# Subscribe to updates
websocat ws://localhost:3000/v1/download/subscribe/$JOB_ID
```

---

## Phase 4: Performance Testing

### Load Testing with Multiple Downloads

```bash
#!/bin/bash
# test-polling.sh

# Start 10 concurrent polling downloads
for i in {1..10}; do
  (
    echo "Starting download $i..."
    RESPONSE=$(curl -s -X POST "http://localhost/v1/download/initiate?file_id=$((RANDOM))")
    JOB_ID=$(echo $RESPONSE | jq -r '.jobId')
    
    # Poll until complete
    while true; do
      STATUS=$(curl -s http://localhost/v1/download/$JOB_ID)
      if [ "$(echo $STATUS | jq -r '.status')" = "completed" ]; then
        echo "Download $i completed"
        break
      fi
      sleep 2
    done
  ) &
done

wait
echo "All downloads completed!"
```

Run it:

```bash
chmod +x test-polling.sh
./test-polling.sh
```

---

## Phase 5: Document Your Architecture

Create `ARCHITECTURE.md` with:

```markdown
# Challenge 2: Long-Running Download Architecture

## Problem Statement
- Downloads take 10-120 seconds
- Proxy timeouts are 30-100 seconds
- Need to handle gracefully without 504 errors

## Solution: Polling Pattern

### Diagram
```
Client                    Proxy (30s timeout)        API Server
   |                              |                       |
   |---POST /initiate------------>|---POST /initiate----->| (Instant)
   |<--jobId, 95s estimate--------|<--202 Accepted--------|
   |                              |                       |
   |---GET /status/jobId--------->|---GET /status/jobId-->| (5s)
   |<--50% progress----------------|<--200 OK-------------|
   |                              |                       |
   |---GET /status/jobId--------->|---GET /status/jobId-->| (5s)
   |<--100% progress--------------|<--200 OK-------------|
   |                              |                       |
   |---GET /download/jobId------->|---GET /download/jobId>| (Instant)
   |<--S3 download URL------------|<--200 OK-------------|
```

### Implementation Details

#### Endpoints
1. `POST /v1/download/initiate?file_id=X` - Returns jobId immediately
2. `GET /v1/download/status/:jobId` - Returns current progress
3. `GET /v1/download/:jobId` - Returns download URL when ready

#### Database/Storage
- In-memory Map or Redis: `{ jobId: { status, progress, file_id, completedAt } }`

#### Error Handling
- Job not found: 404
- Job still processing: 202 with estimated time
- Job completed: 200 with download URL

### Testing Results
- ✅ No 504 timeouts
- ✅ Max 30s per request
- ✅ Real-time progress feedback
- ✅ Handles 10+ concurrent downloads
```

---

## Deployment to VM

```bash
# Run on VM with PM2
pm2 start "npm run start" --name "delineate"
pm2 save
pm2 startup

# View logs
pm2 logs delineate

# Monitor
pm2 monit
```

---

## Success Criteria

✅ Implement at least ONE pattern (Polling recommended)
✅ Test handles 60-120s downloads without timeouts
✅ All requests complete within 30s timeout
✅ Real-time progress updates for user
✅ Document architecture with diagrams
✅ Provide testing commands/scripts

Good luck! 🚀
