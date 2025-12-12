import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Development server configuration
    port: 5173,
    // Proxy API requests to backend during development
    // This avoids CORS issues in local development
    proxy: {
      '/v1': {
        // Backend API URL - defaults to localhost:3000
        // Override with VITE_API_URL environment variable
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        // Rewrite paths to remove /api prefix if needed
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/health': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Optimization settings for production builds
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        // Separates dependencies from application code
        manualChunks: {
          // Sentry gets its own chunk due to large size
          'sentry': ['@sentry/react'],
          // HTTP client as separate chunk
          'http': ['axios'],
        },
      },
    },
    // Minify configuration
    minify: 'terser',
    // Source maps disabled in production for smaller bundle
    sourcemap: false,
  },
  // Environment variables that should be exposed to the client
  // All variables starting with VITE_ are automatically exposed
  define: {
    // Can add custom global constants here if needed
  },
})
