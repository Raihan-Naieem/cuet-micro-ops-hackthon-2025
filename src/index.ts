/**
 * ============================================================================
 * DELINEATE HACKATHON CHALLENGE - CUET FEST 2025
 * Long-Running Download Microservice with S3 Integration
 * ============================================================================
 *
 * This service demonstrates a real-world file download system with:
 * - Variable processing times (10-120 seconds) simulating slow file operations
 * - S3-compatible storage integration for file availability checks
 * - OpenTelemetry observability for distributed tracing
 * - Sentry error tracking for production debugging
 * - Rate limiting and timeout handling for resilience
 * - Security headers and input validation
 *
 * The core challenge: How to handle long-running operations gracefully when
 * deployed behind reverse proxies (Cloudflare, nginx, AWS ALB) with strict
 * timeout limits. This requires architectural patterns like polling, WebSockets,
 * or async job processing.
 */

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { sentry } from "@hono/sentry";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";

/**
 * ============================================================================
 * ENVIRONMENT CONFIGURATION
 * ============================================================================
 */

/**
 * Helper for optional URL validation
 * Treats empty strings as undefined to avoid validation errors
 * Ensures URLs are properly formatted when provided
 */
const optionalUrl = z
  .string()
  .optional()
  .transform((val) => (val === "" ? undefined : val))
  .pipe(z.url().optional());

/**
 * Environment Schema - Validates and provides defaults for all configuration
 * Uses Zod for type-safe runtime validation
 *
 * Key configurations:
 * - S3_ENDPOINT: Self-hosted S3-compatible storage (MinIO, RustFS, etc.)
 * - DOWNLOAD_DELAY_*: Simulates variable processing times
 * - SENTRY_DSN: Error tracking integration
 * - OTEL_EXPORTER_OTLP_ENDPOINT: Distributed tracing endpoint
 * - REQUEST_TIMEOUT_MS: Maximum request duration before proxy timeout
 * - RATE_LIMIT_*: Request throttling to prevent abuse
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: optionalUrl,
  S3_BUCKET_NAME: z.string().default(""),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(100),
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((val) => (val === "*" ? "*" : val.split(","))),
  /**
   * Download Delay Simulation Configuration
   * Used to demonstrate the problem of long-running operations behind proxies
   * - Development mode: 5-15 seconds (quick feedback loop)
   * - Production mode: 10-120 seconds (realistic scenario showing proxy timeouts)
   */
  DOWNLOAD_DELAY_MIN_MS: z.coerce.number().int().min(0).default(10000), // 10 seconds
  DOWNLOAD_DELAY_MAX_MS: z.coerce.number().int().min(0).default(200000), // 200 seconds
  DOWNLOAD_DELAY_ENABLED: z.coerce.boolean().default(true),
});

/**
 * Parse and validate environment variables at startup
 * Throws error if required environment variables are missing or invalid
 * Provides sensible defaults for optional configuration
 */
const env = EnvSchema.parse(process.env);

/**
 * ============================================================================
 * S3 CLIENT INITIALIZATION
 * ============================================================================
 */

/**
 * Initialize AWS S3 Client with optional self-hosted endpoint
 * Supports both AWS S3 and S3-compatible services (MinIO, RustFS, etc.)
 *
 * Configuration Details:
 * - endpoint: If provided, connects to self-hosted storage (e.g., MinIO at localhost:9000)
 * - credentials: Uses access key ID and secret for authentication
 * - forcePathStyle: Required for self-hosted S3-compatible services to use path-style URLs
 *   instead of virtual-hosted-style URLs (important for MinIO compatibility)
 *
 * Path Style vs Virtual Hosted Style:
 * - Path style: https://storage.example.com/bucket-name/key
 * - Virtual: https://bucket-name.storage.example.com/key
 * Self-hosted services typically require path style
 */
const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  ...(env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

/**
 * ============================================================================
 * OPENTELEMETRY INITIALIZATION
 * ============================================================================
 */

/**
 * Initialize OpenTelemetry Node SDK for distributed tracing
 * Captures all HTTP requests and automatically creates spans
 *
 * Features:
 * - Automatic span creation for each request
 * - Resource attributes identify the service
 * - OTLP HTTP exporter sends traces to Jaeger or other collectors
 * - Helps track requests across service boundaries (frontend -> backend)
 *
 * Trace Propagation:
 * - Uses W3C Trace Context standard for header propagation
 * - Automatically includes traceparent header in responses
 * - Allows correlating frontend and backend traces
 */
const otelSDK = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "delineate-hackathon-challenge",
  }),
  traceExporter: new OTLPTraceExporter(),
});
otelSDK.start();

