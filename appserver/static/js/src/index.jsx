/**
 * index.jsx — React application entry point.
 * Mounts the App component into the Splunk dashboard container div.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('edl-manager-root');
if (container) {
  createRoot(container).render(
    <React.StrictMode><App /></React.StrictMode>
  );
} else {
  console.error('[EDL Manager] Mount point #edl-manager-root not found.');
}
