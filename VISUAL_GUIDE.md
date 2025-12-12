# Project Overview & Visual Guide

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │          React Observability Dashboard (Port 5173)              │  │
│  │  ┌─────────────────┬──────────────┬──────────┬──────────────┐   │  │
│  │  │ HealthStatus    │DownloadMgr   │ErrorLog  │TraceViewer   │   │  │
│  │  │ - Health checks │ - Track jobs │ - Errors │ - Trace IDs  │   │  │
│  │  │ - API status    │ - Progress   │ - Stack  │ - Jaeger     │   │  │
│  │  │ - Storage       │ - Cancel     │ - Tags   │ - Baggage    │   │  │
│  │  └─────────────────┴──────────────┴──────────┴──────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                    HTTP + Trace Context
                              │
┌─────────────────────────────────────────────────────────────────────────┐
│                    REVERSE PROXY (Optional)                             │
│              Cloudflare / nginx / AWS ALB / etc                         │
│                  (100-300 second timeout)                               │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                    HTTP + Request ID
                              │
┌─────────────────────────────────────────────────────────────────────────┐
│                 BACKEND API (Node.js + Hono)                            │
│                        Port 3000                                        │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Routes:                                                           │ │
│  │ • GET  /health                  → Health check                   │ │
│  │ • POST /v1/download/initiate    → Start job (returns immediately)│ │
│  │ • POST /v1/download/check       → File availability             │ │
│  │ • POST /v1/download/start       → Direct download (with delay)  │ │
│  │                                                                  │ │
│  │ Middleware Stack:                                               │ │
│  │ • Request ID generation                                         │ │
│  │ • Security headers                                              │ │
│  │ • CORS handling                                                 │ │
│  │ • Timeout enforcement (30s)                                     │ │
│  │ • Rate limiting                                                 │ │
│  │ • OpenTelemetry instrumentation                                 │ │
│  │ • Error handling with Sentry                                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                    S3 Operations
                         │
         ┌───────────────┼───────────────┐
         │               │               │
┌────────────────┐ ┌─────────────┐ ┌──────────────┐
│   MinIO S3     │ │   Jaeger    │ │   OpenTel    │
│  Port 9000     │ │  Port 16686 │ │   Exporter   │
│                │ │             │ │              │
│ • Bucket: dl   │ │ • Traces    │ │ • Spans      │
│ • Downloads    │ │ • Spans     │ │ • Metrics    │
│ • Storage      │ │ • Latency   │ │ • Logs       │
└────────────────┘ └─────────────┘ └──────────────┘
```

---

## 📦 Docker Services

```
docker-compose.dev.yml (Development)
├── delineate-app
│   ├── Port: 3000
│   ├── Source: ./src
│   ├── Volumes: Hot reload
│   └── Depends: minio-init health check
│
├── delineate-minio
│   ├── Port: 9000 (API), 9001 (Console)
│   ├── Image: minio/minio:latest
│   ├── Health: Bucket creation
│   └── Data: In-memory (dev)
│
├── delineate-minio-init
│   ├── Type: One-shot init container
│   ├── Image: minio/mc:latest
│   ├── Job: Create 'downloads' bucket
│   └── Depends: minio service
│
└── delineate-jaeger
    ├── Port: 16686 (UI), 4318 (OTLP)
    ├── Image: jaegertracing/all-in-one
    ├── Endpoint: http://localhost:16686
    └── Mode: All-in-one (dev)
```

---

## 🔄 Request Flow Diagram

```
1. USER INITIATES DOWNLOAD (Polling Pattern)
   ┌─────────────────────────────────────┐
   │ Frontend: POST /v1/download/initiate │
   │ Body: { fileId: "file-123" }        │
   └─────────────────────────────────────┘
              │
              ↓
   ┌─────────────────────────────────────┐
   │ Backend: Returns Immediately         │
   │ Response: { jobId: "job-abc", ...}   │
   │ (Processing happens asynchronously)  │
   └─────────────────────────────────────┘
              │
              ↓