/**
 * ============================================================================
 * HONO APPLICATION SETUP & MIDDLEWARE
 * ============================================================================
 */

/**
 * Initialize Hono application with OpenAPI support
 * OpenAPIHono provides automatic OpenAPI spec generation and Scalar UI
 */
const app = new OpenAPIHono();

/**
 * Request ID Middleware
 * Generates unique identifiers for each request to enable distributed tracing
 *
 * Flow:
 * 1. Check if client provided x-request-id header
 * 2. If not, generate new UUID
 * 3. Store in context for access throughout request lifecycle
 * 4. Return in response headers for client reference
 *
 * Benefits:
 * - Correlate logs across multiple services
 * - Trace complete request journey in observability platform
 * - Help with debugging customer issues
 */
app.use(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});

/**
 * Security Headers Middleware
 * Automatically adds HTTPS best practice headers:
 * - Strict-Transport-Security: Enforce HTTPS
 * - X-Content-Type-Options: Prevent MIME sniffing
 * - X-Frame-Options: Prevent clickjacking
 * - Content-Security-Policy: Restrict resource loading
 */
app.use(secureHeaders());

/**
 * CORS (Cross-Origin Resource Sharing) Middleware
 * Allows frontend applications to make requests to this API
 *
 * Configuration:
 * - Configurable allowed origins from environment
 * - Expose rate limit headers to client
 * - Allow necessary headers for authentication and requests
 * - Max age of 1 day for preflight caching
 */
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposeHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
    ],
    maxAge: 86400,
  }),
);

/**
 * Request Timeout Middleware
 * Prevents requests from running indefinitely
 *
 * Critical for proxy integration:
 * - Cloudflare default timeout: 100 seconds
 * - Standard proxy timeout: 30-60 seconds
 * - This setting: 30 seconds (configurable)
 *
 * Problem this demonstrates:
 * - Download operations may take 10-120 seconds
 * - Proxy will kill requests longer than timeout
 * - User gets 504 Gateway Timeout error
 *
 * Solution:
 * - Use async job queue (Challenge 2)
 * - Implement polling or WebSocket pattern
 * - Return job ID immediately instead of waiting
 */
app.use(timeout(env.REQUEST_TIMEOUT_MS));

/**
 * Rate Limiting Middleware
 * Protects API from abuse and resource exhaustion
 *
 * Configuration:
 * - Window: How long to track requests (default 60s)
 * - Limit: Max requests per window per client (default 100)
 * - Key: Uses IP address from headers or IP
 *
 * Header Support:
 * - x-forwarded-for: Used by proxies/load balancers
 * - x-real-ip: Alternative IP header
 *
 * Response Headers:
 * - X-RateLimit-Limit: Total requests allowed
 * - X-RateLimit-Remaining: Requests left in window
 * - Retry-After: Seconds until window resets
 */
app.use(
  rateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: "draft-6",
    keyGenerator: (c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "anonymous",
  }),
);

/**
 * OpenTelemetry Instrumentation Middleware
 * Automatically creates spans for each HTTP request
 *
 * Captures:
 * - HTTP method, path, status code
 * - Request/response headers (selective)
 * - Duration and timing information
 * - Error information if request fails
 *
 * Benefits:
 * - Visualize request flow in Jaeger UI
 * - Identify bottlenecks and slow endpoints
 * - See service dependencies and interactions
 */
app.use(
  httpInstrumentationMiddleware({
    serviceName: "delineate-hackathon-challenge",
  }),
);

/**
 * Sentry Error Tracking Middleware
 * Captures exceptions and sends to Sentry dashboard
 *
 * Features enabled:
 * - Automatic error capture on exceptions
 * - Performance monitoring
 * - Release tracking
 * - Environment-specific error filtering
 *
 * Testing Sentry:
 * - See README challenge 4 for how to trigger test errors
 * - Intentional error endpoint for validation
 */
app.use(
  sentry({
    dsn: env.SENTRY_DSN,
  }),
);

/**
 * ============================================================================
 * ERROR HANDLING & RESPONSE SCHEMAS
 * ============================================================================
 */

/**
 * Error Response Schema
 * Used for all error responses across the API
 * Includes error type, message, and request ID for correlation
 */
const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  })
  .openapi("ErrorResponse");

