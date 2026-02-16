import React from 'react';
import ReactDOM from 'react-dom/client';
import '../globals.css';
import '../index.css';
import ResultsPage from './ResultsPage';
import { AuthProvider } from '../contexts/AuthContext';
import { CreditProvider } from '../contexts/CreditContext';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <AuthProvider>
      <CreditProvider>
        <ResultsPage />
      </CreditProvider>
    </AuthProvider>
  </React.StrictMode>
);
