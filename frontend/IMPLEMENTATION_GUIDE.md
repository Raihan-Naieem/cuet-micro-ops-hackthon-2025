# Challenge 4: Observability Dashboard - Implementation Guide

## Overview

A React-based observability dashboard that integrates with Sentry for error tracking and OpenTelemetry for distributed tracing.

## Project Structure

```
frontend/
├── src/
│   ├── App.tsx                    # Main app with error boundary
│   ├── App.css                    # Styling
│   ├── main.tsx                   # Entry point
│   ├── lib/
│   │   ├── telemetry.ts          # Sentry & OTEL setup
│   │   ├── api.ts                # API client with Sentry
│   │   └── hooks.ts              # Custom React hooks
│   └── components/
│       ├── HealthStatus.tsx       # Health check UI
│       ├── DownloadManager.tsx    # Download job tracker
│       ├── ErrorLog.tsx           # Error list
│       └── TraceViewer.tsx        # Trace ID display
├── public/
│   └── index.html                 # HTML entry point
├── .env.example                   # Environment template
├── vite.config.ts                 # Vite config
├── tsconfig.json                  # TypeScript config
└── package.json                   # Dependencies
```

## Setup Instructions

### 1. Create `.env` file

```env
# API Configuration
VITE_API_URL=http://localhost:3000

# Sentry Configuration
VITE_SENTRY_DSN=https://your-key@sentry.io/your-project-id

# Environment
VITE_APP_VERSION=1.0.0
```

### 2. Install Dependencies

```bash
cd frontend
npm install
```

### 3. Start Development Server

```bash
npm run dev
# Available at http://localhost:5173
```

### 4. Build for Production

```bash
npm run build
```

## Components

### HealthStatus Component
```tsx
// Displays API health check
// Shows storage status (ok/error)
// Auto-refreshes every 10 seconds
// Sends to Sentry if unhealthy
```

### DownloadManager Component
```tsx
// UI for initiating downloads
// Real-time progress tracking
// Automatic polling every 2 seconds
// Cancel button for active jobs
// Direct download when complete
```

### ErrorLog Component
```tsx
// Displays recent errors
// Shows error timestamp
// Links to Sentry dashboard
// Clear errors button
// Error details expandable
```

### TraceViewer Component
```tsx
// Shows current trace ID
// Displays correlation info
// Copy trace ID button
// Links to Jaeger UI
// Shows trace status
```

## Sentry Integration

### Key Features Implemented

1. **Error Boundary**
   - Wraps entire application
   - Catches React component errors
   - Shows fallback UI
   - Sends to Sentry automatically

2. **Automatic Error Capture**
   - API errors automatically captured
   - Browser errors caught
   - Network errors tracked
   - Timeouts monitored

3. **Distributed Tracing**
   - Browser Tracing integration
   - Automatic HTTP span creation
   - Trace context headers
   - W3C Trace Context support

4. **Performance Monitoring**
   - Page load timing
   - Resource loading
   - User interactions
   - Custom spans

### Testing Sentry Integration

```bash
# 1. Set up Sentry project
# - Go to sentry.io
# - Create new project
# - Copy DSN to .env file

# 2. Start frontend and backend
npm run dev  # in frontend/
npm run docker:dev  # in root/

# 3. Trigger test error
# Click "Trigger Sentry Test Error" button in dashboard
# Or: POST /v1/download/check?sentry_test=true from frontend

# 4. View in Sentry dashboard
# Should appear within seconds
# Shows error details, stack trace, context
```

## Environment Variables