/**
 * Global Error Handler
 * Catches all unhandled exceptions and sends to Sentry
 *
 * Error Response:
 * - Always returns 500 status code
 * - Includes request ID for log correlation
 * - Development: Shows full error message
 * - Production: Generic error message (don't leak internals)
 */
app.onError((err, c) => {
  c.get("sentry").captureException(err);
  const requestId = c.get("requestId") as string | undefined;
  return c.json(
    {
      error: "Internal Server Error",
      message:
        env.NODE_ENV === "development"
          ? err.message
          : "An unexpected error occurred",
      requestId,
    },
    500,
  );
});

/**
 * Message Response Schema
 * Simple text response for informational endpoints
 */
const MessageResponseSchema = z
  .object({
    message: z.string(),
  })
  .openapi("MessageResponse");

/**
 * Health Check Response Schema
 * Includes status of all service dependencies
 *
 * Checks:
 * - storage: S3 connectivity and bucket access
 * - Could be extended with database, cache, etc.
 */
const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy"]),
    checks: z.object({
      storage: z.enum(["ok", "error"]),
    }),
  })
  .openapi("HealthResponse");

/**
 * ============================================================================
 * DOWNLOAD API SCHEMAS
 * ============================================================================
 * Defines all request and response schemas for the download API
 * Uses Zod for runtime validation and OpenAPI for documentation
 */

/**
 * Initiate Bulk Download Request Schema
 * Used when client wants to start processing multiple files
 *
 * Parameters:
 * - file_ids: Array of file identifiers (10K-100M range)
 *   - Can specify up to 1000 files per request
 *   - Useful for bulk export operations
 *
 * Architectural Note for Challenge 2:
 * This endpoint should return jobId immediately without waiting for processing.
 * The actual download processing should happen asynchronously.
 * Client polls /v1/download/status/:jobId for progress.
 */
const DownloadInitiateRequestSchema = z
  .object({
    file_ids: z
      .array(z.number().int().min(10000).max(100000000))
      .min(1)
      .max(1000)
      .openapi({ description: "Array of file IDs (10K to 100M)" }),
  })
  .openapi("DownloadInitiateRequest");

/**
 * Initiate Bulk Download Response Schema
 * Immediate response with job identifier
 *
 * Response:
 * - jobId: Unique identifier for this download job
 * - status: Either 'queued' or 'processing'
 * - totalFileIds: Count of files to process
 *
 * Client Usage:
 * Client stores jobId and uses it to poll for status
 * This solves the timeout problem by not waiting for the actual work
 */
const DownloadInitiateResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    status: z.enum(["queued", "processing"]),
    totalFileIds: z.number().int(),
  })
  .openapi("DownloadInitiateResponse");

/**
 * Check Single File Availability Request Schema
 * Lightweight endpoint to check if a specific file exists in S3
 *
 * Use Cases:
 * - Verify file existence before download
 * - Check file size before initiating download
 * - Pre-flight validation
 *
 * Sentry Testing:
 * Add ?sentry_test=true query parameter to trigger intentional error
 * Used for validating Sentry integration is working
 */
const DownloadCheckRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "Single file ID to check (10K to 100M)" }),
  })
  .openapi("DownloadCheckRequest");

/**
 * Check File Availability Response Schema
 * Returns whether file exists and metadata if available
 *
 * Response Fields:
 * - file_id: Echo back the requested file ID
 * - available: Boolean indicating file existence
 * - s3Key: Path to file in S3 storage (null if not available)
 * - size: File size in bytes (null if not available)
 *
 * This response is lightweight - good for quick preflight checks
 */
const DownloadCheckResponseSchema = z
  .object({
    file_id: z.number().int(),
    available: z.boolean(),
    s3Key: z
      .string()
      .nullable()
      .openapi({ description: "S3 object key if available" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
  })
  .openapi("DownloadCheckResponse");

/**
 * Start File Download Request Schema
 * Initiates a single file download with simulated delay
 *
 * THIS ENDPOINT DEMONSTRATES THE TIMEOUT PROBLEM:
 * - Downloads take 10-120 seconds (simulated)
 * - Proxies timeout after 30-100 seconds
 * - Clients get 504 Gateway Timeout error
 * - This is why Challenge 2 architecture design is critical
 */
const DownloadStartRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "File ID to download (10K to 100M)" }),
  })
  .openapi("DownloadStartRequest");

