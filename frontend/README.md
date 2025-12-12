# Frontend Observability Dashboard

A modern React-based observability dashboard for monitoring long-running file downloads with real-time error tracking and distributed tracing.

## Features

- **Real-Time Health Monitoring**: Polls API health status every 10 seconds
- **Download Job Tracking**: Manage multiple async downloads with progress bars
- **Error Tracking**: Sentry integration for automatic error capture and reporting
- **Distributed Tracing**: OpenTelemetry integration with trace ID correlation
- **Beautiful UI**: Modern card-based layout with responsive design
- **Type-Safe**: Full TypeScript support with strict mode enabled
- **Production Ready**: Optimized builds, error boundaries, graceful error handling

## Tech Stack

- **Framework**: React 18.2 with TypeScript
- **Build Tool**: Vite 5.0 for lightning-fast development
- **HTTP Client**: Axios with automatic retry logic
- **Error Tracking**: Sentry for real-time error monitoring
- **Tracing**: OpenTelemetry with browser instrumentation
- **Code Quality**: ESLint, Prettier, TypeScript strict mode

## Quick Start

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Create Environment Configuration

```bash
cp .env.example .env.local
# Edit .env.local with your settings
```

### 3. Start Development Server

```bash
npm run dev
```

Access the dashboard at `http://localhost:5173`

### 4. Build for Production

```bash
npm run build
npm run preview  # Preview production build
```

## Environment Configuration

Required environment variables in `.env.local`:

```env
VITE_API_URL=http://localhost:3000
VITE_SENTRY_DSN=https://your-key@sentry.io/your-project-id
```

See `.env.example` for full documentation.

## Components

### HealthStatus
Displays API and storage health status with auto-refresh.

```tsx
<HealthStatus />
```

**Features:**
- Polls /health endpoint every 10 seconds
- Shows API status (up/down)
- Shows S3 storage connectivity
- Displays last check timestamp
- Manual refresh button

### DownloadManager
Manages async file downloads with real-time progress tracking.

```tsx
<DownloadManager />
```

**Features:**
- Initiate new downloads
- Real-time progress bars
- File count tracking
- Estimated time remaining
- Cancel buttons
- Direct S3 download links

### ErrorLog
Displays errors captured by Sentry in real-time.

```tsx
<ErrorLog />
```

**Features:**
- Real-time error list
- Expandable error details
- Stack traces
- Error context and tags
- Links to Sentry dashboard
- Clear all errors button

### TraceViewer
Shows distributed trace context for debugging.

```tsx
<TraceViewer />
```

**Features:**
- Current trace ID display
- Copy to clipboard
- Links to Jaeger UI
- Baggage context information
- Environment info

## API Integration

The dashboard communicates with the backend via HTTP:

### Health Check

```typescript
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00Z",
  "s3": {
    "connected": true,
    "bucket": "downloads"
  },
  "version": "1.0.0"
}
```

### Initiate Download

```typescript
POST /v1/download/initiate
Body: { "fileId": "file-123" }
```

**Response:**
```json
{
  "jobId": "job-abc123",
  "status": "processing",
  "progress": 0
}
```

### Get Download Status

```typescript
GET /v1/download/status/:jobId
```

**Response:**
```json
{
  "status": "processing",
  "progress": 45,
  "filesProcessed": 4,
  "totalFiles": 10,
  "estimatedTimeRemaining": 30000
}
```

### Cancel Download

```typescript
POST /v1/download/cancel/:jobId
```

## Sentry Integration

### Setup

1. Create a Sentry project at https://sentry.io
2. Copy your project DSN
3. Add to `.env.local`:
   ```env
   VITE_SENTRY_DSN=https://your-key@sentry.io/your-project-id
   ```

### Features

- **Automatic Error Capture**: All React errors are captured
- **Error Boundaries**: Graceful error handling with fallback UI
- **Request Instrumentation**: Automatic HTTP request tracking
- **Session Replay**: Optional full session recording
- **Breadcrumbs**: Automatic event tracking

### Testing Sentry

1. Start the dashboard: `npm run dev`
2. Click "Trigger Sentry Test Error" button
3. Check Sentry dashboard - error appears within seconds

## Distributed Tracing

### Trace ID Propagation

The API client automatically includes trace context headers:

```typescript
headers: {
  'sentry-trace': 'trace-id-span-id-sampled',
  'x-request-id': 'request-id-123',
}
```

This enables correlating frontend and backend logs.

### Using Trace IDs

1. Look for trace ID in footer
2. Copy trace ID to clipboard
3. Search in Jaeger UI: `http://localhost:16686`
4. View complete request flow across services

## Development

### Available Scripts

```bash
npm run dev         # Start development server
npm run build       # Build for production
npm run preview     # Preview production build locally
npm run lint        # Run ESLint
npm run type-check  # Run TypeScript type checking
```

### Project Structure

```
frontend/
├── src/
│   ├── App.tsx                 # Main app component
│   ├── App.css                 # Dashboard styles
│   ├── main.tsx                # Entry point
│   ├── lib/
│   │   ├── telemetry.ts        # Sentry & OTEL setup
│   │   └── api.ts              # HTTP client
│   └── components/
│       ├── HealthStatus.tsx    # Health check
│       ├── DownloadManager.tsx # Download jobs
│       ├── ErrorLog.tsx        # Error log
│       └── TraceViewer.tsx     # Trace context
├── public/
│   └── index.html              # HTML entry point
├── .env.example                # Environment template
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript config
└── package.json                # Dependencies
```

### Adding New Components

1. Create component in `src/components/`
2. Use TypeScript for type safety
3. Add detailed comments explaining logic
4. Export from component index
5. Import in App.tsx
6. Add styling in App.css

Example:

```typescript
/**
 * MyComponent
 * 
 * Description of what this component does.
 * 
 * Features:
 * - Feature 1
 * - Feature 2
 */
export const MyComponent: React.FC = () => {
  return <div>Content</div>
}
```

## Docker

### Build Image

```bash
docker build -f frontend.Dockerfile -t frontend:latest .
```

### Run Container

```bash
docker run \
  -p 5173:5173 \
  -e VITE_API_URL=http://api:3000 \
  -e VITE_SENTRY_DSN=https://key@sentry.io/projectid \
  frontend:latest
```

### Docker Compose

See root `docker-compose.dev.yml` for complete setup.

## Performance Optimization

### Bundle Size

- Code splitting for Sentry and axios
- Tree-shaking unused code
- Minification in production
- Source maps disabled in production

### Caching

- HTTP response caching via headers
- Service Worker ready (can be added)
- Browser cache for assets
- CDN-friendly build outputs

### Rendering

- React.memo for component memoization
- useCallback for function memoization
- Lazy loading with React.lazy
- Virtual scrolling for large lists

## Testing

### Unit Tests (To Be Added)

```bash
npm run test
```

### E2E Tests (To Be Added)

```bash
npm run e2e
```

### Manual Testing Checklist

- [ ] Frontend loads at correct URL
- [ ] Health status updates every 10 seconds
- [ ] Can initiate download
- [ ] Progress bar updates
- [ ] Can cancel download
- [ ] Trace ID displays in footer
- [ ] Sentry test error works
- [ ] Error log shows errors
- [ ] All requests have trace headers
- [ ] Works on mobile (responsive)

## Troubleshooting

### API Connection Refused

**Problem**: Cannot connect to backend API
**Solution**:
1. Verify backend is running: `curl http://localhost:3000/health`
2. Check `VITE_API_URL` in `.env.local`
3. Verify CORS configuration on backend
4. Check proxy settings in vite.config.ts

### Sentry Not Capturing Errors

**Problem**: Errors don't appear in Sentry dashboard
**Solution**:
1. Verify `VITE_SENTRY_DSN` is set correctly
2. Check Sentry project is active
3. Check browser console for initialization errors
4. Verify network request to sentry.io in DevTools
5. Ensure error boundary is working

### Trace IDs Not Showing

**Problem**: Footer shows no trace ID
**Solution**:
1. Make an API request to generate a trace
2. Check browser console for errors
3. Verify Sentry initialization completed
4. Check API response includes x-request-id header

### Build Fails

**Problem**: `npm run build` fails with errors
**Solution**:
1. Clear node_modules: `rm -rf node_modules && npm install`
2. Clear build cache: `rm -rf dist`
3. Check TypeScript errors: `npm run type-check`
4. Check ESLint errors: `npm run lint`

## Deployment

### Vercel (Recommended)

```bash
npm i -g vercel
vercel
# Follow prompts to deploy
```

### Netlify

```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

### AWS Amplify

```bash
npm install -g @aws-amplify/cli
amplify init
amplify publish
```

### Docker / Kubernetes

```bash
# Build image
docker build -t frontend:latest .

# Push to registry
docker push your-registry/frontend:latest

# Deploy to Kubernetes
kubectl apply -f frontend-deployment.yaml
```

## Configuration

### Vite Configuration

Edit `vite.config.ts` to customize:
- Development server port
- Build output directory
- API proxy settings
- Environment variable exposure

### TypeScript Configuration

Edit `tsconfig.json` to customize:
- Compile targets
- Module resolution
- Strict type checking
- Path aliases

### ESLint Configuration

Edit `eslint.config.mjs` to customize:
- Code style rules
- TypeScript rules
- React best practices
- Import ordering

## Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes with comments
3. Run tests: `npm run lint && npm run type-check`
4. Commit with clear message
5. Push and create Pull Request

## Security

- **Environment Variables**: Never commit `.env.local`
- **Secrets**: Use backend API, not client-side variables
- **CORS**: Configure properly on backend
- **CSP Headers**: Add Content Security Policy headers
- **SRI Hashes**: Use for CDN-hosted dependencies

## Performance Metrics

### Target Metrics

- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Largest Contentful Paint: < 2.5s
- Cumulative Layout Shift: < 0.1

### Monitoring

- Use Sentry for error rates
- Use Lighthouse for performance
- Use Chrome DevTools for profiling
- Use Jaeger for request timing

## Resources

- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Sentry React Guide](https://docs.sentry.io/platforms/javascript/guides/react/)
- [OpenTelemetry JS](https://opentelemetry.io/docs/instrumentation/js/)
- [Axios Documentation](https://axios-http.com/)

## Support

For issues or questions:
1. Check error in Sentry dashboard
2. Look at browser console
3. Check network tab in DevTools
4. Review logs in container/server
5. Create GitHub issue with reproduction steps

## License

See LICENSE file in project root.

## Changelog

### v1.0.0 (Initial Release)
- ✅ Health status monitoring
- ✅ Download job tracking
- ✅ Error tracking with Sentry
- ✅ Distributed tracing with OpenTelemetry
- ✅ Responsive design
- ✅ Type-safe TypeScript
- ⏳ Unit tests (coming soon)
- ⏳ E2E tests (coming soon)
- ⏳ Dark mode (coming soon)
- ⏳ WebSocket real-time updates (coming soon)

## Next Steps

1. **Testing**: Add Jest unit tests and Playwright E2E tests
2. **Features**: Add WebSocket for real-time updates
3. **Dark Mode**: Implement theme switching
4. **Mobile**: Optimize for smaller screens
5. **Performance**: Add Web Workers for heavy computation
6. **Documentation**: Add Storybook for component showcase

---

**Created**: 2024
**Last Updated**: 2024
**Status**: Production Ready ✅
