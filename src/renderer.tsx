import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import HangoutOverlay from './HangoutOverlay';
import './index.css';

// Check if this is the hangout overlay window
const urlParams = new URLSearchParams(window.location.search);
const isHangoutWindow = urlParams.get('hangout') === 'true';

// Set transparent background immediately for hangout window
if (isHangoutWindow) {
  document.body.classList.add('hangout-overlay');
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    {isHangoutWindow ? <HangoutOverlay /> : <App />}
  </React.StrictMode>
);