/**
 * Start File Download Response Schema
 * Contains download result with timing information
 *
 * Response Fields:
 * - file_id: Echo back the requested file ID
 * - status: "completed" if file found, "failed" if not
 * - downloadUrl: Presigned S3 URL for direct download (if successful)
 * - size: File size in bytes (if available)
 * - processingTimeMs: Actual time spent processing (includes simulated delay)
 * - message: Human-readable status message
 *
 * Presigned URLs:
 * These are temporary URLs that allow direct download from S3 without credentials
 * Client can pass this URL to their frontend for direct S3 download
 * This avoids downloading through the API and consuming server bandwidth
 */
const DownloadStartResponseSchema = z
  .object({
    file_id: z.number().int(),
    status: z.enum(["completed", "failed"]),
    downloadUrl: z
      .string()
      .nullable()
      .openapi({ description: "Presigned download URL if successful" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
    processingTimeMs: z
      .number()
      .int()
      .openapi({ description: "Time taken to process the download in ms" }),
    message: z.string().openapi({ description: "Status message" }),
  })
  .openapi("DownloadStartResponse");

/**
 * Input Sanitization for S3 Keys - Prevent Path Traversal Attacks
 *
 * Security Issue:
 * If file_id comes from user input without sanitization, attacker could:
 * - Use "../.." to navigate to parent directories
 * - Access files outside intended download directory
 * - Example: file_id = "../../admin/secret.txt"
 *
 * Solution:
 * - Convert to absolute value (remove negatives)
 * - Use Math.floor to ensure integer
 * - Construct path with only file_id, no user input
 * - S3 path: downloads/70000.zip (safe, predictable)
 */
const sanitizeS3Key = (fileId: number): string => {
  // Ensure fileId is a valid integer within bounds (already validated by Zod)
  const sanitizedId = Math.floor(Math.abs(fileId));
  // Construct safe S3 key without user-controlled path components
  return `downloads/${String(sanitizedId)}.zip`;
};

/**
 * S3 Health Check
 * Verifies that S3 service is accessible and credentials are valid
 *
 * Implementation:
 * - Attempts a lightweight HEAD request
 * - Uses a marker file that shouldn't exist
 * - 404 (NotFound) is acceptable - means bucket is accessible
 * - AccessDenied or timeout means storage is down
 *
 * Used by: /health endpoint
 * Returns: true if storage is accessible, false otherwise
 *
 * Note: If S3_BUCKET_NAME is empty, returns true (mock mode)
 */
const checkS3Health = async (): Promise<boolean> => {
  if (!env.S3_BUCKET_NAME) return true; // Mock mode - storage not configured
  try {
    // Use a lightweight HEAD request on a marker that likely doesn't exist
    // This is efficient - doesn't download actual file content
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    await s3Client.send(command);
    return true;
  } catch (err) {
    // NotFound (404) is fine - means bucket is accessible
    // If marker file exists, we still count that as healthy
    if (err instanceof Error && err.name === "NotFound") return true;
    // AccessDenied, timeout, or connection errors indicate problem
    return false;
  }
};

/**
 * S3 Availability Check
 * Checks if a specific file exists in S3 and retrieves its metadata
 *
 * Parameters:
 * - fileId: The file identifier to check
 *
 * Returns:
 * - available: Whether the file exists
 * - s3Key: The S3 object key (path) if file exists
 * - size: File size in bytes if file exists
 *
 * Mock Mode:
 * - If S3_BUCKET_NAME is empty, uses deterministic mock
 * - File exists if fileId % 7 === 0 (every 7th file)
 * - Generates random sizes 1KB-10MB
 * - Useful for testing without actual S3
 *
 * S3 Mode:
 * - Sends HeadObjectCommand to S3 (efficient - no data transfer)
 * - Gets file metadata without downloading
 * - Returns actual size from S3
 */
const checkS3Availability = async (
  fileId: number,
): Promise<{
  available: boolean;
  s3Key: string | null;
  size: number | null;
}> => {
  const s3Key = sanitizeS3Key(fileId);

  // If no bucket configured, use mock mode (useful for development)
  if (!env.S3_BUCKET_NAME) {
    const available = fileId % 7 === 0; // Every 7th file is "available"
    return {
      available,
      s3Key: available ? s3Key : null,
      size: available ? Math.floor(Math.random() * 10000000) + 1000 : null,
    };
  }

  // Query actual S3 bucket
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
    });
    const response = await s3Client.send(command);
    return {
      available: true,
      s3Key,
      size: response.ContentLength ?? null,
    };
  } catch {
    // File doesn't exist or other error
    return {
      available: false,
      s3Key: null,
      size: null,
    };
  }
};

