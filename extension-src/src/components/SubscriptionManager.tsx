import React, { useState } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { createPortalSession, createCheckoutSession } from '../utils/stripeLoader';
import { Button } from './ui/button';
import { LoadingSpinner } from './ui/loading-spinner';
import { Alert } from './ui/alert';
import { BASE_URL } from '../config/endpoints';

const SubscriptionManager: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, subscriptionStatus, subscriptionEndDate } = useAuthContext();

  const handleManageSubscription = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await createPortalSession(`${BASE_URL}/success.html`);
      
      if (!response?.url) {
        throw new Error('No portal URL received from server');
      }

      window.open(response.url, '_blank');
    } catch (err) {
      console.error('Portal session error:', err);
      const errorMessage = err instanceof Error 
        ? err.message 
        : 'Failed to load subscription portal. Please try again later.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartSubscription = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await createCheckoutSession();
      
      if (!response?.url) {
        throw new Error('No checkout URL received from server');
      }

      window.open(response.url, '_blank');
    } catch (err) {
      console.error('Checkout session error:', err);
      const errorMessage = err instanceof Error 
        ? err.message 
        : 'Failed to start subscription process. Please try again later.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  const hasActiveSubscription = subscriptionStatus === 'active' || subscriptionStatus === 'trialing';

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="flex-1 text-sm">
        <span className="text-gray-600">Status: </span>
        <span className="font-medium capitalize">{subscriptionStatus || 'No active subscription'}</span>
        {subscriptionEndDate && (
          <span className="text-xs text-gray-500 ml-2">
            Next billing: {new Date(subscriptionEndDate).toLocaleDateString()}
          </span>
        )}
      </div>

      <Button
        onClick={hasActiveSubscription ? handleManageSubscription : handleStartSubscription}
        disabled={isLoading}
        variant="ghost"
        size="sm"
        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
      >
        {isLoading ? (
          <div className="flex items-center gap-1">
            <LoadingSpinner className="h-3 w-3" />
            <span>Processing...</span>
          </div>
        ) : hasActiveSubscription ? (
          "Manage"
        ) : (
          "Subscribe"
        )}
      </Button>

      {error && (
        <Alert variant="destructive" className="absolute top-12 left-2 right-2 z-50">
          {error}
        </Alert>
      )}
    </div>
  );
};

export default SubscriptionManager;