2. FRONTEND POLLS STATUS (Every 2 seconds)
   ┌─────────────────────────────────────┐
   │ Frontend: GET /v1/download/status    │
   │ JobId: job-abc                      │
   └─────────────────────────────────────┘
              │
              ↓
   ┌─────────────────────────────────────┐
   │ Backend: Returns Job Status          │
   │ • progress: 45%                      │
   │ • filesProcessed: 4/10               │
   │ • estimatedTimeRemaining: 30000ms    │
   └─────────────────────────────────────┘
              │
              ↓
3. REPEAT POLLING Until Status = "completed"
   ┌─────────────────────────────────────┐
   │ Frontend: Updates Progress Bar       │
   │ Shows: "4 / 10 files | 45%"         │
   │ Time Remaining: ~30 seconds          │
   └─────────────────────────────────────┘
              │
              ↓
4. DOWNLOAD COMPLETE
   ┌─────────────────────────────────────┐
   │ Backend: Status = "completed"        │
   │ Response: { downloadUrl: "s3://..." }│
   └─────────────────────────────────────┘
              │
              ↓
5. USER DOWNLOADS FILE
   ┌─────────────────────────────────────┐
   │ Frontend: Opens Download Link        │
   │ Directly from S3 (MinIO)             │
   └─────────────────────────────────────┘

KEY BENEFIT: No timeout!
- Initial request returns in <100ms
- User sees progress immediately
- Long-running work happens in background
- Polling keeps connection fresh
- Works behind proxies with 100s timeout
```

---

## 📊 Data Flow

```
FRONTEND (React)
  │
  ├─→ HealthStatus Component
  │   └─→ Polls /health every 10s
  │       └─→ Shows API & S3 status
  │
  ├─→ DownloadManager Component
  │   ├─→ POST /v1/download/initiate
  │   │   └─→ Returns jobId immediately
  │   └─→ GET /v1/download/status/:id
  │       └─→ Polls every 2s for progress
  │
  ├─→ ErrorLog Component
  │   └─→ Listens to Sentry errors
  │       └─→ Shows errors real-time
  │
  ├─→ TraceViewer Component
  │   └─→ Displays current trace ID
  │       └─→ Links to Jaeger UI
  │
  └─→ HTTP Client (api.ts)
      ├─→ Axios with interceptors
      ├─→ Sentry error tracking
      ├─→ Trace context propagation
      │   ├─→ sentry-trace header
      │   └─→ x-request-id header
      └─→ Retry logic (exponential backoff)

BACKEND (Node.js + Hono)
  │
  ├─→ Request Processing
  │   ├─→ Generate Request ID
  │   ├─→ Extract Trace Context
  │   ├─→ Rate Limiting Check
  │   ├─→ Input Validation (Zod)
  │   └─→ Route Handler
  │
  ├─→ /health Endpoint
  │   ├─→ Check API status
  │   ├─→ Check S3 connectivity
  │   └─→ Return status
  │
  ├─→ /v1/download/initiate
  │   ├─→ Create job in database
  │   ├─→ Queue background task
  │   └─→ Return jobId immediately
  │
  ├─→ /v1/download/status/:id
  │   ├─→ Lookup job in database
  │   ├─→ Return current progress
  │   └─→ Return download URL if done
  │
  └─→ Background Processing
      ├─→ Simulate download delay (10-120s)
      ├─→ Generate file
      ├─→ Upload to S3
      └─→ Update job status in database

OBSERVABILITY
  │
  ├─→ Sentry (Error Tracking)
  │   ├─→ Error Boundary (React)
  │   ├─→ Backend exceptions
  │   ├─→ HTTP errors
  │   └─→ Unhandled rejections
  │
  ├─→ OpenTelemetry (Tracing)
  │   ├─→ Trace ID generation
  │   ├─→ Span creation
  │   ├─→ Duration tracking
  │   └─→ Jaeger visualization
  │
  └─→ Request Logging
      ├─→ Request ID propagation
      ├─→ Timestamp recording
      ├─→ Duration calculation
      └─→ Log correlation

DATABASE/STORAGE
  │
  ├─→ MinIO S3 (File Storage)
  │   ├─→ Bucket: downloads
  │   ├─→ Stores generated files
  │   └─→ Serves download links
  │
  └─→ Job State (In-Memory for dev)
      ├─→ Job ID
      ├─→ Status (initiating, processing, completed)
      ├─→ Progress percentage
      └─→ Download URL
