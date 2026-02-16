import React from 'react';
import ReactDOM from 'react-dom/client';
import '../globals.css';
import '../index.css';
import ResultsPage from './ResultsPage';
import { AuthProvider } from '../contexts/AuthContext';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <AuthProvider>
      <ResultsPage />
    </AuthProvider>
  </React.StrictMode>
);