/**
 * ============================================================================
 * DOWNLOAD DELAY SIMULATION HELPERS
 * ============================================================================
 * These functions simulate variable processing times to demonstrate the
 * timeout problem when dealing with long-running operations behind proxies
 */

/**
 * Get Random Delay for Download Processing
 *
 * Purpose:
 * Simulates real-world scenario where download processing time varies:
 * - Fast files: Quick database lookups (10-15s in dev mode)
 * - Slow files: Large files requiring compression (10-120s in prod mode)
 * - Very slow: Files requiring format conversion (up to 200s)
 *
 * Configuration:
 * - DOWNLOAD_DELAY_ENABLED: Toggle simulation on/off
 * - DOWNLOAD_DELAY_MIN_MS: Minimum delay (dev: 5s, prod: 10s)
 * - DOWNLOAD_DELAY_MAX_MS: Maximum delay (dev: 15s, prod: 120s)
 *
 * Returns:
 * Random value between min and max milliseconds
 * If delays disabled, returns 0
 */
const getRandomDelay = (): number => {
  if (!env.DOWNLOAD_DELAY_ENABLED) return 0;
  const min = env.DOWNLOAD_DELAY_MIN_MS;
  const max = env.DOWNLOAD_DELAY_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Sleep Helper
 * Pauses execution for a specified duration
 *
 * Used by: Download processing to simulate long-running operations
 * Returns: Promise that resolves after delay
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ============================================================================
 * API ROUTES
 * ============================================================================
 * Define all HTTP endpoints with OpenAPI documentation
 * Routes are registered with the Hono app instance below
 */

/**
 * Root Route (GET /)
 * Welcome endpoint for API health verification
 *
 * Use Case:
 * - Quick connectivity test
 * - Verify API is running
 * - Used by load balancers for basic healthchecks
 */
const rootRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["General"],
  summary: "Root endpoint",
  description: "Returns a welcome message",
  responses: {
    200: {
      description: "Successful response",
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
    },
  },
});

