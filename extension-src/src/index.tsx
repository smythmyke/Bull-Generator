import React from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';

// Mark as side panel so CSS constrains overflow
document.documentElement.classList.add('side-panel');

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
