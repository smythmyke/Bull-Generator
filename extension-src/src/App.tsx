import React, { useCallback, useState } from 'react';
import { useAuthContext } from './contexts/AuthContext';
import AuthPage from './components/AuthPage';
import { Button } from './components/ui/button';
import { LoadingSpinner } from './components/ui/loading-spinner';
import { Alert } from './components/ui/alert';
import BooleanSearchGenerator from './components/BooleanSearchGenerator';
import AnimatedCreditPill from './components/AnimatedCreditPill';

const App: React.FC = () => {
  const {
    user,
    isAuthenticated,
    loading,
    error,
    logout
  } = useAuthContext();

  const [activeTab, setActiveTab] = useState('search');

  const handleAuth = useCallback(() => {
    // Authentication was successful
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const renderContent = () => {
    if (!isAuthenticated || !user) {
      return <AuthPage onAuth={handleAuth} />;
    }

    return (
      <>
        <div className="border-b bg-background sticky top-0 z-10">
          <div className="p-3 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <img
                src="icons/icon32.png"
                alt="Patent Search Generator"
                className="w-8 h-8"
              />
              <div>
                <h1 className="text-sm font-bold">Patent Search Generator</h1>
                <p className="text-xs text-muted-foreground truncate max-w-[180px]">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AnimatedCreditPill onClick={() => setActiveTab('credits')} />
              <Button onClick={handleLogout} variant="outline" size="sm">
                Logout
              </Button>
            </div>
          </div>
        </div>

        <main className="flex-1 overflow-auto">
          <div className="p-3">
            {error && (
              <Alert variant="destructive" className="mb-3">
                {error}
              </Alert>
            )}
            <BooleanSearchGenerator activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
        </main>
      </>
    );
  };

  return (
    <div className="w-full h-screen bg-background flex flex-col overflow-hidden">
      {loading ? (
        <div className="h-full flex items-center justify-center">
          <LoadingSpinner className="h-8 w-8" />
        </div>
      ) : (
        <div className="h-full flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      )}
    </div>
  );
}

export default App;
