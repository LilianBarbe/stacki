import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
// Tokens first: styles.css's own variables are aliases of them.
import './style-panel/tokens.css';
import './styles.css';
import { restoreSavedEdits } from './theme-lab/edits.js';

// Theme Lab overrides still being tried out, back in place before first paint.
restoreSavedEdits();

// The last resort behind the per-region boundaries in App: a crash in the
// chrome they don't cover (title bar, git chip, App's own hooks) lands here
// instead of on a blank window.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary root label="the app">
    <App />
  </ErrorBoundary>
);