Required:
- `VITE_API_URL`: Backend API URL (default: http://localhost:3000)
- `VITE_SENTRY_DSN`: Sentry project DSN

Optional:
- `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`: OpenTelemetry endpoint
- `VITE_APP_VERSION`: Application version

## Monitoring Dashboard Features

### Real-Time Health Monitoring
- API status (up/down)
- Storage connectivity
- Auto-refresh every 10 seconds
- Visual indicators (green/red)

### Download Job Tracking
- Initiate new downloads
- Real-time progress bars
- File count tracking
- Estimated time remaining
- Cancel functionality
- Direct S3 download link

### Error Tracking
- Recent error list
- Timestamps
- Error messages
- Stack traces
- Sentry links

### Trace Correlation
- Current trace ID display
- Correlation with backend logs
- Jaeger UI links
- Export trace data

## Docker Integration

Add to `docker-compose.dev.yml`:

```yaml
frontend:
  build:
    context: ./frontend
    dockerfile: Dockerfile
  ports:
    - "5173:5173"
  environment:
    VITE_API_URL=http://delineate-app:3000
    VITE_SENTRY_DSN=${SENTRY_DSN}
  depends_on:
    - delineate-app
```

Add to `.env`:

```env
SENTRY_DSN=https://your-key@sentry.io/your-project-id
```

Start with:

```bash
npm run docker:dev
```

## OpenTelemetry Integration

### Current Setup
- Sentry's BrowserTracing for distributed tracing
- W3C Trace Context header propagation
- Automatic HTTP instrumentation

### Future Enhancements
- Full OTEL JS SDK integration
- Custom spans for business logic
- Jaeger collector integration
- Baggage propagation

### Implementing Custom Spans

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('dashboard');

function myFunction() {
  const span = tracer.startSpan('my-operation');
  try {
    // Do work
  } finally {
    span.end();
  }
}
```

## Testing Checklist

- [ ] Frontend loads at http://localhost:5173
- [ ] Health status updates every 10 seconds
- [ ] Can initiate download (if API running)
- [ ] Progress bar updates during download
- [ ] Can see trace ID in footer
- [ ] Can trigger test Sentry error
- [ ] Error appears in Sentry dashboard
- [ ] Can clear error log
- [ ] App doesn't crash on API error
- [ ] All requests have x-request-id header

## Deployment

### Build Docker Image

```dockerfile
FROM node:24-slim

WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/*.config.ts ./
COPY frontend/tsconfig.json ./

# Build for production
RUN npm run build

# Serve with nginx
FROM nginx:alpine
COPY --from=0 /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Deploy to Cloud

#### Vercel (Recommended)
```bash
npm i -g vercel
cd frontend
vercel
```

#### Netlify
```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

#### AWS Amplify
```bash
npm install -g @aws-amplify/cli
amplify init
amplify publish
```

## Environment-Specific Configuration

### Development
- Sentry trace rate: 100%
- Replay rate: 50%
- Verbose logging

### Production
- Sentry trace rate: 10%
- Replay rate: 10%
- Error only logging

Set via:

```typescript
const isDev = import.meta.env.MODE === 'development';
tracesSampleRate: isDev ? 1.0 : 0.1
```

## Common Issues

### API Connection Refused
- Check backend is running on correct port
- Verify VITE_API_URL in .env
- Check CORS configuration in backend

### Sentry Not Capturing Errors
- Verify SENTRY_DSN is set
- Check Sentry project is active
- Check error boundary is working
- See browser console for error details

### Trace IDs Not Showing
- Ensure API is returning x-request-id header
- Check Sentry initialization completed
- Verify network tab shows header in response

### Download Progress Not Updating
- Check polling interval (2 seconds)
- Verify backend job processing
- Check browser console for errors
- Ensure job status endpoint is responding

## Resources

- [Sentry React Documentation](https://docs.sentry.io/platforms/javascript/guides/react/)
- [OpenTelemetry JS](https://opentelemetry.io/docs/instrumentation/js/)
- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [Axios Documentation](https://axios-http.com/)

## Next Steps

1. **Complete component implementations** (provided as stubs above)
2. **Add unit tests** for components
3. **Set up CI/CD** for frontend
4. **Performance optimization** with code splitting
5. **Accessibility improvements** (a11y)
6. **Mobile responsiveness** updates
7. **Dark mode support**
8. **Real-time updates** with WebSockets

## Support

For issues or questions:
1. Check error in Sentry dashboard
2. Look at browser console
3. Check network tab for API responses
4. Review GitHub issues
5. Create new issue with reproduction steps
