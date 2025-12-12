import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'

// Import telemetry setup
// This initializes Sentry and OpenTelemetry for observability
import './lib/telemetry'

// Import main app component
import App from './App'

// Import styles
// All dashboard styling is in App.css
import './App.css'

/**
 * Application Entry Point
 * 
 * This file sets up the React application and mounts it to the DOM.
 * 
 * Order of operations:
 * 1. Telemetry setup (Sentry, OpenTelemetry) - happens on import
 * 2. React component initialization
 * 3. Mount to DOM element with id 'root'
 * 
 * The Sentry Error Boundary in App.tsx wraps all components
 * to catch and report React errors automatically.
 */

// Create root React element
const root = ReactDOM.createRoot(
  // Mount point in index.html
  document.getElementById('root')!,
)

// Render app with Sentry instrumentation
// The telemetry module is already loaded, so all tracing is active
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