```

---

## 🎨 Frontend Component Tree

```
App (Sentry Error Boundary)
│
├─→ AppHeader
│   └─→ Title & Description
│
├─→ Dashboard (Main Content)
│   │
│   ├─→ HealthStatus
│   │   ├─→ Status Badge
│   │   ├─→ API Status
│   │   ├─→ S3 Status
│   │   ├─→ Last Checked Time
│   │   └─→ Refresh Button
│   │
│   ├─→ DownloadManager
│   │   ├─→ Input Field
│   │   ├─→ Start Button
│   │   └─→ Jobs List
│   │       └─→ Job Card (for each job)
│   │           ├─→ Job ID & File ID
│   │           ├─→ Status Badge
│   │           ├─→ Progress Bar (if processing)
│   │           ├─→ Progress Info
│   │           ├─→ Cancel Button (if processing)
│   │           ├─→ Download Link (if completed)
│   │           └─→ Error Message (if failed)
│   │
│   ├─→ ErrorLog
│   │   ├─→ Error Count Badge
│   │   ├─→ Clear Button
│   │   ├─→ Sentry Dashboard Link
│   │   └─→ Error List
│   │       └─→ Error Item (for each error)
│   │           ├─→ Error Message
│   │           ├─→ Timestamp
│   │           ├─→ Stack Trace (expandable)
│   │           ├─→ Context (expandable)
│   │           └─→ Tags (expandable)
│   │
│   └─→ TraceViewer
│       ├─→ Trace ID Display
│       ├─→ Copy Button
│       ├─→ Jaeger Link
│       ├─→ Baggage Info
│       └─→ Environment Badge
│
└─→ AppFooter
    ├─→ Current Trace ID
    └─→ App Info
```

---

## 📂 File Organization

```
Project Root
│
├── 📄 Important Documents
│   ├── COMPLETION_SUMMARY.md    (← Start here! Overall summary)
│   ├── QUICK_START.md            (← 5-minute guide)
│   ├── ARCHITECTURE.md           (Design patterns - 1800 lines)
│   ├── README.md                 (Project overview)
│   └── FILE_MANIFEST.md          (All files listed)
│
├── 📁 Backend Code (src/)
│   └── index.ts                  (Main app - 1000+ lines)
│
├── 📁 Frontend (frontend/)
│   ├── 📄 README.md             (Frontend docs)
│   ├── 📄 IMPLEMENTATION_GUIDE.md (Setup guide)
│   ├── 📄 .env.example           (Environment template)
│   ├── 📄 package.json           (Dependencies)
│   ├── 📄 vite.config.ts        (Build config)
│   ├── 📄 tsconfig.json          (TypeScript config)
│   │
│   ├── 📁 src/
│   │   ├── main.tsx              (Entry point)
│   │   ├── App.tsx               (Main component)
│   │   ├── App.css               (Styling - 900 lines)
│   │   │
│   │   ├── 📁 lib/
│   │   │   ├── api.ts            (HTTP client)
│   │   │   └── telemetry.ts      (Observability)
│   │   │
│   │   └── 📁 components/
│   │       ├── HealthStatus.tsx  (Health checks)
│   │       ├── DownloadManager.tsx (Job tracking)
│   │       ├── ErrorLog.tsx      (Error display)
│   │       └── TraceViewer.tsx   (Trace context)
│   │
│   └── 📁 public/
│       └── index.html            (HTML entry)
│
├── 📁 Docker (docker/)
│   ├── compose.dev.yml           (Dev environment)
│   ├── compose.prod.yml          (Production)
│   ├── Dockerfile.dev
│   └── Dockerfile.prod
│
├── 📁 CI/CD (.github/)
│   └── 📁 workflows/
│       └── ci.yml               (GitHub Actions pipeline)
│
├── 📄 package.json              (Backend dependencies)
├── 📄 tsconfig.json            (TypeScript config)
└── 📄 eslint.config.mjs         (Linting rules)
```

---

## 🚀 Getting Started Flowchart

```
START
  │
  ├─→ Want to run everything quickly?
  │   └─→ npm run docker:dev
  │       (Launches backend, frontend, MinIO, Jaeger)
  │
  ├─→ Want to run locally?
  │   ├─→ Backend: npm run dev
  │   ├─→ Frontend: cd frontend && npm run dev
  │   └─→ Open: http://localhost:5173
  │
  ├─→ Want to understand the design?
  │   └─→ Read ARCHITECTURE.md
  │       (Complete patterns and decisions)
  │
  ├─→ Want to know what was done?
  │   └─→ Read COMPLETION_SUMMARY.md
  │       (All deliverables listed)
  │
  ├─→ Want to troubleshoot issues?
  │   └─→ Check QUICK_START.md troubleshooting section
  │       (Common problems and solutions)
  │
  └─→ Want detailed setup instructions?
      └─→ Read frontend/IMPLEMENTATION_GUIDE.md
          (Step-by-step setup and configuration)
