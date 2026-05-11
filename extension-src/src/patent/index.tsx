import React from 'react';
import ReactDOM from 'react-dom/client';
import '../globals.css';
import '../index.css';
import PatentDossierPage from './PatentDossierPage';
import { AuthProvider } from '../contexts/AuthContext';
import { CreditProvider } from '../contexts/CreditContext';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <AuthProvider>
      <CreditProvider>
        <PatentDossierPage />
      </CreditProvider>
    </AuthProvider>
  </React.StrictMode>
);