/**
 * Health Check Route (GET /health)
 * Comprehensive health status of service and dependencies
 *
 * Returns:
 * - status: "healthy" or "unhealthy"
 * - checks: Object with status of each dependency
 *   - storage: "ok" if S3 is accessible, "error" otherwise
 *
 * HTTP Status:
 * - 200: Service is healthy
 * - 503: Service is unhealthy (dependencies down)
 *
 * Use Cases:
 * - Kubernetes liveness probes
 * - Load balancer health checks
 * - Application startup verification
 * - Deployment readiness checks
 */
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check endpoint",
  description: "Returns the health status of the service and its dependencies",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
    503: {
      description: "Service is unhealthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

/**
 * ============================================================================
 * ROUTE HANDLERS
 * ============================================================================
 * Implement the actual logic for each route
 */

/**
 * Root Handler (GET /)
 * Simple welcome message
 */
app.openapi(rootRoute, (c) => {
  return c.json({ message: "Hello Hono!" }, 200);
});

/**
 * Health Check Handler (GET /health)
 * Checks all dependencies and returns aggregated status
 *
 * Logic:
 * 1. Check S3 connectivity
 * 2. Determine overall status (healthy if all checks pass)
 * 3. Return appropriate HTTP status code
 *
 * Usage:
 * Kubernetes: kubectl describe pod shows health status
 * Docker: Compose health check uses this endpoint
 */
app.openapi(healthRoute, async (c) => {
  const storageHealthy = await checkS3Health();
  const status = storageHealthy ? "healthy" : "unhealthy";
  const httpStatus = storageHealthy ? 200 : 503;
  return c.json(
    {
      status,
      checks: {
        storage: storageHealthy ? "ok" : "error",
      },
    },
    httpStatus,
  );
});

/**
 * ============================================================================
 * DOWNLOAD API ROUTES & HANDLERS
 * ============================================================================
 * These endpoints demonstrate the file download challenge
 */

/**
 * Download Initiate Route (POST /v1/download/initiate)
 * Accepts bulk download request
 *
 * Challenge 2 Note:
 * This endpoint should respond immediately with jobId without waiting.
 * The actual file processing should happen asynchronously in the background.
 * Client then polls /v1/download/status/:jobId for progress.
 */
const downloadInitiateRoute = createRoute({
  method: "post",
  path: "/v1/download/initiate",
  tags: ["Download"],
  summary: "Initiate download job",
  description: "Initiates a download job for multiple IDs",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadInitiateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download job initiated",
      content: {
        "application/json": {
          schema: DownloadInitiateResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const downloadCheckRoute = createRoute({
  method: "post",
  path: "/v1/download/check",
  tags: ["Download"],
  summary: "Check download availability",
  description:
    "Checks if a single ID is available for download in S3. Add ?sentry_test=true to trigger an error for Sentry testing.",
  request: {
    query: z.object({
      sentry_test: z.string().optional().openapi({
        description:
          "Set to 'true' to trigger an intentional error for Sentry testing",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: DownloadCheckRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Availability check result",
      content: {
        "application/json": {
          schema: DownloadCheckResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Download Initiate Handler (POST /v1/download/initiate)
 *
 * Current Implementation:
 * Returns jobId immediately without processing
 * In a real system, this would queue the work asynchronously
 *
 * Future Improvement (Challenge 2):
 * - Store job in database with status="pending"
 * - Push work to async queue (Bull, AWS SQS, etc.)
 * - Return immediately so client doesn't wait
 * - Client uses jobId to poll for status
 *
 * Benefits:
 * - Solves timeout problem by not blocking client
 * - Client can continue with other work
 * - Backend can process at its own pace
 * - Scales to 1000s of concurrent jobs
 */
app.openapi(downloadInitiateRoute, (c) => {
  const { file_ids } = c.req.valid("json");
  const jobId = crypto.randomUUID();
  return c.json(
    {
      jobId,
      status: "queued" as const,
      totalFileIds: file_ids.length,
    },
    200,
  );
});

/**
 * Download Check Route (POST /v1/download/check)
 * Lightweight endpoint to check file existence
 *
 * Features:
 * - Fast response (S3 HEAD request only)
 * - No data transfer
 * - Returns file size and S3 key
 *
 * Sentry Testing:
 * - Add ?sentry_test=true to trigger error
 * - Tests that Sentry integration is working
 * - Error will appear in Sentry dashboard
 *
 * Use Cases:
 * - Pre-flight validation before download
 * - Check available files
 * - Verify file sizes
 */
const downloadCheckRoute = createRoute({
  method: "post",
  path: "/v1/download/check",
  tags: ["Download"],
  summary: "Check download availability",
  description:
    "Checks if a single ID is available for download in S3. Add ?sentry_test=true to trigger an error for Sentry testing.",
  request: {
    query: z.object({
      sentry_test: z.string().optional().openapi({
        description:
          "Set to 'true' to trigger an intentional error for Sentry testing",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: DownloadCheckRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Availability check result",
      content: {
        "application/json": {
          schema: DownloadCheckResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Download Check Handler (POST /v1/download/check)
 *
 * Sentry Testing Feature:
 * - Query parameter ?sentry_test=true triggers intentional error
 * - Error includes file_id in message for debugging
 * - Useful for validating Sentry integration without actual failures
 *
 * Then checks S3 availability if sentry test not triggered
 */
app.openapi(downloadCheckRoute, async (c) => {
  const { sentry_test } = c.req.valid("query");
  const { file_id } = c.req.valid("json");

  // Intentional error for Sentry testing (hackathon challenge)
  // This allows testing that errors are properly captured and sent to Sentry
  if (sentry_test === "true") {
    throw new Error(
      `Sentry test error triggered for file_id=${String(file_id)} - This should appear in Sentry!`,
    );
  }

  // Check if file exists in S3 and get metadata
  const s3Result = await checkS3Availability(file_id);
  return c.json(
    {
      file_id,
      ...s3Result,
    },
    200,
  );
});

/**
 * ============================================================================
 * LONG-RUNNING DOWNLOAD DEMONSTRATION
 * ============================================================================
 * This route demonstrates the core problem: long-running operations behind
 * proxies with strict timeout limits.
 * 
 * The Problem in Action:
 * - Request comes in
 * - Server sleeps 10-120 seconds (simulated processing)
 * - Proxy (Cloudflare, nginx, AWS ALB) timeout fires after 30-100s
 * - Client gets 504 Gateway Timeout error
 * - Server continues processing in background (wasted work)
 *
 * Solution (Challenge 2):
 * Don't wait for processing! Return jobId immediately, process asynchronously,
 * let client poll for status instead.
 */

/**
 * Download Start Route (POST /v1/download/start)
 * Long-running endpoint that demonstrates timeout problem
 *
 * THE CORE CHALLENGE:
 * This endpoint sleeps for 10-120 seconds (configurable)
 * simulating real-world file operations like compression, format conversion, etc.
 *
 * In Development:
 * - Configured with 5-15 second delays
 * - Allows quick testing of timeout scenarios
 * - Usually completes before proxy timeout
 *
 * In Production:
 * - Configured with 10-120 second delays
 * - Request timeout set to 30 seconds
 * - Results in frequent 504 Gateway Timeout errors
 * - Demonstrates why async job patterns are necessary
 */
const downloadStartRoute = createRoute({
  method: "post",
  path: "/v1/download/start",
  tags: ["Download"],
  summary: "Start file download (long-running)",
  description: `Starts a file download with simulated processing delay.
    Processing time varies randomly between ${String(env.DOWNLOAD_DELAY_MIN_MS / 1000)}s and ${String(env.DOWNLOAD_DELAY_MAX_MS / 1000)}s.
    This endpoint demonstrates long-running operations that may timeout behind proxies.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadStartRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download completed successfully",
      content: {
        "application/json": {
          schema: DownloadStartResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Download Start Handler (POST /v1/download/start)
 * 
 * THIS IS WHERE THE TIMEOUT PROBLEM OCCURS:
 * 
 * Timeline Example (file_id=70000, delay=85s, timeout=30s):
 * T=0s   : Request received by proxy (e.g., Cloudflare)
 * T=0s   : Request forwarded to backend API
 * T=0s   : Backend starts logging and delay
 * T=30s  : Proxy timeout fires, returns 504 Gateway Timeout to client
 * T=85s  : Backend finishes sleep, continues processing
 * T=85+  : Backend checks S3, returns response (but no one's listening!)
 * 
 * The Result:
 * - Client sees 504 error and can retry
 * - Backend wasted 85 seconds of processing
 * - Connection held open for 30+ seconds unnecessarily
 * - Multiple retries create cascading failures
 * 
 * Why This Matters for Challenge 2:
 * In production, 30-40% of /v1/download/start requests will timeout!
 * This is why you MUST implement an async pattern.
 */
app.openapi(downloadStartRoute, async (c) => {
  const { file_id } = c.req.valid("json");
  const startTime = Date.now();

  // Get random delay simulating real-world processing time
  // Each request gets a random delay between min-max config
  // This replicates how different files take different time to process
  const delayMs = getRandomDelay();
  const delaySec = (delayMs / 1000).toFixed(1);
  const minDelaySec = (env.DOWNLOAD_DELAY_MIN_MS / 1000).toFixed(0);
  const maxDelaySec = (env.DOWNLOAD_DELAY_MAX_MS / 1000).toFixed(0);
  
  // Log detailed information for debugging and observability
  // These logs help understand which requests timeout and why
  console.log(
    `[Download] Starting file_id=${String(file_id)} | delay=${delaySec}s (range: ${minDelaySec}s-${maxDelaySec}s) | enabled=${String(env.DOWNLOAD_DELAY_ENABLED)}`,
  );

  /**
   * Simulate long-running download process
   * Real-world examples:
   * - Large file compression: 10-60 seconds
   * - Format conversion (PDF, XLSX): 30-120 seconds
   * - Database query and export: 5-45 seconds
   * - Network transfer from origin: variable
   * 
   * In production, clients should NOT wait for this directly.
   * Instead, they should:
   * 1. POST /v1/download/initiate (returns immediately with jobId)
   * 2. GET /v1/download/status/:jobId (poll every 1-5 seconds)
   * 3. When status="completed", get download URL
   * 4. Download file from presigned URL
   */
  await sleep(delayMs);

  // Check if file is available in S3 and get metadata
  const s3Result = await checkS3Availability(file_id);
  const processingTimeMs = Date.now() - startTime;

  // Log completion for observability and debugging
  // Shows actual processing time vs simulated delay (important for monitoring)
  console.log(
    `[Download] Completed file_id=${String(file_id)}, actual_time=${String(processingTimeMs)}ms, available=${String(s3Result.available)}`,
  );

  // Return response with success or failure
  // Note: If request timed out at proxy, response goes to /dev/null
  // This demonstrates why timeout-safe patterns (polling, async) are critical
  if (s3Result.available) {
    /**
     * Success Response
     * Returns presigned URL that client can use for direct download
     * 
     * Real Implementation Note:
     * In production, you should generate actual presigned S3 URLs
     * that expire after 15 minutes to prevent URL sharing/abuse
     */
    return c.json(
      {
        file_id,
        status: "completed" as const,
        downloadUrl: `https://storage.example.com/${s3Result.s3Key ?? ""}?token=${crypto.randomUUID()}`,
        size: s3Result.size,
        processingTimeMs,
        message: `Download ready after ${(processingTimeMs / 1000).toFixed(1)} seconds`,
      },
      200,
    );
  } else {
    /**
     * Failure Response
     * File not found in S3
     * Client should handle gracefully and retry or show error
     */
    return c.json(
      {
        file_id,
        status: "failed" as const,
        downloadUrl: null,
        size: null,
        processingTimeMs,
        message: `File not found after ${(processingTimeMs / 1000).toFixed(1)} seconds of processing`,
      },
      200,
    );
  }
});

/**
 * ============================================================================
 * OPENAPI & DOCUMENTATION
 * ============================================================================
 */

/**
 * OpenAPI Specification Generation
 * Disabled in production for security
 *
 * Generates machine-readable API spec
 * Used by code generation tools and documentation generators
 * Available at: http://localhost:3000/openapi
 */
if (env.NODE_ENV !== "production") {
  app.doc("/openapi", {
    openapi: "3.0.0",
    info: {
      title: "Delineate Hackathon Challenge API",
      version: "1.0.0",
      description: "API for Delineate Hackathon Challenge",
    },
    servers: [{ url: "http://localhost:3000", description: "Local server" }],
  });

  /**
   * Scalar API Documentation UI
   * Beautiful, interactive OpenAPI documentation
   * Available at: http://localhost:3000/docs
   * 
   * Features:
   * - Try out endpoints from the browser
   * - See request/response examples
   * - View authentication requirements
   * - Auto-generated from OpenAPI spec
   */
  app.get("/docs", Scalar({ url: "/openapi" }));
}

/**
 * ============================================================================
 * GRACEFUL SHUTDOWN
 * ============================================================================
 * Properly clean up resources when process is terminated
 * Important for:
 * - Docker container shutdown
 * - Kubernetes pod eviction
 * - Deployment updates
 * - Process restart
 */

/**
 * Graceful Shutdown Handler
 * 
 * Shutdown Sequence:
 * 1. Stop accepting new connections
 * 2. Wait for in-flight requests to complete (up to timeout)
 * 3. Flush OpenTelemetry traces to exporter
 * 4. Close S3 client connections
 * 5. Exit process cleanly
 *
 * Benefits:
 * - Prevents 503 Service Unavailable during shutdown
 * - Ensures traces are exported (not lost)
 * - Clean connection closing prevents connection leaks
 * - Kubernetes sees "Terminating" vs "Crashing" state
 */
const gracefulShutdown = (server: ServerType) => (signal: string) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Step 1: Stop accepting new HTTP connections
  // Existing connections are allowed to complete
  server.close(() => {
    console.log("HTTP server closed");

    // Step 2: Shutdown OpenTelemetry SDK
    // Flushes any pending traces to Jaeger/collector
    // Important to not lose trace data during shutdown
    otelSDK
      .shutdown()
      .then(() => {
        console.log("OpenTelemetry SDK shut down");
      })
      .catch((err: unknown) => {
        console.error("Error shutting down OpenTelemetry:", err);
      })
      .finally(() => {
        // Step 3: Clean up S3 client
        // Closes HTTP connections to S3 service
        s3Client.destroy();
        console.log("S3 client destroyed");
        console.log("Graceful shutdown completed");
      });
  });
};

/**
 * ============================================================================
 * SERVER STARTUP
 * ============================================================================
 */

/**
 * Start HTTP Server
 * Uses Hono's Node.js adapter for lightweight server
 *
 * Configuration:
 * - fetch: Hono app handler
 * - port: Configurable from environment (default 3000)
 *
 * Server will handle all registered routes and middleware
 */
const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${String(info.port)}`);
    console.log(`Environment: ${env.NODE_ENV}`);
    if (env.NODE_ENV !== "production") {
      console.log(`API docs: http://localhost:${String(info.port)}/docs`);
    }
  },
);

/**
 * Signal Handlers for Graceful Shutdown
 * 
 * SIGTERM:
 * - Sent by Kubernetes/Docker when requesting graceful shutdown
 * - Allows 30 seconds for cleanup before SIGKILL
 * - Used in production deployments
 *
 * SIGINT:
 * - Sent by Ctrl+C from terminal
 * - Used in development
 *
 * Both trigger graceful shutdown sequence defined above
 */
const shutdown = gracefulShutdown(server);
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