```

---

## 📈 Testing & Verification Flow

```
VERIFICATION CHECKLIST
│
├─→ Backend Working?
│   └─→ curl http://localhost:3000/health
│       Should return: {"status":"healthy"}
│
├─→ Frontend Loading?
│   └─→ http://localhost:5173
│       Should show dashboard with cards
│
├─→ Health Status Component?
│   └─→ Should show "Healthy" with green indicator
│       Auto-refreshes every 10s
│
├─→ Download Manager Component?
│   └─→ Enter file ID and click "Start Download"
│       Progress bar should update
│
├─→ Error Tracking?
│   └─→ Click "Trigger Sentry Test Error"
│       Error appears in Error Log
│
├─→ Distributed Tracing?
│   └─→ Make API request
│       Trace ID appears in footer
│
├─→ All Tests Pass?
│   └─→ npm run test:e2e
│       All tests should pass
│
└─→ Code Quality Good?
    └─→ npm run lint
        No errors or warnings
```

---

## 🎯 Key Architectural Decisions

```
PROBLEM: 10-120 second operations behind proxies (timeout: 100s)

SOLUTION: Polling Pattern
  ├─→ Request/Response Model
  │   └─→ Immediate responses (no timeouts)
  │
  ├─→ Asynchronous Processing
  │   └─→ Background job processing
  │
  ├─→ Status Polling
  │   └─→ Client polls every 2-5 seconds
  │
  └─→ Benefits
      ├─→ Works with all proxies
      ├─→ No timeout issues
      ├─→ Simple to implement
      ├─→ Compatible with browsers
      └─→ Scalable approach

OBSERVABILITY: Multi-Layer Tracking
  ├─→ Request IDs
  │   └─→ Trace single request through system
  │
  ├─→ Sentry Errors
  │   └─→ Real-time error notifications
  │
  ├─→ OpenTelemetry Tracing
  │   └─→ Distributed tracing with Jaeger
  │
  └─→ Log Correlation
      └─→ Find related logs by request ID

TECHNOLOGY CHOICES
  ├─→ Backend: Hono (lightweight, fast)
  ├─→ Frontend: React (popular, component-based)
  ├─→ Storage: MinIO (self-hosted, S3-compatible)
  ├─→ Tracing: OpenTelemetry (standard, vendor-neutral)
  ├─→ Errors: Sentry (production-ready)
  ├─→ Build: Vite (fast, modern)
  └─→ Containers: Docker (reproducible)
```

---

## 💡 Design Patterns Used

```
1. POLLING PATTERN
   └─→ For long-running operations
   └─→ Regular status checks
   └─→ Client-driven progress updates

2. REQUEST-RESPONSE PATTERN
   └─→ Each operation returns immediately
   └─→ No blocking on background work
   └─→ Enables timeout resilience

3. JOB QUEUE PATTERN
   └─→ Decouple initiation from processing
   └─→ Background job execution
   └─→ Status tracking separate from execution

4. ERROR BOUNDARY PATTERN
   └─→ React error containment
   └─→ Graceful error display
   └─→ Automatic error reporting

5. INTERCEPTOR PATTERN
   └─→ HTTP request interception
   └─→ Automatic trace context addition
   └─→ Error handling and retry logic

6. PUBLISH-SUBSCRIBE PATTERN
   └─→ Component subscriptions to updates
   └─→ Real-time progress notifications
   └─→ Event-driven architecture
```

---

**This visual guide helps understand the complete system architecture and how all components fit together.**
